from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path
from typing import Any, Protocol

from app.config import get_settings

logger = logging.getLogger(__name__)


# ─── Protocol ────────────────────────────────────────────────────────────────

class EmailClient(Protocol):
    """Protocol for sending code review email notifications."""

    async def send_review_notification(
        self,
        to_email: str,
        repo_name: str,
        pr_number: int,
        review_id: str,
        status: str,
        score: int | None,
        review_excerpt: str,
        findings: list[dict[str, Any]],
        error: str | None,
    ) -> None:
        """Send a completed or failed review notification email."""
        ...


# ─── Template parsing ─────────────────────────────────────────────────────────

def parse_templates() -> tuple[str, str, str, str]:
    """Parse the email HTML templates and plain text fallbacks from review-agent-email-templates.html."""
    template_path = Path(__file__).parent.parent.parent / "review-agent-email-templates.html"
    if not template_path.exists():
        raise FileNotFoundError(f"Email templates file not found at {template_path}")

    content = template_path.read_text(encoding="utf-8")

    # Extract HTML Success & Failure
    html_blocks = re.findall(r"(<!DOCTYPE html>.*?</html>)", content, re.DOTALL)
    success_html = html_blocks[0] if len(html_blocks) > 0 else ""
    failure_html = html_blocks[1] if len(html_blocks) > 1 else ""

    # Extract Text blocks from the comment section at the bottom
    success_text_match = re.search(
        r"SUCCESS plain-text version:\s*\n(.*?)\n\s*FAILURE plain-text version:",
        content,
        re.DOTALL,
    )
    success_text = success_text_match.group(1).strip() if success_text_match else ""

    failure_text_match = re.search(
        r"FAILURE plain-text version:\s*\n(.*?)\n\s*-->", content, re.DOTALL
    )
    failure_text = failure_text_match.group(1).strip() if failure_text_match else ""

    return success_html, failure_html, success_text, failure_text


# ─── Shared rendering helper ─────────────────────────────────────────────────

def render_email_content(
    repo_name: str,
    pr_number: int,
    review_id: str,
    status: str,
    score: int | None,
    review_excerpt: str,
    findings: list[dict[str, Any]],
    error: str | None,
    settings,
) -> tuple[str, str, str]:
    """
    Render the subject, HTML body, and plain-text body for a review notification.

    Uses plain str.replace() / str.split() throughout — never re.sub() on
    user-supplied content — so backslashes in file paths or descriptions
    cannot trigger regex escape errors.

    Returns:
        (subject, html_content, text_content)
    """
    success_html, failure_html, success_text, failure_text = parse_templates()

    # Sort findings: critical -> high -> medium -> low
    severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    sorted_findings = sorted(
        findings,
        key=lambda f: severity_order.get(f.get("severity", "low").lower(), 4),
    )
    top_findings = sorted_findings[:5]

    # Map active route path (pointing to /history/report?reviewId={review_id})
    base_url = settings.frontend_review_url_base
    if "/reviews" in base_url:
        review_url = f"{base_url.replace('/reviews', '')}/history/report?reviewId={review_id}"
    else:
        review_url = f"{base_url.rstrip('/')}/{review_id}"

    # Color and metadata mapping
    score_val = score if score is not None else 0
    score_color = "#dc2626" if score_val < 50 else ("#d97706" if score_val < 80 else "#16a34a")

    from email.utils import formatdate
    completed_at = formatdate(usegmt=True)

    if status == "completed":
        subject = f"Review Complete: {repo_name} PR #{pr_number}"

        # ── Build per-finding HTML blocks ──────────────────────────────────
        # Extract the repeating finding template using regex on the *template*
        # source only (no user data involved here).
        finding_block_match = re.search(
            r"<!-- Repeat this block per finding, max 3-5 -->\s*(.*?)\s*<!-- end repeat -->",
            success_html,
            re.DOTALL,
        )
        finding_template = finding_block_match.group(1) if finding_block_match else ""

        findings_html_parts: list[str] = []
        for f in top_findings:
            sev = f.get("severity", "low").lower()
            sev_color = (
                "#dc2626" if sev in ("critical", "high")
                else ("#d97706" if sev == "medium" else "#16a34a")
            )
            line_start = f.get("line_start")
            line_suffix = f":{line_start}" if line_start else ""
            desc = f.get("description", f.get("explanation", ""))

            # Use plain str.replace() — immune to backslash content in values
            html = finding_template
            html = html.replace("{{severity_color}}", sev_color)
            html = html.replace("{{severity}}", sev.upper())
            html = html.replace("{{file}}", f.get("file", ""))
            html = html.replace("{{line_suffix}}", line_suffix)
            html = html.replace("{{finding_description}}", desc)
            findings_html_parts.append(html)

        all_findings_html = "\n".join(findings_html_parts)

        # ── Splice findings block into template using split, not re.sub() ──
        # This is the critical fix: re.sub() treats the replacement string as a
        # regex pattern, causing bad-escape errors when user data (file paths,
        # descriptions) contains backslashes like \U, \N, etc.
        sentinel_start = "<!-- Repeat this block per finding, max 3-5 -->"
        sentinel_end = "<!-- end repeat -->"
        before, rest = success_html.split(sentinel_start, 1)
        _, after = rest.split(sentinel_end, 1)
        html_content = before + all_findings_html + after

        # Format HTML global placeholders (all str.replace — safe)
        html_content = html_content.replace("{{repo_name}}", repo_name)
        html_content = html_content.replace("{{pr_number}}", str(pr_number))
        html_content = html_content.replace("{{score_color}}", score_color)
        html_content = html_content.replace("{{score}}", str(score_val))
        html_content = html_content.replace("{{review_excerpt}}", review_excerpt)
        html_content = html_content.replace("{{finding_count}}", str(len(findings)))
        html_content = html_content.replace("{{review_url}}", review_url)
        html_content = html_content.replace("{{completed_at}}", completed_at)

        # ── Build per-finding plain-text lines ─────────────────────────────
        findings_text_parts: list[str] = []
        for f in top_findings:
            line_start = f.get("line_start")
            line_suffix = f":{line_start}" if line_start else ""
            desc = f.get("description", f.get("explanation", ""))
            txt = f"- [{f.get('severity', 'low').upper()}] {f.get('file', '')}{line_suffix}: {desc}"
            findings_text_parts.append(txt)

        all_findings_text = "\n".join(findings_text_parts)

        # ── Same split-based approach for plain-text sentinel ──────────────
        text_sentinel_start = "{{#each findings}}"
        text_sentinel_end = "{{/each}}"
        if text_sentinel_start in success_text and text_sentinel_end in success_text:
            tb, trest = success_text.split(text_sentinel_start, 1)
            _, tafter = trest.split(text_sentinel_end, 1)
            text_content = tb + all_findings_text + tafter
        else:
            text_content = success_text  # fallback: no sentinel found

        text_content = text_content.replace("{{repo_name}}", repo_name)
        text_content = text_content.replace("{{pr_number}}", str(pr_number))
        text_content = text_content.replace("{{score}}", str(score_val))
        text_content = text_content.replace("{{review_excerpt}}", review_excerpt)
        text_content = text_content.replace("{{finding_count}}", str(len(findings)))
        text_content = text_content.replace("{{review_url}}", review_url)
        text_content = text_content.replace("{{completed_at}}", completed_at)

    else:
        subject = f"Review Failed: {repo_name} PR #{pr_number}"
        err_msg = error or "An unknown pipeline error occurred."

        # Format Failure HTML placeholders (all str.replace — safe)
        html_content = failure_html.replace("{{repo_name}}", repo_name)
        html_content = html_content.replace("{{pr_number}}", str(pr_number))
        html_content = html_content.replace("{{error_message}}", err_msg)
        html_content = html_content.replace("{{review_url}}", review_url)

        # Format Failure Text placeholders
        text_content = failure_text.replace("{{repo_name}}", repo_name)
        text_content = text_content.replace("{{pr_number}}", str(pr_number))
        text_content = text_content.replace("{{error_message}}", err_msg)
        text_content = text_content.replace("{{review_url}}", review_url)

    return subject, html_content, text_content


# ─── Brevo client ─────────────────────────────────────────────────────────────

class BrevoEmailClient:
    """Async email notification client utilizing Brevo Transactional Email API."""

    def __init__(self, settings=None):
        self.settings = settings or get_settings()

    async def send_review_notification(
        self,
        to_email: str,
        repo_name: str,
        pr_number: int,
        review_id: str,
        status: str,
        score: int | None,
        review_excerpt: str,
        findings: list[dict[str, Any]],
        error: str | None,
    ) -> None:
        import httpx2

        if not self.settings.brevo_api_key:
            raise ValueError("Brevo API key (brevo_api_key) is not configured.")
        if not self.settings.brevo_sender_email:
            raise ValueError("Brevo sender email (brevo_sender_email) is not configured.")

        subject, html_content, text_content = render_email_content(
            repo_name=repo_name,
            pr_number=pr_number,
            review_id=review_id,
            status=status,
            score=score,
            review_excerpt=review_excerpt,
            findings=findings,
            error=error,
            settings=self.settings,
        )

        # Send via Brevo API
        url = "https://api.brevo.com/v3/smtp/email"
        headers = {
            "api-key": self.settings.brevo_api_key,
            "content-type": "application/json",
            "accept": "application/json",
        }
        payload = {
            "sender": {
                "name": self.settings.brevo_sender_name,
                "email": self.settings.brevo_sender_email,
            },
            "to": [{"email": to_email}],
            "subject": subject,
            "htmlContent": html_content,
            "textContent": text_content,
        }

        async with httpx2.AsyncClient() as client:
            resp = await client.post(url, headers=headers, json=payload, timeout=15.0)
            resp.raise_for_status()


# ─── SES client ───────────────────────────────────────────────────────────────

class SESEmailClient:
    """AWS SES email client using boto3 send_email (HTML + plain-text alternative)."""

    def __init__(self, settings=None):
        self.settings = settings or get_settings()

    async def send_review_notification(
        self,
        to_email: str,
        repo_name: str,
        pr_number: int,
        review_id: str,
        status: str,
        score: int | None,
        review_excerpt: str,
        findings: list[dict[str, Any]],
        error: str | None,
    ) -> None:
        import boto3
        from botocore.exceptions import ClientError

        subject, html_content, text_content = render_email_content(
            repo_name=repo_name,
            pr_number=pr_number,
            review_id=review_id,
            status=status,
            score=score,
            review_excerpt=review_excerpt,
            findings=findings,
            error=error,
            settings=self.settings,
        )

        ses_client = boto3.client(
            "ses",
            region_name=self.settings.aws_ses_region,
            aws_access_key_id=self.settings.aws_ses_access_key,
            aws_secret_access_key=self.settings.aws_ses_secret_key,
        )

        send_kwargs = {
            "Source": self.settings.aws_ses_sender_email,
            "Destination": {"ToAddresses": [to_email]},
            "Message": {
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {
                    "Text": {"Data": text_content, "Charset": "UTF-8"},
                    "Html": {"Data": html_content, "Charset": "UTF-8"},
                },
            },
        }

        try:
            await asyncio.to_thread(ses_client.send_email, **send_kwargs)
            logger.info(
                "[ses] Successfully sent email for review %s to %s via SES.",
                review_id, to_email,
            )
        except ClientError as exc:
            code = exc.response["Error"]["Code"]
            msg = str(exc)

            if code == "MessageRejected":
                # Distinguish sandbox (recipient not verified) from sender-not-verified
                if "Email address is not verified" in msg and to_email in msg:
                    logger.warning(
                        "[ses] Sandbox restriction — recipient %s is not verified in SES. "
                        "Add the address to SES verified identities or request production access. "
                        "Error: %s",
                        to_email, exc,
                    )
                else:
                    logger.warning(
                        "[ses] MessageRejected — sender address (%s) is not verified or "
                        "the account is still in the SES sandbox. Error: %s",
                        self.settings.aws_ses_sender_email, exc,
                    )
            elif code in ("InvalidClientTokenId", "AuthFailure", "AccessDenied"):
                logger.warning(
                    "[ses] AWS credentials / auth error (code=%s). "
                    "Check AWS_SES_ACCESS_KEY and AWS_SES_SECRET_KEY. Error: %s",
                    code, exc,
                )
            else:
                logger.warning(
                    "[ses] Unexpected SES ClientError (code=%s): %s", code, exc
                )
            raise  # re-raise so the fallback orchestrator can try Brevo

        except Exception as exc:
            logger.warning("[ses] Unexpected non-AWS error during SES send: %s", exc)
            raise


# ─── Fallback orchestrator ────────────────────────────────────────────────────

async def send_review_notification_with_fallback(
    settings,
    to_email: str,
    repo_name: str,
    pr_number: int,
    review_id: str,
    status: str,
    score: int | None,
    review_excerpt: str,
    findings: list[dict[str, Any]],
    error: str | None,
) -> str:
    """
    Send a review notification, trying SES first (if configured) then Brevo.

    Returns the name of the provider that successfully sent the email:
    ``"ses"`` or ``"brevo"``.

    Raises the last exception if both providers fail, so the caller can record
    the failure in the DB.  The review's own ``status`` field must NOT be
    affected by email failures — that invariant is enforced in the caller
    (``_send_notification_safely`` in tasks.py).
    """
    kwargs: dict[str, Any] = dict(
        to_email=to_email,
        repo_name=repo_name,
        pr_number=pr_number,
        review_id=review_id,
        status=status,
        score=score,
        review_excerpt=review_excerpt,
        findings=findings,
        error=error,
    )

    # ── Try SES first (only if fully configured) ──────────────────────────
    if settings.ses_configured:
        try:
            ses_client = SESEmailClient(settings)
            await ses_client.send_review_notification(**kwargs)
            logger.info("[email] Notification sent via SES for review %s.", review_id)
            return "ses"
        except Exception as ses_exc:
            # Already logged with full detail inside SESEmailClient.
            # Log at WARNING here (not ERROR) — this is an expected, handled path.
            logger.warning(
                "[email] SES send failed for review %s (%s). "
                "Falling back to Brevo.",
                review_id, ses_exc,
            )
    else:
        logger.debug(
            "[email] SES not configured (one or more AWS_SES_* vars missing). "
            "Sending directly via Brevo."
        )

    # ── Fall back to Brevo ────────────────────────────────────────────────
    brevo_client = BrevoEmailClient(settings)
    await brevo_client.send_review_notification(**kwargs)
    logger.info("[email] Notification sent via Brevo for review %s.", review_id)
    return "brevo"


# ─── Legacy factory (deprecated — use send_review_notification_with_fallback) ─

def get_email_client(settings=None) -> BrevoEmailClient | SESEmailClient:
    """
    Deprecated factory shim — kept for test backwards-compatibility.

    New code should call ``send_review_notification_with_fallback()`` instead,
    which handles SES→Brevo fallback automatically.
    """
    cfg = settings or get_settings()
    if cfg.ses_configured:
        return SESEmailClient(cfg)
    return BrevoEmailClient(cfg)
