from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.config import Settings
from app.db.models import Review
from app.models import ReviewReport, DiffHunk
from app.notify.github_comment import build_pr_review_payload, post_github_comment

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
        # Apply columns for table schema migration as done in init_db
        from sqlalchemy import text
        try:
            await conn.execute(text("ALTER TABLE reviews ADD COLUMN github_comment_posted BOOLEAN NOT NULL DEFAULT FALSE"))
        except Exception:
            pass
        try:
            await conn.execute(text("ALTER TABLE reviews ADD COLUMN github_comment_error TEXT"))
        except Exception:
            pass
    return engine


@pytest_asyncio.fixture()
async def db_engine():
    engine = await _build_test_engine()
    yield engine
    await engine.dispose()


def _make_session_factory(engine):
    return async_sessionmaker(bind=engine, expire_on_commit=False, class_=AsyncSession)


def test_build_pr_review_payload_filtering():
    """
    - A finding within a diff hunk's changed lines produces an inline comment; a finding outside it does not.
    - A finding with line_start: null never gets attempted as inline.
    """
    settings = Settings(service_api_key="key", openai_api_key="key")
    settings.github_comment_enabled = True
    settings.frontend_review_url_base = "http://localhost:5173/reviews"

    diff_hunks = [
        DiffHunk(file="src/main.py", line_start=10, line_end=20, content=""),
        DiffHunk(file="src/utils.py", line_start=5, line_end=15, content=""),
    ]

    findings = [
        # Inside main.py hunk -> inline
        {
            "file": "src/main.py",
            "line_start": 12,
            "line_end": 12,
            "source": "llm",
            "severity": "critical",
            "description": "Critical security bug in main",
            "suggested_fix": "Fix main",
        },
        # Outside main.py hunk -> body
        {
            "file": "src/main.py",
            "line_start": 5,
            "line_end": 5,
            "source": "lint",
            "severity": "low",
            "description": "Lint issue in main",
        },
        # Inside utils.py hunk -> inline
        {
            "file": "src/utils.py",
            "line_start": 7,
            "line_end": 7,
            "source": "osv",
            "severity": "high",
            "description": "OSV vuln in utils",
        },
        # line_start is null -> body
        {
            "file": "src/main.py",
            "line_start": None,
            "line_end": None,
            "source": "osv",
            "severity": "medium",
            "description": "Transitive OSV vuln",
        },
    ]

    body, comments = build_pr_review_payload(
        review_id="r123",
        score=85,
        review_narrative="Nice PR",
        findings=findings,
        diff_hunks=diff_hunks,
        max_inline=15,
        settings=settings,
    )

    assert len(comments) == 2
    # Verify the inline comments are correct
    assert comments[0]["path"] == "src/main.py"
    assert comments[0]["line"] == 12
    assert "Critical security bug" in comments[0]["body"]

    assert comments[1]["path"] == "src/utils.py"
    assert comments[1]["line"] == 7
    assert "OSV vuln" in comments[1]["body"]

    # Verify body contains the non-inline issues and findings summary
    assert "🔴 Critical: 1   🟠 High: 1   🟡 Medium: 1   🔵 Low: 1" in body
    assert "Transitive OSV vuln" in body
    assert "Lint issue in main" in body
    assert "http://localhost:5173/reviews/r123" in body


def test_build_pr_review_payload_cap():
    """
    - If findings exceed the max_inline cap, they should go to the body instead.
    """
    settings = Settings(service_api_key="key", openai_api_key="key")
    settings.github_comment_enabled = True

    diff_hunks = [
        DiffHunk(file="src/main.py", line_start=1, line_end=100, content=""),
    ]

    # Generate 5 qualifying inline findings
    findings = [
        {
            "file": "src/main.py",
            "line_start": i,
            "line_end": i,
            "source": "llm",
            "severity": "critical" if i == 1 else "low",
            "description": f"Bug {i}",
        }
        for i in range(1, 6)
    ]

    body, comments = build_pr_review_payload(
        review_id="r123",
        score=90,
        review_narrative="Narrative",
        findings=findings,
        diff_hunks=diff_hunks,
        max_inline=2,  # Cap at 2 inline comments
        settings=settings,
    )

    assert len(comments) == 2
    # The first inline comments should be sorted by severity (critical, high, medium, low)
    # Bug 1 is critical, others are low.
    assert comments[0]["line"] == 1  # Bug 1
    # Bug 2 to 5 are low, one of them will be the second comment
    # The rest (3 findings) should go to the body
    assert "Bug 4" in body or "Bug 5" in body or "Bug 3" in body


@pytest.mark.asyncio
@patch("app.github.client.GitHubClient.post_pr_review")
@patch("app.github.client.GitHubClient.get_pr_files")
async def test_github_comment_disabled_no_api_call(mock_get_files, mock_post_review):
    """
    - github_comment_enabled=False results in no GitHub API call at all.
    """
    settings = Settings(service_api_key="key", openai_api_key="key")
    settings.github_comment_enabled = False

    await post_github_comment(
        review_id="r123",
        repo_url="https://github.com/owner/repo",
        pr_number=1,
        score=90,
        review_narrative="Ok",
        findings=[],
        pr_files=None,
        settings=settings,
    )

    mock_get_files.assert_not_called()
    mock_post_review.assert_not_called()


@pytest.mark.asyncio
async def test_github_comment_failure_isolation(db_engine, monkeypatch):
    """
    - A GitHub API failure is caught, logged, recorded in github_comment_error,
      and does not affect Review.status (it remains completed).
    """
    from app.tasks import _persist_report

    factory = _make_session_factory(db_engine)
    import app.db.session as db_session_mod

    monkeypatch.setattr(db_session_mod, "_session_factory", factory)
    monkeypatch.setattr(db_session_mod, "get_session", db_session_mod.get_session)

    with (
        patch("app.config.get_settings") as mock_settings,
        patch(
            "app.github.client.GitHubClient.post_pr_review",
            side_effect=RuntimeError("GitHub API Down"),
        ),
    ):
        settings = Settings(service_api_key="key", openai_api_key="key")
        settings.github_comment_enabled = True
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
        # Stub pr_files to avoid fetching from GitHub API
        pr_files = [{"filename": "src/main.py", "patch": "@@ -1,3 +1,3 @@"}]
        await _persist_report(review_id, stub_report, pr_files)

        async with factory() as session:
            review = await session.get(Review, review_id)
            assert review is not None
            assert review.status == "completed"
            assert review.github_comment_posted is False
            assert "GitHub API Down" in str(review.github_comment_error)


@pytest.mark.asyncio
async def test_github_comment_deduplication(db_engine, monkeypatch):
    """
    - Dedup: a review with github_comment_posted=True is not re-commented on retry.
    """
    from app.tasks import _persist_report

    factory = _make_session_factory(db_engine)
    import app.db.session as db_session_mod

    monkeypatch.setattr(db_session_mod, "_session_factory", factory)
    monkeypatch.setattr(db_session_mod, "get_session", db_session_mod.get_session)

    mock_post = AsyncMock()

    with (
        patch("app.config.get_settings") as mock_settings,
        patch("app.github.client.GitHubClient.post_pr_review", mock_post),
    ):
        settings = Settings(service_api_key="key", openai_api_key="key")
        settings.github_comment_enabled = True
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
                    github_comment_posted=True,  # already posted!
                )
            )
            await session.commit()

        stub_report = ReviewReport(score=90, review="All good.", improvements=[], bugs=[])
        pr_files = [{"filename": "src/main.py", "patch": "@@ -1,3 +1,3 @@"}]
        await _persist_report(review_id, stub_report, pr_files)

        mock_post.assert_not_called()
