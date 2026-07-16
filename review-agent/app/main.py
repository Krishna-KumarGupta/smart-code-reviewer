"""
main.py — FastAPI application entrypoint for review-agent.

Route layout:
  POST /webhook/github  — Public, HMAC-authenticated by GitHub signature
  GET  /health          — Public liveness check (no auth)
  POST /reviews         — Service-key protected, enqueues a review job
  GET  /reviews/{id}    — Service-key protected, fetch report by id
  GET  /reviews         — Service-key protected, list reviews for a repo

No CORS middleware — this service is internal-only (no browser calls).
Network posture: must only be reachable from backend (VPC/Docker network).
Service-key check is defense-in-depth on top of network isolation.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import select

from app.auth.middleware import RequestContext, verify_service_call
from app.config import get_settings
from app.db.models import Review
from app.db.session import get_session, init_db
from app.github.webhook import extract_pr_context, parse_webhook_payload, verify_github_signature
from app.models import (
    ReviewListItem,
    ReviewReport,
    ReviewStatusResponse,
    TriggerReviewRequest,
    TriggerReviewResponse,
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    logger.info("[startup] Initialising database")
    await init_db()
    logger.info("[startup] review-agent ready on port %s", get_settings().port)
    yield


# ─── App factory ─────────────────────────────────────────────────────────────

app = FastAPI(
    title="review-agent",
    description=(
        "Internal AI Code Review microservice for Smart Code Reviewer. "
        "Called exclusively server-to-server by `backend`. Not publicly reachable."
    ),
    version="0.1.0",
    docs_url="/docs",  # Enable Swagger UI for dev convenience
    redoc_url=None,
    lifespan=lifespan,
)


# ─── Health check ─────────────────────────────────────────────────────────────

@app.get("/health", tags=["ops"])
async def health() -> dict:
    """
    Liveness probe — no authentication required.
    Returns service status and current timestamp.
    """
    return {
        "success": True,
        "data": {
            "status": "ok",
            "service": "review-agent",
            "version": "0.1.0",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    }


# ─── GitHub webhook ──────────────────────────────────────────────────────────

@app.post("/webhook/github", tags=["webhook"])
async def github_webhook(request: Request) -> Response:
    """
    Receive GitHub webhook events.

    Public endpoint — authenticated exclusively via X-Hub-Signature-256 HMAC.
    NOT protected by X-Service-Api-Key (GitHub calls this directly).

    Returns 202 within 2s; heavy work is enqueued to Celery.
    """
    raw_body = await request.body()
    signature = request.headers.get("x-hub-signature-256")
    event_type = request.headers.get("x-github-event", "")

    logger.info("[webhook] Received event: %s", event_type)

    # ── 1. Verify HMAC signature (MUST be first) ───────────────────────────
    if not verify_github_signature(raw_body, signature):
        logger.warning("[webhook] Signature verification failed")
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"success": False, "error": "Invalid webhook signature"},
        )

    # ── 2. Parse JSON (only after signature confirmed) ─────────────────────
    try:
        payload = parse_webhook_payload(raw_body)
    except ValueError:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"success": False, "error": "Invalid JSON body"},
        )

    # ── 3. Handle ping ─────────────────────────────────────────────────────
    if event_type == "ping":
        return JSONResponse(
            status_code=200,
            content={"success": True, "handled": True, "message": "pong"},
        )

    # ── 4. Handle pull_request ─────────────────────────────────────────────
    if event_type == "pull_request":
        pr_ctx = extract_pr_context(payload)
        if pr_ctx is None:
            return JSONResponse(
                status_code=200,
                content={"success": True, "handled": False, "reason": "ignored_action"},
            )

        # Persist a queued record, then enqueue the Celery task
        review_id = str(uuid.uuid4())
        async with get_session() as session:
            review = Review(
                id=review_id,
                repo_url=pr_ctx["repo_url"],
                pr_number=pr_ctx["pull_number"],
                user_id="webhook",      # Webhook has no user context
                user_email="webhook@github.com",
                status="queued",
            )
            session.add(review)

        _enqueue_pipeline(
            review_id=review_id,
            repo_url=pr_ctx["repo_url"],
            pr_number=pr_ctx["pull_number"],
            clone_url=pr_ctx["clone_url"],
            base_sha=pr_ctx["base_sha"],
            head_sha=pr_ctx["head_sha"],
            user_id="webhook",
            user_email="webhook@github.com",
        )

        logger.info("[webhook] Enqueued review_id=%s for PR #%s", review_id, pr_ctx["pull_number"])
        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content={"success": True, "handled": True, "review_id": review_id},
        )

    # ── 5. Unsupported event ───────────────────────────────────────────────
    return JSONResponse(
        status_code=200,
        content={"success": True, "handled": False, "reason": f"unsupported_event:{event_type}"},
    )


# ─── Reviews — service-key protected ─────────────────────────────────────────

@app.post(
    "/reviews",
    response_model=TriggerReviewResponse,
    status_code=status.HTTP_202_ACCEPTED,
    tags=["reviews"],
)
async def trigger_review(
    body: TriggerReviewRequest,
    ctx: RequestContext = Depends(verify_service_call),
) -> TriggerReviewResponse:
    """
    Trigger a code review for a pull request.

    Requires:
      - X-Service-Api-Key header matching SERVICE_API_KEY
      - X-User-Id and X-User-Email headers (forwarded by backend)

    Returns a review_id that can be polled via GET /reviews/{review_id}.
    """
    review_id = str(uuid.uuid4())

    async with get_session() as session:
        review = Review(
            id=review_id,
            repo_url=body.repo_url,
            pr_number=body.pr_number,
            user_id=ctx.user_id,
            user_email=ctx.user_email,
            status="queued",
        )
        session.add(review)

    # Extract clone URL and SHAs via GitHub API
    try:
        from app.github.client import GitHubClient
        owner, repo_name = _parse_owner_repo(body.repo_url)
        async with GitHubClient() as gh:
            pr_info = await gh.get_pr_info(owner, repo_name, body.pr_number)
            repo_info = await gh.get_repo_info(owner, repo_name)

        clone_url = repo_info["clone_url"]
        head_sha = pr_info["head"]["sha"]
        base_sha = pr_info["base"]["sha"]
    except Exception as exc:
        logger.error("[reviews] Failed to fetch PR info: %s", exc)
        async with get_session() as session:
            review = await session.get(Review, review_id)
            if review:
                review.status = "failed"
                review.error = str(exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"success": False, "error": f"Failed to fetch PR info: {exc}", "code": "GITHUB_API_ERROR"},
        )

    _enqueue_pipeline(
        review_id=review_id,
        repo_url=body.repo_url,
        pr_number=body.pr_number,
        clone_url=clone_url,
        base_sha=base_sha,
        head_sha=head_sha,
        user_id=ctx.user_id,
        user_email=ctx.user_email,
    )

    logger.info("[reviews] Enqueued review_id=%s for %s PR#%s by %s",
                review_id, body.repo_url, body.pr_number, ctx.user_email)
    return TriggerReviewResponse(review_id=review_id, status="queued")


@app.get(
    "/reviews/{review_id}",
    response_model=ReviewStatusResponse,
    tags=["reviews"],
)
async def get_review(
    review_id: str,
    ctx: RequestContext = Depends(verify_service_call),
) -> ReviewStatusResponse:
    """
    Fetch a review report by ID.

    Returns status + full ReviewReport once completed.
    """
    async with get_session() as session:
        review = await session.get(Review, review_id)

    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"success": False, "error": "Review not found", "code": "REVIEW_NOT_FOUND"},
        )

    report: ReviewReport | None = None
    if review.report_json:
        try:
            report = ReviewReport.model_validate_json(review.report_json)
        except Exception:
            pass

    return ReviewStatusResponse(
        review_id=review.id,
        status=review.status,  # type: ignore[arg-type]
        repo_url=review.repo_url,
        pr_number=review.pr_number,
        created_at=review.created_at.isoformat(),
        report=report,
        error=review.error,
    )


@app.get(
    "/reviews",
    response_model=list[ReviewListItem],
    tags=["reviews"],
)
async def list_reviews(
    repo: str | None = Query(None, description="Filter by repo URL"),
    ctx: RequestContext = Depends(verify_service_call),
) -> list[ReviewListItem]:
    """
    List past reviews, optionally filtered by repo URL.
    """
    async with get_session() as session:
        stmt = (
            select(Review)
            .where(Review.user_id == ctx.user_id)
            .order_by(Review.created_at.desc())
            .limit(50)
        )
        if repo:
            stmt = stmt.where(Review.repo_url == repo)
        result = await session.execute(stmt)
        reviews = result.scalars().all()

    items: list[ReviewListItem] = []
    for r in reviews:
        score = None
        finding_count = None
        if r.report_json:
            try:
                data = json.loads(r.report_json)
                score = data.get("score")
                bugs = data.get("bugs") or data.get("findings") or []
                finding_count = len(bugs)
            except Exception:
                pass
        items.append(ReviewListItem(
            review_id=r.id,
            repo_url=r.repo_url,
            pr_number=r.pr_number,
            status=r.status,  # type: ignore[arg-type]
            score=score,
            finding_count=finding_count,
            created_at=r.created_at.isoformat(),
        ))
    return items


# ─── Private helpers ──────────────────────────────────────────────────────────

def _enqueue_pipeline(**kwargs) -> None:
    """Send the pipeline task to Celery (import here to avoid circular imports)."""
    from app.tasks import run_review_pipeline
    run_review_pipeline.delay(**kwargs)


def _parse_owner_repo(repo_url: str) -> tuple[str, str]:
    parts = repo_url.rstrip("/").removesuffix(".git").split("/")
    return parts[-2], parts[-1]
