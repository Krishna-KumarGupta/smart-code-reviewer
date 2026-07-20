from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.config import Settings
from app.db.models import Review
from app.models import ReviewReport
from app.notify.email_client import BrevoEmailClient, SESEmailClient, get_email_client, send_review_notification_with_fallback

_IN_MEMORY_URL = "sqlite+aiosqlite:///:memory:"


async def _build_test_engine():
    from app.db.models import Base

    engine = create_async_engine(
        _IN_MEMORY_URL,
        echo=False,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine


@pytest_asyncio.fixture()
async def db_engine():
    engine = await _build_test_engine()
    yield engine
    await engine.dispose()


def _make_session_factory(engine):
    return async_sessionmaker(bind=engine, expire_on_commit=False, class_=AsyncSession)


def test_factory_returns_correct_client():
    """get_email_client() shim returns BrevoEmailClient when SES is unconfigured."""
    settings = Settings(service_api_key="key", openai_api_key="key")
    # No SES vars set → ses_configured is False → shim returns Brevo
    client = get_email_client(settings)
    assert isinstance(client, BrevoEmailClient)


def test_factory_returns_ses_when_configured():
    """get_email_client() shim returns SESEmailClient when all four SES vars are set."""
    settings = Settings(service_api_key="key", openai_api_key="key")
    settings.aws_ses_access_key = "AKIAIOSFODNN7EXAMPLE"
    settings.aws_ses_secret_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
    settings.aws_ses_region = "us-east-1"
    settings.aws_ses_sender_email = "sender@example.com"
    client = get_email_client(settings)
    assert isinstance(client, SESEmailClient)


@pytest.mark.asyncio
@patch("app.notify.email_client.get_email_client")
async def test_email_disabled_does_not_instantiate(mock_get_client, db_engine, monkeypatch):
    from app.tasks import _send_notification_safely

    factory = _make_session_factory(db_engine)
    import app.db.session as db_session_mod

    monkeypatch.setattr(db_session_mod, "_session_factory", factory)
    monkeypatch.setattr(db_session_mod, "get_session", db_session_mod.get_session)

    with patch("app.config.get_settings") as mock_settings:
        settings = Settings(service_api_key="key", openai_api_key="key")
        settings.email_enabled = False
        mock_settings.return_value = settings

        review_id = str(uuid.uuid4())
        async with factory() as session:
            session.add(
                Review(
                    id=review_id,
                    repo_url="https://github.com/owner/repo",
                    pr_number=1,
                    user_id="u",
                    user_email="user@test.com",
                    status="completed",
                )
            )
            await session.commit()

        await _send_notification_safely(review_id)
        mock_get_client.assert_not_called()


@pytest.mark.asyncio
async def test_brevo_client_send_interpolation():
    settings = Settings(service_api_key="key", openai_api_key="key")
    settings.brevo_api_key = "fake_key"
    settings.brevo_sender_email = "sender@test.com"
    settings.frontend_review_url_base = "http://localhost:5173/reviews"
    client = BrevoEmailClient(settings)

    findings = [
        {"severity": "critical", "file": "app.py", "line_start": 5, "description": "Crash vuln"},
        {"severity": "low", "file": "helper.py", "line_start": None, "description": "Unused var"},
    ]

    with patch("httpx2.AsyncClient") as mock_client_class:
        mock_client = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_client.post.return_value = mock_resp
        mock_client_class.return_value.__aenter__.return_value = mock_client

        # Success path
        await client.send_review_notification(
            to_email="recipient@test.com",
            repo_name="my-repo",
            pr_number=42,
            review_id="r123",
            status="completed",
            score=85,
            review_excerpt="Prose summary here",
            findings=findings,
            error=None,
        )

        mock_client.post.assert_called_once()
        args, kwargs = mock_client.post.call_args
        url = args[0]
        json_data = kwargs["json"]
        headers = kwargs["headers"]

        assert url == "https://api.brevo.com/v3/smtp/email"
        assert headers["api-key"] == "fake_key"
        assert json_data["sender"]["email"] == "sender@test.com"
        assert json_data["to"][0]["email"] == "recipient@test.com"
        assert "CRITICAL" in json_data["htmlContent"]
        assert "recipient@test.com" in json_data["to"][0]["email"]


@pytest.mark.asyncio
async def test_email_failure_isolation(db_engine, monkeypatch):
    """A review whose email send is mocked to raise still ends up status='completed' in DB."""
    from app.tasks import _persist_report

    factory = _make_session_factory(db_engine)
    import app.db.session as db_session_mod

    monkeypatch.setattr(db_session_mod, "_session_factory", factory)
    monkeypatch.setattr(db_session_mod, "get_session", db_session_mod.get_session)

    with (
        patch("app.config.get_settings") as mock_settings,
        patch(
            "app.notify.email_client.BrevoEmailClient.send_review_notification",
            side_effect=RuntimeError("Brevo API Down"),
        ),
    ):
        settings = Settings(service_api_key="key", openai_api_key="key")
        settings.email_enabled = True
        # No SES vars → SES skipped, only Brevo attempted (and it fails)
        settings.brevo_api_key = "fake"
        settings.brevo_sender_email = "sender@test.com"
        mock_settings.return_value = settings

        review_id = str(uuid.uuid4())
        async with factory() as session:
            session.add(
                Review(
                    id=review_id,
                    repo_url="https://github.com/owner/repo",
                    pr_number=1,
                    user_id="u",
                    user_email="user@test.com",
                    status="running",
                )
            )
            await session.commit()

        stub_report = ReviewReport(score=90, review="All good.", improvements=[], bugs=[])
        await _persist_report(review_id, stub_report)

        async with factory() as session:
            review = await session.get(Review, review_id)
            assert review is not None
            assert review.status == "completed"
            assert review.email_sent is False
            assert "Brevo API Down" in str(review.email_error)


@pytest.mark.asyncio
async def test_email_deduplication(db_engine, monkeypatch):
    """A review is not emailed twice on a retry once email_sent=True."""
    from app.tasks import _persist_report

    factory = _make_session_factory(db_engine)
    import app.db.session as db_session_mod

    monkeypatch.setattr(db_session_mod, "_session_factory", factory)
    monkeypatch.setattr(db_session_mod, "get_session", db_session_mod.get_session)

    mock_send = AsyncMock()

    with (
        patch("app.config.get_settings") as mock_settings,
        patch("app.notify.email_client.BrevoEmailClient.send_review_notification", mock_send),
    ):
        settings = Settings(service_api_key="key", openai_api_key="key")
        settings.email_enabled = True
        # No SES vars → SES skipped, Brevo called (and it succeeds)
        settings.brevo_api_key = "fake"
        settings.brevo_sender_email = "sender@test.com"
        mock_settings.return_value = settings

        review_id = str(uuid.uuid4())
        async with factory() as session:
            session.add(
                Review(
                    id=review_id,
                    repo_url="https://github.com/owner/repo",
                    pr_number=1,
                    user_id="u",
                    user_email="user@test.com",
                    status="running",
                    email_sent=True,
                )
            )
            await session.commit()

        stub_report = ReviewReport(score=90, review="All good.", improvements=[], bugs=[])
        await _persist_report(review_id, stub_report)

        mock_send.assert_not_called()


@pytest.mark.asyncio
async def test_brevo_windows_path_in_finding():
    """
    Regression test: findings whose file paths or descriptions contain backslashes
    (e.g. Windows-style paths like src\\auth\\Utils.py) must not cause a
    bad-escape error from re.sub().  The fix replaces re.sub() with str.split()
    for sentinel removal, so backslashes in replacement content are never
    interpreted as regex sequences.
    """
    settings = Settings(service_api_key="key", openai_api_key="key")
    settings.brevo_api_key = "fake_key"
    settings.brevo_sender_email = "sender@test.com"
    settings.frontend_review_url_base = "http://localhost:5173/reviews"
    client = BrevoEmailClient(settings)

    findings = [
        {
            "severity": "critical",
            "file": "src\\auth\\Utils.py",          # Windows backslash path
            "line_start": 42,
            "description": "Null pointer at \\User\\data — check input",
        },
        {
            "severity": "high",
            "file": "src\\models\\User.py",
            "line_start": None,
            "description": "Unchecked \\UPPERCASE escape \\N{SNOWMAN} in string",
        },
    ]

    with patch("httpx2.AsyncClient") as mock_client_class:
        mock_client = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_client.post.return_value = mock_resp
        mock_client_class.return_value.__aenter__.return_value = mock_client

        # Must not raise — previously crashed with "bad escape \U at position …"
        await client.send_review_notification(
            to_email="recipient@test.com",
            repo_name="my-repo",
            pr_number=7,
            review_id="r-win-path",
            status="completed",
            score=60,
            review_excerpt="Some review text",
            findings=findings,
            error=None,
        )

        mock_client.post.assert_called_once()
        _, kwargs = mock_client.post.call_args
        html = kwargs["json"]["htmlContent"]
        text = kwargs["json"]["textContent"]

        # Backslashes must appear literally in the output
        assert "src\\auth\\Utils.py" in html
        assert "src\\auth\\Utils.py" in text
        assert "Null pointer at \\User\\data" in html
