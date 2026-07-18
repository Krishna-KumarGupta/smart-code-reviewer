"""
test_review_roundtrip.py — Integration tests for the POST /reviews → DB → GET /reviews/{id}
round-trip and the tasks.py status-transition lifecycle.

Verifies:
  1. POST /reviews creates a row in the reviews table with status='queued'.
  2. tasks._run_async transitions that row: queued → running → completed.
  3. tasks._run_async transitions that row: queued → running → failed (on exception).
  4. GET /reviews/{id} reads the live DB row — it is NOT a stub.
  5. GET /reviews/{id} returns 404 for an unknown review_id.

Design notes:
  - We use a per-test in-memory SQLite DB (sqlite+aiosqlite:///:memory:) so tests are
    hermetic and never touch the filesystem.
  - The module-level engine/session singletons in app.db.session are patched via
    monkeypatching before each test group.
  - POST /reviews calls the GitHub API; we mock GitHubClient so no real network I/O
    occurs.
  - tasks._run_async does many pipeline steps (clone, lint, LLM …); for the status-
    transition tests we mock everything *after* the "mark running" DB write so we can
    observe the status sequence in the DB.
"""

from __future__ import annotations

import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx2 import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

# ─── Helpers to build an isolated in-memory DB ───────────────────────────────

_IN_MEMORY_URL = "sqlite+aiosqlite:///:memory:"


async def _build_test_engine():
    """Create a fresh in-memory SQLite engine with all tables.

    Uses StaticPool so that the single underlying SQLite connection (and the
    in-memory database schema that lives on it) survives any dispose() calls
    made by _run_async's finally block.  Without StaticPool, dispose() tears
    down all pool connections, which destroys the :memory: DB entirely and
    causes follow-up session.get() calls to fail with "no such table".
    """
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


def _make_session_factory(engine):
    return async_sessionmaker(bind=engine, expire_on_commit=False, class_=AsyncSession)


# ─── Shared auth headers ──────────────────────────────────────────────────────

_SERVICE_KEY = "test-secret-key-1234"

_AUTH_HEADERS = {
    "X-Service-Api-Key": _SERVICE_KEY,
    "X-User-Id": "user-uuid-test",
    "X-User-Email": "test@example.com",
}


# ─── Fixtures ─────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture()
async def db_engine():
    """Fresh in-memory SQLite engine for one test."""
    engine = await _build_test_engine()
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture()
async def patched_session(db_engine, monkeypatch):
    """
    Patch app.db.session so that every get_session() / get_engine() call in the
    application uses our in-memory DB rather than the file-based test DB or Postgres.

    We also patch dispose_engine() to a no-op coroutine so that _run_async's
    finally block cannot tear down the test engine.  The db_engine fixture is the
    rightful owner of that engine's lifecycle and disposes it in its own teardown.
    """
    import app.db.session as db_session_mod
    from contextlib import asynccontextmanager
    from typing import AsyncGenerator

    factory = _make_session_factory(db_engine)

    # Replace module-level singletons directly so the lazy getters return ours.
    monkeypatch.setattr(db_session_mod, "_engine", db_engine)
    monkeypatch.setattr(db_session_mod, "_session_factory", factory)

    @asynccontextmanager
    async def _get_session() -> AsyncGenerator[AsyncSession, None]:
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    monkeypatch.setattr(db_session_mod, "get_session", _get_session)
    import app.main as main_mod
    monkeypatch.setattr(main_mod, "get_session", _get_session)

    # Patch dispose_engine to a no-op: _run_async's finally block calls this,
    # but the test fixture is the owner of the engine's lifecycle — disposing here
    # would destroy the :memory: schema before the test can read back the results.
    # The db_engine fixture already does await engine.dispose() in its teardown.
    async def _noop_dispose():
        pass

    monkeypatch.setattr(db_session_mod, "dispose_engine", _noop_dispose)

    yield factory


@pytest_asyncio.fixture()
async def http_client(patched_session):
    """
    Async HTTPX test client wired to the real FastAPI app, with:
      - The DB patched to in-memory SQLite (via patched_session fixture)
      - on_startup skipped (we already called init_db via db_engine fixture)
    """
    from contextlib import asynccontextmanager
    from app.main import app

    @asynccontextmanager
    async def noop_lifespan(app):
        yield

    app.router.lifespan_context = noop_lifespan

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


# ─── Test class ───────────────────────────────────────────────────────────────


class TestReviewRoundTrip:
    """End-to-end DB round-trip: POST /reviews → DB → GET /reviews/{id}."""

    # ── 1. POST /reviews creates row with status=queued ───────────────────────

    async def test_post_reviews_creates_queued_row(self, http_client, db_engine):
        """
        POST /reviews must persist a row in the reviews table with status='queued'
        before returning 202.  We mock the GitHub API and Celery so no real I/O happens.
        """
        mock_pr_info = {"head": {"sha": "abc123"}, "base": {"sha": "def456"}}
        mock_repo_info = {"clone_url": "https://github.com/owner/repo.git"}

        mock_gh = AsyncMock()
        mock_gh.get_pr_info.return_value = mock_pr_info
        mock_gh.get_repo_info.return_value = mock_repo_info
        mock_gh.__aenter__ = AsyncMock(return_value=mock_gh)
        mock_gh.__aexit__ = AsyncMock(return_value=False)

        with (
            patch("app.github.client.GitHubClient", return_value=mock_gh),
            patch("app.main._enqueue_pipeline"),   # don't actually call Celery
        ):
            resp = await http_client.post(
                "/reviews",
                json={"repo_url": "https://github.com/owner/repo", "pr_number": 42},
                headers=_AUTH_HEADERS,
            )

        assert resp.status_code == 202, resp.text
        body = resp.json()
        review_id = body["review_id"]
        assert body["status"] == "queued"

        # Directly query the DB to confirm the row was written
        from app.db.models import Review
        factory = _make_session_factory(db_engine)
        async with factory() as session:
            row = await session.get(Review, review_id)

        assert row is not None, "Expected a DB row to be created by POST /reviews"
        assert row.status == "queued", f"Expected status='queued', got {row.status!r}"
        assert row.repo_url == "https://github.com/owner/repo"
        assert row.pr_number == 42
        assert row.user_id == "user-uuid-test"
        assert row.user_email == "test@example.com"

    # ── 2. GET /reviews/{id} reads from DB (not a stub) ──────────────────────

    async def test_get_review_reads_from_db(self, http_client, db_engine):
        """
        GET /reviews/{id} must return data that actually comes from the DB row,
        not a hard-coded stub.  We write a row directly to the DB and then assert
        the API reflects it faithfully.
        """
        review_id = str(uuid.uuid4())
        from app.db.models import Review

        factory = _make_session_factory(db_engine)
        async with factory() as session:
            session.add(Review(
                id=review_id,
                repo_url="https://github.com/acme/widget",
                pr_number=7,
                user_id="u1",
                user_email="u1@acme.com",
                status="queued",
            ))
            await session.commit()

        resp = await http_client.get(f"/reviews/{review_id}", headers=_AUTH_HEADERS)
        assert resp.status_code == 200, resp.text
        data = resp.json()

        assert data["review_id"] == review_id
        assert data["status"] == "queued"
        assert data["report"] is None
        assert data["error"] is None

    async def test_get_review_returns_404_for_unknown_id(self, http_client):
        """GET /reviews/{id} must return 404 when the review_id does not exist."""
        resp = await http_client.get(
            f"/reviews/{uuid.uuid4()}",
            headers=_AUTH_HEADERS,
        )
        assert resp.status_code == 404, resp.text

    # ── 3. GET /reviews/{id} reflects DB changes (status + report) ───────────

    async def test_get_review_reflects_completed_status_and_report(
        self, http_client, db_engine
    ):
        """
        Once a row's status is updated to 'completed' and report_json is written,
        GET /reviews/{id} must surface those values — proving it reads live DB state.
        """
        review_id = str(uuid.uuid4())
        from app.db.models import Review
        from app.models import ReviewReport, Bug

        report = ReviewReport(
            score=85,
            review="Looks good.",
            improvements=["Add tests"],
            bugs=[
                Bug(
                    file="app/main.py",
                    line_start=10,
                    line_end=10,
                    source="lint",
                    severity="low",
                    description="Unused import",
                )
            ],
        )

        factory = _make_session_factory(db_engine)
        async with factory() as session:
            session.add(Review(
                id=review_id,
                repo_url="https://github.com/acme/widget",
                pr_number=8,
                user_id="u2",
                user_email="u2@acme.com",
                status="completed",
                report_json=report.model_dump_json(),
            ))
            await session.commit()

        resp = await http_client.get(f"/reviews/{review_id}", headers=_AUTH_HEADERS)
        assert resp.status_code == 200, resp.text
        data = resp.json()

        assert data["status"] == "completed"
        assert data["report"] is not None
        assert data["report"]["score"] == 85
        assert data["report"]["review"] == "Looks good."
        assert len(data["report"]["bugs"]) == 1
        assert data["report"]["bugs"][0]["file"] == "app/main.py"

    async def test_list_reviews_only_returns_own_reviews(self, http_client, db_engine):
        """
        GET /reviews must only return reviews belonging to the user authenticated
        via the request headers (X-User-Id). Reviews for other users should not appear.
        """
        from app.db.models import Review

        factory = _make_session_factory(db_engine)
        async with factory() as session:
            # Review for the current user in _AUTH_HEADERS ("user-uuid-test")
            session.add(Review(
                id=str(uuid.uuid4()),
                repo_url="https://github.com/acme/my-repo",
                pr_number=1,
                user_id="user-uuid-test",
                user_email="test@example.com",
                status="completed",
            ))
            # Review for a different user
            session.add(Review(
                id=str(uuid.uuid4()),
                repo_url="https://github.com/acme/other-repo",
                pr_number=2,
                user_id="different-user-uuid",
                user_email="other@example.com",
                status="completed",
            ))
            await session.commit()

        # Call the GET /reviews endpoint with the standard headers (X-User-Id: user-uuid-test)
        resp = await http_client.get("/reviews", headers=_AUTH_HEADERS)
        assert resp.status_code == 200, resp.text
        data = resp.json()

        # Should only return 1 review, which belongs to "user-uuid-test"
        assert len(data) == 1
        assert data[0]["repo_url"] == "https://github.com/acme/my-repo"


# ─── Test class: tasks.py status transitions ──────────────────────────────────


class TestTasksStatusTransitions:
    """
    Verify that tasks._run_async updates the DB row through the expected
    status sequence without exercising real cloning, linting, or LLM calls.
    """

    async def test_successful_pipeline_transitions_queued_running_completed(
        self, db_engine, patched_session
    ):
        """
        A successful pipeline run must leave the row with status='completed'
        and a non-null report_json.
        """
        review_id = str(uuid.uuid4())
        from app.db.models import Review
        from app.models import ReviewReport

        # Seed the row (simulating what POST /reviews would have done)
        factory = _make_session_factory(db_engine)
        async with factory() as session:
            session.add(Review(
                id=review_id,
                repo_url="https://github.com/owner/repo",
                pr_number=1,
                user_id="u",
                user_email="u@x.com",
                status="queued",
            ))
            await session.commit()

        # Minimal stub report that _persist_report will serialize
        stub_report = ReviewReport(
            score=90, review="All good.", improvements=[], bugs=[]
        )

        # We patch the heavy-lifting parts of _run_async so the test is fast:
        #   - GitHubClient (pr_files fetch)
        #   - blobless_clone / cleanup_clone
        #   - detect_stack, _run_layout, run_linters, detect_circular_dependencies,
        #     _run_osv, build_impact_slices, apply_token_budget, format_slices_for_llm
        #   - LLMReviewClient.review
        #   - build_report → returns stub_report

        _pr_files = [{"filename": "app/main.py", "patch": "@@ -1 +1 @@\n+x = 1"}]

        mock_gh = AsyncMock()
        mock_gh.get_pr_files.return_value = _pr_files
        mock_gh.__aenter__ = AsyncMock(return_value=mock_gh)
        mock_gh.__aexit__ = AsyncMock(return_value=False)

        with (
            patch("app.github.client.GitHubClient", return_value=mock_gh),
            patch("app.repo.fetch.blobless_clone", new=AsyncMock(return_value="/tmp/fake")),
            patch("app.repo.fetch.cleanup_clone"),
            patch("app.repo.fetch.is_docs_only", return_value=False),
            patch("app.tasks._get_all_files", return_value=["app/main.py"]),
            patch("app.structure.checker.detect_stack", return_value="python"),
            patch("app.tasks._run_layout", new=AsyncMock(return_value=[])),
            patch("app.structure.linters.run_linters", new=AsyncMock(return_value=[])),
            patch(
                "app.structure.circular_deps.detect_circular_dependencies",
                return_value=[],
            ),
            patch("app.tasks._run_osv", new=AsyncMock(return_value=[])),
            patch("app.slicing.graph.build_impact_slices", return_value=[]),
            patch("app.slicing.budget.apply_token_budget", return_value=[]),
            patch("app.slicing.budget.format_slices_for_llm", return_value=""),
            patch("app.repo.diff.extract_diff_hunks", return_value=[]),
            patch(
                "app.review.llm_client.LLMReviewClient",
                return_value=MagicMock(
                    review=MagicMock(return_value=("All good.", [], []))
                ),
            ),
            patch("app.merge.report.build_report", return_value=stub_report),
        ):
            from app.tasks import _run_async

            await _run_async(
                task=MagicMock(),
                review_id=review_id,
                repo_url="https://github.com/owner/repo",
                pr_number=1,
                clone_url="https://github.com/owner/repo.git",
                base_sha="base",
                head_sha="head",
                user_id="u",
                user_email="u@x.com",
            )

        # Check final DB state
        async with factory() as session:
            row = await session.get(Review, review_id)

        assert row is not None
        assert row.status == "completed", f"Expected completed, got {row.status!r}"
        assert row.report_json is not None, "report_json must be set after successful pipeline"

        # Validate report_json is parseable and correct
        parsed = ReviewReport.model_validate_json(row.report_json)
        assert parsed.score == 90

    async def test_failed_pipeline_sets_status_failed(
        self, db_engine, patched_session
    ):
        """
        When the pipeline raises an exception after marking the row 'running',
        tasks._run_async must catch it, set status='failed', and store error text.
        """
        review_id = str(uuid.uuid4())
        from app.db.models import Review

        factory = _make_session_factory(db_engine)
        async with factory() as session:
            session.add(Review(
                id=review_id,
                repo_url="https://github.com/owner/repo",
                pr_number=2,
                user_id="u",
                user_email="u@x.com",
                status="queued",
            ))
            await session.commit()

        boom = RuntimeError("simulated pipeline crash")

        mock_gh = AsyncMock()
        mock_gh.get_pr_files.side_effect = boom
        mock_gh.__aenter__ = AsyncMock(return_value=mock_gh)
        mock_gh.__aexit__ = AsyncMock(return_value=False)

        with (
            patch("app.github.client.GitHubClient", return_value=mock_gh),
            patch("app.repo.fetch.is_docs_only", return_value=False),
        ):
            from app.tasks import _run_async

            with pytest.raises(RuntimeError, match="simulated pipeline crash"):
                await _run_async(
                    task=MagicMock(),
                    review_id=review_id,
                    repo_url="https://github.com/owner/repo",
                    pr_number=2,
                    clone_url="https://github.com/owner/repo.git",
                    base_sha="base",
                    head_sha="head",
                    user_id="u",
                    user_email="u@x.com",
                )

        async with factory() as session:
            row = await session.get(Review, review_id)

        assert row is not None
        assert row.status == "failed", f"Expected failed, got {row.status!r}"
        assert row.error is not None
        assert "simulated pipeline crash" in row.error

    async def test_running_status_is_set_before_any_pipeline_work(
        self, db_engine, patched_session
    ):
        """
        The very first thing _run_async does (after initialising) is mark the row
        'running'.  We verify this by making the subsequent step (GitHubClient call)
        raise immediately, then check that the DB write for 'running' DID happen
        before the error set status to 'failed'.

        This guards against a regression where the running-update is accidentally
        placed after the first I/O call.
        """
        review_id = str(uuid.uuid4())
        from app.db.models import Review

        factory = _make_session_factory(db_engine)
        async with factory() as session:
            session.add(Review(
                id=review_id,
                repo_url="https://github.com/owner/repo",
                pr_number=3,
                user_id="u",
                user_email="u@x.com",
                status="queued",
            ))
            await session.commit()

        # Track every status value the task writes to the DB
        status_log: list[str] = []

        import app.db.session as db_session_mod
        _original_get_session = db_session_mod.get_session

        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def _spying_get_session():
            async with _original_get_session() as session:
                # Wrap commit to snapshot statuses after each write
                _orig_commit = session.commit

                async def _spying_commit():
                    # Flush first so the identity map has updated values
                    await session.flush()
                    row = await session.get(Review, review_id)
                    if row:
                        status_log.append(row.status)
                    await _orig_commit()

                session.commit = _spying_commit
                yield session

        mock_gh = AsyncMock()
        mock_gh.get_pr_files.side_effect = RuntimeError("bang")
        mock_gh.__aenter__ = AsyncMock(return_value=mock_gh)
        mock_gh.__aexit__ = AsyncMock(return_value=False)

        with (
            patch.object(db_session_mod, "get_session", _spying_get_session),
            patch("app.github.client.GitHubClient", return_value=mock_gh),
            patch("app.repo.fetch.is_docs_only", return_value=False),
        ):
            from app.tasks import _run_async

            with pytest.raises(RuntimeError):
                await _run_async(
                    task=MagicMock(),
                    review_id=review_id,
                    repo_url="https://github.com/owner/repo",
                    pr_number=3,
                    clone_url="https://github.com/owner/repo.git",
                    base_sha="base",
                    head_sha="head",
                    user_id="u",
                    user_email="u@x.com",
                )

        # The sequence must be: running first, then failed
        assert "running" in status_log, f"'running' never written to DB; log={status_log}"
        assert "failed" in status_log, f"'failed' never written to DB; log={status_log}"
        running_idx = next(i for i, s in enumerate(status_log) if s == "running")
        failed_idx = next(i for i, s in enumerate(status_log) if s == "failed")
        assert running_idx < failed_idx, (
            f"'running' (idx={running_idx}) must come before 'failed' (idx={failed_idx}); "
            f"log={status_log}"
        )
