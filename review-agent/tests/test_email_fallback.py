"""
test_email_fallback.py — Tests for the SES→Brevo fallback orchestrator.

Covers:
  1. SES unconfigured → Brevo is used directly, SES never instantiated
  2. SES configured but send raises MessageRejected → Brevo fallback succeeds,
     warning logged, email_provider_used == "brevo"
  3. SES configured and send succeeds → Brevo never called,
     email_provider_used == "ses"
  4. Both SES and Brevo fail → email_error set, review.status unaffected
"""
from __future__ import annotations

import logging
import uuid
from unittest.mock import AsyncMock, MagicMock, patch, call

import pytest
import pytest_asyncio
from botocore.exceptions import ClientError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.config import Settings
from app.db.models import Review
from app.models import ReviewReport

_IN_MEMORY_URL = "sqlite+aiosqlite:///:memory:"

# ─── Shared helpers ───────────────────────────────────────────────────────────

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


def _ses_configured_settings() -> Settings:
    """Return a Settings object with all four SES vars populated."""
    s = Settings(service_api_key="key", openai_api_key="key")
    s.aws_ses_access_key = "AKIAIOSFODNN7EXAMPLE"
    s.aws_ses_secret_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
    s.aws_ses_region = "us-east-1"
    s.aws_ses_sender_email = "sender@example.com"
    s.brevo_api_key = "brevo-fake-key"
    s.brevo_sender_email = "sender@test.com"
    s.email_enabled = True
    return s


def _ses_unconfigured_settings() -> Settings:
    """Return a Settings object with NO SES vars set."""
    s = Settings(service_api_key="key", openai_api_key="key")
    s.brevo_api_key = "brevo-fake-key"
    s.brevo_sender_email = "sender@test.com"
    s.email_enabled = True
    return s


def _make_client_error(code: str, message: str) -> ClientError:
    """Build a botocore ClientError with the given Error Code and Message."""
    return ClientError(
        error_response={"Error": {"Code": code, "Message": message}},
        operation_name="SendEmail",
    )


# ─── Shared notification kwargs ───────────────────────────────────────────────

_NOTIF_KWARGS = dict(
    to_email="recipient@test.com",
    repo_name="my-repo",
    pr_number=42,
    review_id="r-test-123",
    status="completed",
    score=85,
    review_excerpt="Looks good overall.",
    findings=[],
    error=None,
)


# ─── Test 1: SES unconfigured → Brevo used directly ──────────────────────────

@pytest.mark.asyncio
async def test_ses_unconfigured_goes_straight_to_brevo():
    """
    When no SES vars are set (ses_configured is False), the orchestrator must
    skip SES entirely — SESEmailClient.__init__ must never be called — and
    send via Brevo.
    """
    from app.notify.email_client import send_review_notification_with_fallback

    settings = _ses_unconfigured_settings()
    assert not settings.ses_configured

    brevo_send = AsyncMock(return_value=None)

    with (
        patch("app.notify.email_client.SESEmailClient") as mock_ses_cls,
        patch("app.notify.email_client.BrevoEmailClient.send_review_notification", brevo_send),
    ):
        provider = await send_review_notification_with_fallback(
            settings=settings, **_NOTIF_KWARGS
        )

    assert provider == "brevo"
    mock_ses_cls.assert_not_called()          # SES constructor never invoked
    brevo_send.assert_awaited_once()          # Brevo was called exactly once


# ─── Test 2: SES configured but MessageRejected → Brevo fallback ─────────────

@pytest.mark.asyncio
async def test_ses_message_rejected_falls_back_to_brevo(caplog):
    """
    When SES raises MessageRejected, the orchestrator must:
    - Log at WARNING level (not ERROR)
    - Fall back to Brevo successfully
    - Return "brevo" as the provider used
    """
    from app.notify.email_client import send_review_notification_with_fallback

    settings = _ses_configured_settings()
    assert settings.ses_configured

    ses_exc = _make_client_error("MessageRejected", "Email address is not verified.")
    brevo_send = AsyncMock(return_value=None)

    with (
        patch(
            "app.notify.email_client.SESEmailClient.send_review_notification",
            side_effect=ses_exc,
        ),
        patch(
            "app.notify.email_client.BrevoEmailClient.send_review_notification",
            brevo_send,
        ),
        caplog.at_level(logging.WARNING, logger="app.notify.email_client"),
    ):
        provider = await send_review_notification_with_fallback(
            settings=settings, **_NOTIF_KWARGS
        )

    assert provider == "brevo"
    brevo_send.assert_awaited_once()

    # A warning (not an error) must have been emitted about the SES failure
    warning_records = [
        r for r in caplog.records
        if r.levelno == logging.WARNING and "SES" in r.message
    ]
    assert warning_records, "Expected at least one WARNING log mentioning SES"

    # No ERROR-level logs should have been emitted
    error_records = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert not error_records, f"Unexpected ERROR log: {error_records}"


# ─── Test 3: SES succeeds → Brevo never called ───────────────────────────────

@pytest.mark.asyncio
async def test_ses_success_brevo_never_called():
    """
    When SES sends successfully, Brevo must never be attempted and
    the returned provider must be "ses".
    """
    from app.notify.email_client import send_review_notification_with_fallback

    settings = _ses_configured_settings()
    assert settings.ses_configured

    ses_send = AsyncMock(return_value=None)
    brevo_send = AsyncMock(return_value=None)

    with (
        patch(
            "app.notify.email_client.SESEmailClient.send_review_notification",
            ses_send,
        ),
        patch(
            "app.notify.email_client.BrevoEmailClient.send_review_notification",
            brevo_send,
        ),
    ):
        provider = await send_review_notification_with_fallback(
            settings=settings, **_NOTIF_KWARGS
        )

    assert provider == "ses"
    ses_send.assert_awaited_once()
    brevo_send.assert_not_awaited()   # Brevo must never be called


# ─── Test 4: Both fail → email_error set, status unaffected ──────────────────

@pytest.mark.asyncio
async def test_both_providers_fail_email_error_set_status_unaffected(
    db_engine, monkeypatch
):
    """
    When both SES and Brevo raise exceptions:
    - review.email_error must be set to the last exception message
    - review.email_sent must remain False
    - review.status must NOT be changed (remains "completed")
    This mirrors the existing failure-isolation contract in test_email_client.py.
    """
    from app.tasks import _persist_report

    factory = _make_session_factory(db_engine)
    import app.db.session as db_session_mod

    monkeypatch.setattr(db_session_mod, "_session_factory", factory)
    monkeypatch.setattr(db_session_mod, "get_session", db_session_mod.get_session)

    brevo_exc = RuntimeError("Brevo is also down")

    with (
        patch("app.config.get_settings") as mock_settings,
        patch(
            "app.notify.email_client.SESEmailClient.send_review_notification",
            side_effect=_make_client_error("ServiceUnavailable", "SES unavailable"),
        ),
        patch(
            "app.notify.email_client.BrevoEmailClient.send_review_notification",
            side_effect=brevo_exc,
        ),
    ):
        settings = _ses_configured_settings()
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
            # Status must NOT be affected by email failures
            assert review.status == "completed"
            assert review.email_sent is False
            assert review.email_error is not None
            assert "Brevo is also down" in review.email_error


# ─── Test 5: email_provider_used recorded correctly via _send_notification ────

@pytest.mark.asyncio
async def test_email_provider_used_recorded_in_db(db_engine, monkeypatch):
    """
    After a successful send via Brevo (SES unconfigured), the DB row must have
    email_provider_used == "brevo".
    """
    from app.tasks import _persist_report

    factory = _make_session_factory(db_engine)
    import app.db.session as db_session_mod

    monkeypatch.setattr(db_session_mod, "_session_factory", factory)
    monkeypatch.setattr(db_session_mod, "get_session", db_session_mod.get_session)

    brevo_send = AsyncMock(return_value=None)

    with (
        patch("app.config.get_settings") as mock_settings,
        patch(
            "app.notify.email_client.BrevoEmailClient.send_review_notification",
            brevo_send,
        ),
    ):
        settings = _ses_unconfigured_settings()  # SES not configured
        mock_settings.return_value = settings

        review_id = str(uuid.uuid4())
        async with factory() as session:
            session.add(
                Review(
                    id=review_id,
                    repo_url="https://github.com/owner/repo",
                    pr_number=5,
                    user_id="u",
                    user_email="user@test.com",
                    status="running",
                )
            )
            await session.commit()

        stub_report = ReviewReport(score=75, review="LGTM.", improvements=[], bugs=[])
        await _persist_report(review_id, stub_report)

        async with factory() as session:
            review = await session.get(Review, review_id)
            assert review is not None
            assert review.email_sent is True
            assert review.email_provider_used == "brevo"
