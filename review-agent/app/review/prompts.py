"""
review/prompts.py — System prompt and OpenAI JSON schema for structured LLM review.

Design principles:
  - Only flag things with a specific file AND line number — no vague comments.
  - Return structured JSON via tool use (never parse free text).
  - Include confidence and severity per finding.
  - Keep the prompt compact to minimize token usage.
"""

from __future__ import annotations


# ─── System prompt ────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are an expert code reviewer for pull requests. Your job is to analyze code \
changes and identify real bugs, security issues, and anti-patterns.

Rules:
- Only report findings you can pinpoint to a specific file AND line range.
- Do NOT flag style issues already covered by the linter findings provided.
- Do NOT hallucinate imports, function names, or file paths.
- Assign severity: critical (data loss / RCE / auth bypass), high (serious bug / \
security issue), medium (correctness issue / bad practice), low (minor issue).
- Assign confidence (0.0–1.0): 1.0 = certain, 0.5 = plausible, <0.3 = speculative.
- Omit low-confidence (<0.3) findings entirely.
- For suggested_fix: be specific, reference the exact variable/function if possible.
- The `review` field should be a 2–4 sentence prose summary of the overall quality.
- The `improvements` list should be 3–5 concrete, actionable suggestions.
- Be concise. Do not repeat findings in both `findings` and `improvements`.
"""


# ─── OpenAI JSON schema ───────────────────────────────────────────────────────

REVIEW_SCHEMA = {
    "name": "submit_review",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "review": {
                "type": "string",
                "description": "2–4 sentence prose summary of the overall code quality and main concerns.",
            },
            "improvements": {
                "type": "array",
                "items": {"type": "string"},
                "description": "3–5 concrete, actionable improvement suggestions.",
            },
            "findings": {
                "type": "array",
                "description": "All specific findings with file and line information.",
                "items": {
                    "type": "object",
                    "properties": {
                        "file": {
                            "type": "string",
                            "description": "Relative file path (e.g. src/auth/middleware.py).",
                        },
                        "line_start": {
                            "type": "integer",
                            "description": "First line of the finding (1-indexed).",
                        },
                        "line_end": {
                            "type": "integer",
                            "description": "Last line of the finding (1-indexed).",
                        },
                        "severity": {
                            "type": "string",
                            "enum": ["critical", "high", "medium", "low"],
                        },
                        "confidence": {
                            "type": "number",
                            "minimum": 0.0,
                            "maximum": 1.0,
                            "description": "How confident you are this is a real issue.",
                        },
                        "description": {
                            "type": "string",
                            "description": "Clear explanation of the issue.",
                        },
                        "suggested_fix": {
                            "type": ["string", "null"],
                            "description": "Optional: specific code or approach to fix the issue.",
                        },
                    },
                    "required": [
                        "file",
                        "line_start",
                        "line_end",
                        "severity",
                        "confidence",
                        "description",
                        "suggested_fix",
                    ],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["review", "improvements", "findings"],
        "additionalProperties": False,
    },
}


import logging

logger = logging.getLogger(__name__)


def build_user_message(
    diff_context: str,
    impact_slices: str,
    lint_summary: str,
    circular_summary: str,
    max_tokens: int | None = None,
    system_prompt: str = SYSTEM_PROMPT,
) -> str:
    """
    Construct the user message sent to Claude for code review, enforcing
    an optional total prompt token budget hard cap.

    Args:
        diff_context:     Raw diff hunks from the PR.
        impact_slices:    Formatted impact-sliced code context.
        lint_summary:     Summary of lint findings.
        circular_summary: Summary of circular dependency cycles.
        max_tokens:       Optional hard cap on total prompt tokens (system + user).
        system_prompt:    System prompt string used to calculate system token usage.

    Returns:
        The assembled (and potentially truncated) user message string.
    """
    from app.slicing.budget import count_tokens, truncate_text_to_tokens

    def _assemble(diff: str, slices: str, lint: str, circ: str) -> str:
        parts = ["## Pull Request Diff\n", diff]
        if slices:
            parts.append("\n## Impact Context (affected symbols and their callers/callees)\n")
            parts.append(slices)
        if lint:
            parts.append("\n## Lint Findings (deterministic — do NOT repeat these)\n")
            parts.append(lint)
        if circ:
            parts.append("\n## Circular Dependency Summary (cycles involving PR files)\n")
            parts.append(circ)
        parts.append("\n\nPlease call the `submit_review` tool with your structured review now.")
        return "\n".join(parts)

    msg = _assemble(diff_context, impact_slices, lint_summary, circular_summary)

    if max_tokens is None or max_tokens <= 0:
        return msg

    sys_tokens = count_tokens(system_prompt)
    total_tokens = sys_tokens + count_tokens(msg)

    if total_tokens <= max_tokens:
        return msg

    logger.warning(
        "[budget] Total prompt token count (%d) exceeds limit (%d). Enforcing section truncation.",
        total_tokens,
        max_tokens,
    )

    # Priority order of preservation: diff_context > impact_slices > lint_summary > circular_summary

    # 1. Truncate / drop circular_summary
    if circular_summary:
        orig_circ = circular_summary
        circular_summary = ""
        msg = _assemble(diff_context, impact_slices, lint_summary, circular_summary)
        new_total = sys_tokens + count_tokens(msg)
        hdr_tokens = count_tokens("\n## Circular Dependency Summary (cycles involving PR files)\n")
        avail = max_tokens - new_total - hdr_tokens
        if avail > 30:
            circular_summary = truncate_text_to_tokens(orig_circ, avail, suffix="\n... [circular summary truncated]")
            msg = _assemble(diff_context, impact_slices, lint_summary, circular_summary)
            if sys_tokens + count_tokens(msg) > max_tokens:
                circular_summary = ""
                msg = _assemble(diff_context, impact_slices, lint_summary, circular_summary)
                logger.warning("[budget] Dropped circular_summary (%d tokens) to fit token budget.", count_tokens(orig_circ))
            else:
                logger.warning("[budget] Truncated circular_summary to fit token budget.")
        else:
            logger.warning("[budget] Dropped circular_summary (%d tokens) to fit token budget.", count_tokens(orig_circ))

    # 2. Truncate / drop lint_summary
    total_tokens = sys_tokens + count_tokens(msg)
    if total_tokens > max_tokens and lint_summary:
        orig_lint = lint_summary
        lint_summary = ""
        msg = _assemble(diff_context, impact_slices, lint_summary, circular_summary)
        new_total = sys_tokens + count_tokens(msg)
        hdr_tokens = count_tokens("\n## Lint Findings (deterministic — do NOT repeat these)\n")
        avail = max_tokens - new_total - hdr_tokens
        if avail > 30:
            lint_summary = truncate_text_to_tokens(orig_lint, avail, suffix="\n... [lint summary truncated]")
            msg = _assemble(diff_context, impact_slices, lint_summary, circular_summary)
            if sys_tokens + count_tokens(msg) > max_tokens:
                lint_summary = ""
                msg = _assemble(diff_context, impact_slices, lint_summary, circular_summary)
                logger.warning("[budget] Dropped lint_summary (%d tokens) to fit token budget.", count_tokens(orig_lint))
            else:
                logger.warning("[budget] Truncated lint_summary to fit token budget.")
        else:
            logger.warning("[budget] Dropped lint_summary (%d tokens) to fit token budget.", count_tokens(orig_lint))

    # 3. Truncate / drop impact_slices
    total_tokens = sys_tokens + count_tokens(msg)
    if total_tokens > max_tokens and impact_slices:
        orig_slices = impact_slices
        impact_slices = ""
        msg = _assemble(diff_context, impact_slices, lint_summary, circular_summary)
        new_total = sys_tokens + count_tokens(msg)
        hdr_tokens = count_tokens("\n## Impact Context (affected symbols and their callers/callees)\n")
        avail = max_tokens - new_total - hdr_tokens
        if avail > 30:
            impact_slices = truncate_text_to_tokens(orig_slices, avail, suffix="\n... [impact context truncated]")
            msg = _assemble(diff_context, impact_slices, lint_summary, circular_summary)
            if sys_tokens + count_tokens(msg) > max_tokens:
                impact_slices = ""
                msg = _assemble(diff_context, impact_slices, lint_summary, circular_summary)
                logger.warning("[budget] Dropped impact_slices (%d tokens) to fit token budget.", count_tokens(orig_slices))
            else:
                logger.warning("[budget] Truncated impact_slices to fit token budget.")
        else:
            logger.warning("[budget] Dropped impact_slices (%d tokens) to fit token budget.", count_tokens(orig_slices))

    # 4. Truncate diff_context as last resort
    total_tokens = sys_tokens + count_tokens(msg)
    if total_tokens > max_tokens:
        orig_diff_tokens = count_tokens(diff_context)
        overhead = sys_tokens + count_tokens(_assemble("", impact_slices, lint_summary, circular_summary))
        diff_budget = max(10, max_tokens - overhead - 10)
        diff_context = truncate_text_to_tokens(
            diff_context,
            diff_budget,
            suffix="\n... [diff truncated to fit token budget]",
        )
        msg = _assemble(diff_context, impact_slices, lint_summary, circular_summary)
        new_diff_tokens = count_tokens(diff_context)
        logger.warning(
            "[budget] Hard-capping diff_context: truncated diff from %d to %d tokens to enforce max prompt limit of %d.",
            orig_diff_tokens,
            new_diff_tokens,
            max_tokens,
        )

    return msg
