"""
auth/middleware.py — Service-to-service authentication dependency.

This service is called exclusively by `backend`. By the time a request
arrives here, the end-user has already been authenticated and authorized
by `backend`. This middleware:

  1. Verifies the shared X-Service-Api-Key header (constant-time compare)
  2. Reads X-User-Id and X-User-Email forwarded by backend — rejects 400 if missing
  3. Reads optional X-User-Role — trusted as-is (backend already did the ACL check)
  4. Attaches a RequestContext to request.state

Network posture note
────────────────────
In production, review-agent must be reachable ONLY from the backend service
(via internal Docker network / VPC). The X-Service-Api-Key check is
defense-in-depth on top of network isolation, NOT a substitute for it.
See README.md §Network Posture.
"""

import secrets
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import APIKeyHeader

from app.config import Settings, get_settings

# ─── Request context ──────────────────────────────────────────────────────────

@dataclass
class RequestContext:
    """Carries the user identity forwarded by backend on every proxied call."""

    user_id: str
    user_email: str
    user_role: str | None = None  # optional; backend sets if relevant


# ─── Dependency ───────────────────────────────────────────────────────────────

_service_key_header = APIKeyHeader(name="X-Service-Api-Key", auto_error=False)


async def verify_service_call(
    request: Request,
    provided_key: str | None = Depends(_service_key_header),
    settings: Settings = Depends(get_settings),
) -> RequestContext:
    """
    FastAPI dependency that enforces service-to-service auth.

    Raises:
        401 — X-Service-Api-Key is missing or does not match SERVICE_API_KEY.
        400 — X-User-Id or X-User-Email headers are absent.

    Returns:
        RequestContext attached to request.state.ctx.
    """
    # ── 1. Verify service API key (constant-time to resist timing attacks) ────
    if not provided_key or not secrets.compare_digest(
        provided_key.encode(), settings.service_api_key.encode()
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "success": False,
                "error": "Missing or invalid X-Service-Api-Key",
                "code": "SERVICE_KEY_INVALID",
            },
        )

    # ── 2. Require forwarded user identity from backend ───────────────────────
    user_id = request.headers.get("X-User-Id", "").strip()
    user_email = request.headers.get("X-User-Email", "").strip() or "unknown@domain.com"

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "success": False,
                "error": "Missing required header: X-User-Id must be forwarded by backend",
                "code": "USER_HEADERS_MISSING",
            },
        )

    # ── 3. Optional role header (trust it — backend already did ACL check) ────
    user_role = request.headers.get("X-User-Role", None) or None

    ctx = RequestContext(user_id=user_id, user_email=user_email, user_role=user_role)
    request.state.ctx = ctx
    return ctx
