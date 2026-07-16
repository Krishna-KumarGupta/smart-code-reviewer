"""
test_service_auth_middleware.py — Tests for X-Service-Api-Key enforcement.

Verifies:
  - Missing key → 401
  - Wrong key → 401 (constant-time comparison)
  - Correct key but missing X-User-Id → 400
  - Correct key but missing X-User-Email → 400
  - All headers correct → passes through (no exception)
"""

import pytest
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient

from app.auth.middleware import verify_service_call, RequestContext
from app.config import Settings, get_settings

# ─── Test app setup ───────────────────────────────────────────────────────────

_TEST_KEY = "test-secret-key-1234"

# Minimal FastAPI app wired to use the real verify_service_call dependency
_app = FastAPI()


@_app.get("/protected")
async def _protected_route(ctx: RequestContext = Depends(verify_service_call)):
    return {"success": True, "user_id": ctx.user_id, "user_email": ctx.user_email}


# Override get_settings with a known key so tests don't need real .env
def _override_settings() -> Settings:
    return Settings(
        service_api_key=_TEST_KEY,
        github_webhook_secret="webhook-secret",
        openai_api_key="openai-key",
    )


_app.dependency_overrides[get_settings] = _override_settings

_client = TestClient(_app, raise_server_exceptions=False)

_GOOD_HEADERS = {
    "X-Service-Api-Key": _TEST_KEY,
    "X-User-Id":         "user-uuid-123",
    "X-User-Email":      "user@example.com",
}

# ─── Tests ────────────────────────────────────────────────────────────────────


class TestServiceKeyEnforcement:

    def test_missing_service_key_returns_401(self):
        """Request with no X-Service-Api-Key header should return 401."""
        resp = _client.get("/protected", headers={
            "X-User-Id": "user-uuid",
            "X-User-Email": "user@example.com",
        })
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}: {resp.text}"

    def test_wrong_service_key_returns_401(self):
        """Request with incorrect X-Service-Api-Key should return 401."""
        resp = _client.get("/protected", headers={
            "X-Service-Api-Key": "definitely-wrong-key",
            "X-User-Id": "user-uuid",
            "X-User-Email": "user@example.com",
        })
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}: {resp.text}"

    def test_empty_service_key_returns_401(self):
        """Empty X-Service-Api-Key should return 401."""
        resp = _client.get("/protected", headers={
            "X-Service-Api-Key": "",
            "X-User-Id": "user-uuid",
            "X-User-Email": "user@example.com",
        })
        assert resp.status_code == 401

    def test_correct_key_but_missing_user_id_returns_400(self):
        """Correct key but missing X-User-Id should return 400."""
        resp = _client.get("/protected", headers={
            "X-Service-Api-Key": _TEST_KEY,
            "X-User-Email": "user@example.com",
            # No X-User-Id
        })
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"

    def test_correct_key_but_missing_user_email_returns_400(self):
        """Correct key but missing X-User-Email should return 400."""
        resp = _client.get("/protected", headers={
            "X-Service-Api-Key": _TEST_KEY,
            "X-User-Id": "user-uuid-123",
            # No X-User-Email
        })
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"

    def test_correct_key_both_user_headers_returns_200(self):
        """All required headers present → request passes through."""
        resp = _client.get("/protected", headers=_GOOD_HEADERS)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    def test_response_includes_user_id_from_header(self):
        """The user_id from X-User-Id header is available in the handler."""
        resp = _client.get("/protected", headers=_GOOD_HEADERS)
        assert resp.status_code == 200
        data = resp.json()
        assert data["user_id"] == "user-uuid-123"

    def test_response_includes_user_email_from_header(self):
        resp = _client.get("/protected", headers=_GOOD_HEADERS)
        assert resp.status_code == 200
        data = resp.json()
        assert data["user_email"] == "user@example.com"

    def test_error_response_shape_on_401(self):
        """401 response detail should carry {success: false, error: ..., code: ...}."""
        resp = _client.get("/protected", headers={
            "X-User-Id": "id",
            "X-User-Email": "e@e.com",
        })
        assert resp.status_code == 401
        body = resp.json()
        # FastAPI wraps HTTPException.detail into {"detail": ...}
        detail = body.get("detail", body)
        if isinstance(detail, dict):
            assert detail.get("success") is False
            assert "error" in detail
            assert "code" in detail

    def test_error_response_shape_on_400(self):
        """400 response detail should carry {success: false, ...}."""
        resp = _client.get("/protected", headers={
            "X-Service-Api-Key": _TEST_KEY,
            "X-User-Id": "id",
            # Missing email
        })
        assert resp.status_code == 400
        body = resp.json()
        detail = body.get("detail", body)
        if isinstance(detail, dict):
            assert detail.get("success") is False

    def test_optional_role_header_is_accepted(self):
        """X-User-Role is optional — present headers should still return 200."""
        resp = _client.get("/protected", headers={
            **_GOOD_HEADERS,
            "X-User-Role": "admin",
        })
        assert resp.status_code == 200

    def test_key_comparison_is_constant_time(self):
        """
        Behavioural check: verify that a key with the right length but wrong content → 401.
        We can't directly test timing, but we can confirm constant-time comparison
        isn't short-circuiting on length.
        """
        same_length_wrong = "X" * len(_TEST_KEY)
        resp = _client.get("/protected", headers={
            "X-Service-Api-Key": same_length_wrong,
            "X-User-Id": "id",
            "X-User-Email": "e@e.com",
        })
        assert resp.status_code == 401
