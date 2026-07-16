"""
tasks.py — Celery task definitions (pipeline entrypoint).

The main task `run_review_pipeline` orchestrates all pipeline steps:
  - Steps 5a (structure/lint), 5b (impact slice), 5c (circular deps), 5d (OSV)
    run concurrently via asyncio.gather.
  - Step 5e (LLM review) depends on 5b output.
  - Results are merged, scored, and persisted to the DB.

Celery tasks are synchronous; we use asyncio.run() to run async code inside.
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from app.celery_app import celery_app

logger = logging.getLogger(__name__)


def _get_all_files(repo_dir: str) -> list[str]:
    """Return all files in repo_dir as relative paths."""
    base = Path(repo_dir)
    return [
        str(p.relative_to(base))
        for p in base.rglob("*")
        if p.is_file() and not any(
            part.startswith(".git") for part in p.parts
        )
    ]


@celery_app.task(
    bind=True,
    name="review_agent.run_review_pipeline",
    max_retries=2,
    default_retry_delay=30,
    acks_late=True,
)
def run_review_pipeline(
    self,
    review_id: str,
    repo_url: str,
    pr_number: int,
    clone_url: str,
    base_sha: str,
    head_sha: str,
    user_id: str,
    user_email: str,
) -> dict:
    """
    Full review pipeline for a single PR.

    Runs inside a Celery worker. Uses asyncio.run() for async steps.
    Persists status updates and final report to the DB.
    """
    return asyncio.run(
        _run_async(self, review_id, repo_url, pr_number, clone_url,
                   base_sha, head_sha, user_id, user_email)
    )


async def _run_async(
    task,
    review_id: str,
    repo_url: str,
    pr_number: int,
    clone_url: str,
    base_sha: str,
    head_sha: str,
    user_id: str,
    user_email: str,
) -> dict:
    """Async implementation of the pipeline (called via asyncio.run)."""
    from app.db.session import get_session, init_db
    from app.db.models import Review

    from app.github.client import GitHubClient
    from app.repo.fetch import blobless_clone, cleanup_clone, is_docs_only
    from app.repo.diff import extract_diff_hunks
    from app.slicing.graph import build_impact_slices
    from app.slicing.budget import apply_token_budget, format_slices_for_llm
    from app.structure.checker import check_layout, detect_stack
    from app.structure.linters import run_linters
    from app.structure.circular_deps import detect_circular_dependencies
    from app.vuln.osv_runner import run_osv_scanner
    from app.vuln.osv_parser import parse_osv_output
    from app.review.llm_client import LLMReviewClient
    from app.merge.report import build_report
    from app.config import get_settings

    settings = get_settings()
    await init_db()

    # ── Mark as running ───────────────────────────────────────────────────────
    async with get_session() as session:
        review = await session.get(Review, review_id)
        if review:
            review.status = "running"

    tmpdir: str | None = None

    try:
        # ── Pre-check: docs/asset only? ───────────────────────────────────────
        async with GitHubClient() as gh:
            pr_files = await gh.get_pr_files(
                *_parse_owner_repo(repo_url), pr_number
            )

        changed_files = [f["filename"] for f in pr_files]

        if is_docs_only(changed_files):
            logger.info("[tasks] PR %d is docs-only — generating trivial passing report", pr_number)
            report = build_report([], [], [], [], [],
                                  "This PR contains only documentation or asset changes.",
                                  ["No code changes detected — nothing to review."])
            await _persist_report(review_id, report)
            return report.model_dump()

        # ── Clone repository ──────────────────────────────────────────────────
        tmpdir = await blobless_clone(clone_url, base_sha, head_sha)
        all_files = _get_all_files(tmpdir)

        diff_hunks = extract_diff_hunks(pr_files)

        # ── Steps 5a / 5c / 5d run concurrently ──────────────────────────────
        stack = detect_stack(tmpdir)

        layout_task = asyncio.create_task(
            _run_layout(tmpdir, all_files)
        )
        lint_task = asyncio.create_task(run_linters(tmpdir, stack))
        circ_task = asyncio.create_task(
            asyncio.to_thread(detect_circular_dependencies, tmpdir, all_files)
        )
        osv_task = asyncio.create_task(_run_osv(tmpdir))

        layout_findings, lint_findings, circular_findings, osv_vulns = await asyncio.gather(
            layout_task, lint_task, circ_task, osv_task
        )

        # ── Step 5b: Impact slicing ────────────────────────────────────────────
        raw_slices = await asyncio.to_thread(
            build_impact_slices, tmpdir, diff_hunks, all_files
        )
        budgeted_slices = apply_token_budget(raw_slices, settings.impact_slice_max_tokens)
        slices_text = format_slices_for_llm(budgeted_slices)

        # ── Step 5e: LLM review ────────────────────────────────────────────────
        diff_context = _format_diff_context(pr_files)
        diff_file_set = set(changed_files)

        llm_client = LLMReviewClient()
        review_text, improvements, llm_findings = await asyncio.to_thread(
            llm_client.review,
            diff_context,
            slices_text,
            lint_findings,
            circular_findings,
            diff_file_set,
        )

        # ── Merge & score ─────────────────────────────────────────────────────
        report = build_report(
            osv_vulns=osv_vulns,
            lint_findings=lint_findings,
            circular_findings=circular_findings,
            layout_findings=layout_findings,
            llm_findings=llm_findings,
            review_text=review_text,
            improvements=improvements,
        )

        await _persist_report(review_id, report)
        return report.model_dump()

    except Exception as exc:
        logger.exception("[tasks] Pipeline failed for review_id=%s: %s", review_id, exc)
        async with get_session() as session:
            review = await session.get(Review, review_id)
            if review:
                review.status = "failed"
                review.error = str(exc)
        await _send_notification_safely(review_id)
        raise

    finally:
        if tmpdir:
            cleanup_clone(tmpdir)
        # Dispose engine + reset singletons so the *next* task's asyncio.run()
        # starts with a fresh connection pool not bound to this (now closing)
        # event loop.  Without this, asyncpg raises "Event loop is closed".
        from app.db.session import dispose_engine
        await dispose_engine()


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _parse_owner_repo(repo_url: str) -> tuple[str, str]:
    """Extract owner and repo name from an HTTPS GitHub URL."""
    # https://github.com/owner/repo  or  https://github.com/owner/repo.git
    parts = repo_url.rstrip("/").rstrip(".git").split("/")
    return parts[-2], parts[-1]


async def _run_layout(repo_dir: str, all_files: list[str]):
    from app.structure.checker import check_layout
    findings, _ = check_layout(repo_dir, all_files)
    return findings


async def _run_osv(repo_dir: str):
    from app.vuln.osv_runner import run_osv_scanner
    from app.vuln.osv_parser import parse_osv_output
    raw = await run_osv_scanner(repo_dir)
    return parse_osv_output(raw, repo_dir)


def _format_diff_context(pr_files: list[dict]) -> str:
    """Build a compact diff string for the LLM user message."""
    parts: list[str] = []
    for f in pr_files:
        patch = f.get("patch", "")
        if patch:
            parts.append(f"### {f['filename']}\n```diff\n{patch}\n```")
    return "\n\n".join(parts)


async def _persist_report(review_id: str, report) -> None:
    from app.db.session import get_session
    from app.db.models import Review

    async with get_session() as session:
        review = await session.get(Review, review_id)
        if review:
            review.status = "completed"
            review.report_json = report.model_dump_json()

    await _send_notification_safely(review_id)


async def _send_notification_safely(review_id: str) -> None:
    """
    Look up the review by ID, check if email has been sent, and send it if not.
    Catches any exception, updates the DB with email_error on failure,
    or marks email_sent=True on success.
    """
    from app.config import get_settings
    from app.db.session import get_session
    from app.db.models import Review
    from app.notify.email_client import get_email_client
    import json

    settings = get_settings()
    if not settings.email_enabled:
        logger.debug("[email] Email notifications are disabled via kill switch.")
        return

    async with get_session() as session:
        review = await session.get(Review, review_id)
        if not review:
            logger.warning("[email] Review %s not found for notification.", review_id)
            return

        if review.email_sent:
            logger.info("[email] Email already sent for review %s. Skipping.", review_id)
            return

        to_email = review.user_email
        if to_email == "webhook@github.com" or not to_email:
            logger.info("[email] Review %s created by webhook or missing user email. Skipping email.", review_id)
            return

        # Extract repo name
        parts = review.repo_url.rstrip("/").rstrip(".git").split("/")
        repo_name = parts[-1] if parts else "Unknown Repo"

        pr_number = review.pr_number
        status = review.status
        error_msg = review.error

        # Default empty fields
        score = None
        review_excerpt = ""
        findings = []

        if review.report_json:
            try:
                report_data = json.loads(review.report_json)
                score = report_data.get("score")
                review_excerpt = report_data.get("review", "")
                findings = report_data.get("bugs", [])
            except Exception as e:
                logger.error("[email] Failed to parse report_json: %s", e)

        # Call notify client
        try:
            client = get_email_client(settings)
            await client.send_review_notification(
                to_email=to_email,
                repo_name=repo_name,
                pr_number=pr_number,
                review_id=review_id,
                status=status,
                score=score,
                review_excerpt=review_excerpt,
                findings=findings,
                error=error_msg,
            )
            # Update database status on success
            review.email_sent = True
            review.email_error = None
            logger.info("[email] Successfully sent email for review %s to %s", review_id, to_email)
        except Exception as exc:
            logger.warning("[email] Failed to send email for review %s: %s", review_id, exc)
            review.email_sent = False
            review.email_error = str(exc)
