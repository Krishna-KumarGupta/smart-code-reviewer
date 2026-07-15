"""
review/llm_client.py — LLM call via OpenRouter (OpenAI-SDK-compatible).

Routes requests through OpenRouter by passing base_url='https://openrouter.ai/api/v1'
to the OpenAI client constructor. The model string must use the OpenRouter
provider-prefixed form, e.g. 'openai/gpt-5-mini'.

Uses response_format={"type": "json_schema", "json_schema": REVIEW_SCHEMA}
to force a JSON-schema-conformant response. We never parse free text.

The response is decoded from the message content and returned as parsed items
matching the REVIEW_SCHEMA defined in prompts.py.
"""

from __future__ import annotations

import logging

import openai

from app.config import get_settings
from app.models import LLMFinding
from app.review.prompts import REVIEW_SCHEMA, SYSTEM_PROMPT, build_user_message

logger = logging.getLogger(__name__)

_MAX_TOKENS = 4096  # output token cap for the review response


def _build_lint_summary(lint_findings) -> str:
    if not lint_findings:
        return ""
    lines = []
    for f in lint_findings[:50]:  # cap at 50 lint lines to keep context small
        lines.append(f"  [{f.severity.upper()}] {f.file}:{f.line} {f.rule}: {f.message}")
    if len(lint_findings) > 50:
        lines.append(f"  ... and {len(lint_findings) - 50} more")
    return "\n".join(lines)


def _build_circular_summary(circular_findings, diff_files: set[str]) -> str:
    """Only include cycles that touch at least one file changed in the PR."""
    if not circular_findings:
        return ""
    relevant = []
    for f in circular_findings:
        cycle_files = set()
        for edge in (f.cycle_path or []):
            parts = edge.split(" imports ")
            if parts:
                cycle_files.add(parts[0].split(":")[0])
        if cycle_files & diff_files:
            relevant.append(f.description)
    if not relevant:
        return ""
    return "\n".join(f"  - {d}" for d in relevant)


class LLMReviewClient:
    """Thin wrapper around the OpenAI client for structured code review."""

    def __init__(self) -> None:
        settings = get_settings()
        self._client = openai.OpenAI(
            api_key=settings.openai_api_key,
            base_url=settings.openrouter_base_url,
        )
        self._model = settings.openai_model

    def review(
        self,
        diff_context: str,
        impact_slices_text: str,
        lint_findings,
        circular_findings,
        diff_files: set[str],
    ) -> tuple[str, list[str], list[LLMFinding]]:
        """
        Call OpenAI with structured response format and return (review_text, improvements, findings).

        Returns:
            review:       Prose summary string.
            improvements: List of improvement suggestion strings.
            findings:     List of LLMFinding objects.
        """
        lint_summary = _build_lint_summary(lint_findings)
        circular_summary = _build_circular_summary(circular_findings, diff_files)

        user_message = build_user_message(
            diff_context=diff_context,
            impact_slices=impact_slices_text,
            lint_summary=lint_summary,
            circular_summary=circular_summary,
        )

        logger.info("[llm_client] Calling %s for code review", self._model)

        response = self._client.chat.completions.create(
            model=self._model,
            max_tokens=_MAX_TOKENS,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": REVIEW_SCHEMA,
            },
        )

        content = response.choices[0].message.content
        if not content:
            logger.error("[llm_client] Empty response content — returning empty review")
            return "Review could not be completed.", [], []

        import json
        try:
            data = json.loads(content)
        except Exception as exc:
            logger.exception("[llm_client] Failed to parse JSON from response: %s", exc)
            return "Review could not be completed.", [], []

        review_text: str = data.get("review", "")
        improvements: list[str] = data.get("improvements", [])
        raw_findings: list[dict] = data.get("findings", [])

        llm_findings: list[LLMFinding] = []
        for f in raw_findings:
            try:
                llm_findings.append(LLMFinding(
                    file=f["file"],
                    line_start=f["line_start"],
                    line_end=f["line_end"],
                    severity=f["severity"],
                    confidence=float(f.get("confidence", 0.8)),
                    description=f["description"],
                    suggested_fix=f.get("suggested_fix"),
                ))
            except Exception as exc:
                logger.warning("[llm_client] Skipping malformed finding: %s — %s", f, exc)

        logger.info(
            "[llm_client] Review complete — %d finding(s), prompt_tokens=%s",
            len(llm_findings),
            response.usage.prompt_tokens,
        )
        return review_text, improvements, llm_findings
