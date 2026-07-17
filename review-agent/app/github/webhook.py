"""
github/webhook.py — GitHub webhook signature verification.

GitHub signs every webhook delivery with HMAC-SHA256 using the webhook secret.
The signature is sent in the X-Hub-Signature-256 header as "sha256=<hex_digest>".

Security: constant-time comparison (hmac.compare_digest) prevents timing attacks.
"""

import hashlib
import hmac

from app.config import get_settings


def verify_github_signature(raw_body: bytes, signature_header: str | None) -> bool:
    """
    Verify the X-Hub-Signature-256 header against the raw request body.

    Args:
        raw_body:         The raw (unparsed) bytes of the webhook request body.
        signature_header: Value of the X-Hub-Signature-256 header, or None.

    Returns:
        True if the signature is valid; False otherwise.
    """
    settings = get_settings()
    secret = settings.github_webhook_secret

    if not signature_header or not signature_header.startswith("sha256="):
        return False

    received_hex = signature_header.removeprefix("sha256=")

    computed = hmac.new(
        secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(computed, received_hex)


def parse_webhook_payload(raw_body: bytes) -> dict:
    """
    Parse the raw JSON body of a GitHub webhook into a dict.

    Must only be called AFTER verify_github_signature confirms the payload is authentic.
    Raises json.JSONDecodeError if the body is not valid JSON.
    """
    import json  # local import intentional — deferred until after auth

    return json.loads(raw_body.decode("utf-8"))


def extract_pr_context(payload: dict) -> dict | None:
    """
    Extract the fields needed to enqueue a review task from a pull_request payload.

    Returns None if the event action is not one we act on
    (we only review opened / reopened / synchronize).
    """
    action = payload.get("action", "")
    if action not in ("opened", "reopened", "synchronize"):
        return None

    pr = payload.get("pull_request", {})
    repo = payload.get("repository", {})

    return {
        "action": action,
        "pull_number": pr.get("number"),
        "head_sha": pr.get("head", {}).get("sha"),
        "base_sha": pr.get("base", {}).get("sha"),
        "clone_url": repo.get("clone_url"),
        "repo_full_name": repo.get("full_name"),
        "repo_url": repo.get("html_url"),
    }
