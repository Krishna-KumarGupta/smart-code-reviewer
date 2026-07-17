from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Literal, Protocol

import httpx2

from app.config import get_settings

logger = logging.getLogger(__name__)


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
        if not self.settings.brevo_api_key:
            raise ValueError("Brevo API key (brevo_api_key) is not configured.")
        if not self.settings.brevo_sender_email:
            raise ValueError("Brevo sender email (brevo_sender_email) is not configured.")

        # Load templates
        success_html, failure_html, success_text, failure_text = parse_templates()

        # Sort findings: critical -> high -> medium -> low
        severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        sorted_findings = sorted(
            findings,
            key=lambda f: severity_order.get(f.get("severity", "low").lower(), 4),
        )
        top_findings = sorted_findings[:5]

        # Map active route path (pointing to /history/report?reviewId={review_id})
        base_url = self.settings.frontend_review_url_base
        if "/reviews" in base_url:
            review_url = f"{base_url.replace('/reviews', '')}/history/report?reviewId={review_id}"
        else:
            review_url = f"{base_url.rstrip('/')}/{review_id}"

        # Color and metadata mapping
        score_val = score if score is not None else 0
        score_color = "#dc2626" if score_val < 50 else ("#d97706" if score_val < 80 else "#16a34a")

        from email.utils import formatdate
        completed_at = formatdate(usegmt=True)  # fallback timestamp

        if status == "completed":
            subject = f"Review Complete: {repo_name} PR #{pr_number}"

            # Format findings HTML block
            finding_block_match = re.search(
                r"<!-- Repeat this block per finding, max 3-5 -->\s*(.*?)\s*<!-- end repeat -->",
                success_html,
                re.DOTALL,
            )
            finding_template = finding_block_match.group(1) if finding_block_match else ""

            findings_html = []
            for f in top_findings:
                sev = f.get("severity", "low").lower()
                sev_color = "#dc2626" if sev in ("critical", "high") else ("#d97706" if sev == "medium" else "#16a34a")
                line_start = f.get("line_start")
                line_suffix = f":{line_start}" if line_start else ""
                desc = f.get("description", f.get("explanation", ""))

                html = finding_template
                html = html.replace("{{severity_color}}", sev_color)
                html = html.replace("{{severity}}", sev.upper())
                html = html.replace("{{file}}", f.get("file", ""))
                html = html.replace("{{line_suffix}}", line_suffix)
                html = html.replace("{{finding_description}}", desc)
                findings_html.append(html)

            all_findings_html = "\n".join(findings_html)
            html_content = re.sub(
                r"<!-- Repeat this block per finding, max 3-5 -->.*?<!-- end repeat -->",
                all_findings_html,
                success_html,
                flags=re.DOTALL,
            )

            # Format HTML global placeholders
            html_content = html_content.replace("{{repo_name}}", repo_name)
            html_content = html_content.replace("{{pr_number}}", str(pr_number))
            html_content = html_content.replace("{{score_color}}", score_color)
            html_content = html_content.replace("{{score}}", str(score_val))
            html_content = html_content.replace("{{review_excerpt}}", review_excerpt)
            html_content = html_content.replace("{{finding_count}}", str(len(findings)))
            html_content = html_content.replace("{{review_url}}", review_url)
            html_content = html_content.replace("{{completed_at}}", completed_at)

            # Format text block
            findings_text = []
            for f in top_findings:
                line_start = f.get("line_start")
                line_suffix = f":{line_start}" if line_start else ""
                desc = f.get("description", f.get("explanation", ""))
                txt = f"- [{f.get('severity', 'low').upper()}] {f.get('file', '')}{line_suffix}: {desc}"
                findings_text.append(txt)

            all_findings_text = "\n".join(findings_text)
            text_content = re.sub(
                r"\{\{#each findings\}\}.*?\{\{/each\}\}",
                all_findings_text,
                success_text,
                flags=re.DOTALL,
            )

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

            # Format Failure HTML placeholders
            html_content = failure_html.replace("{{repo_name}}", repo_name)
            html_content = html_content.replace("{{pr_number}}", str(pr_number))
            html_content = html_content.replace("{{error_message}}", err_msg)
            html_content = html_content.replace("{{review_url}}", review_url)

            # Format Failure Text placeholders
            text_content = failure_text.replace("{{repo_name}}", repo_name)
            text_content = text_content.replace("{{pr_number}}", str(pr_number))
            text_content = text_content.replace("{{error_message}}", err_msg)
            text_content = text_content.replace("{{review_url}}", review_url)

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


class SESEmailClient:
    """AWS SES Email client stub."""

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
        raise NotImplementedError("AWS SES email client is not implemented.")


def get_email_client(settings=None) -> EmailClient:
    """Factory to retrieve the email client based on config settings."""
    cfg = settings or get_settings()
    if cfg.email_provider == "brevo":
        return BrevoEmailClient(cfg)
    elif cfg.email_provider == "ses":
        return SESEmailClient(cfg)
    else:
        raise ValueError(f"Unknown email provider: {cfg.email_provider}")
