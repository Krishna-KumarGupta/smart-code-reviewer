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


def build_user_message(
    diff_context: str,
    impact_slices: str,
    lint_summary: str,
    circular_summary: str,
) -> str:
    """
    Construct the user message sent to Claude for code review.

    Args:
        diff_context:    Raw diff hunks from the PR.
        impact_slices:   Formatted impact-sliced code context.
        lint_summary:    Summary of lint findings (not full output — keep it small).
        circular_summary: Summary of circular dependency cycles touching PR files.

    Returns:
        The full user message string.
    """
    parts = ["## Pull Request Diff\n", diff_context]

    if impact_slices:
        parts.append("\n## Impact Context (affected symbols and their callers/callees)\n")
        parts.append(impact_slices)

    if lint_summary:
        parts.append("\n## Lint Findings (deterministic — do NOT repeat these)\n")
        parts.append(lint_summary)

    if circular_summary:
        parts.append("\n## Circular Dependency Summary (cycles involving PR files)\n")
        parts.append(circular_summary)

    parts.append(
        "\n\nPlease call the `submit_review` tool with your structured review now."
    )
    return "\n".join(parts)
