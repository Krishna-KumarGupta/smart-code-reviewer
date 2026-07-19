from __future__ import annotations

import logging
from typing import Any

from app.config import get_settings
from app.github.client import GitHubClient
from app.repo.diff import extract_diff_hunks

logger = logging.getLogger(__name__)

_SOURCE_NAMES = {
    "lint": "Linter",
    "osv": "OSV Vulnerability Scanner",
    "llm": "LLM Reviewer",
    "circular_dependency": "Circular Dependency Detector",
    "structure": "Structure Checker",
}


def _parse_owner_repo(repo_url: str) -> tuple[str, str]:
    """Extract owner and repo name from an HTTPS GitHub URL."""
    parts = repo_url.rstrip("/").rstrip(".git").split("/")
    return parts[-2], parts[-1]


def is_finding_in_diff(finding: dict[str, Any], diff_hunks: list[Any]) -> bool:
    """Check if a finding falls within the changed lines of the PR diff."""
    file = finding.get("file")
    line_start = finding.get("line_start")
    if not file or line_start is None:
        return False

    for hunk in diff_hunks:
        if hunk.file == file and hunk.line_start <= line_start <= hunk.line_end:
            return True
    return False


def format_inline_comment_body(finding: dict[str, Any]) -> str:
    """Format the markdown body of a single inline review comment."""
    severity = finding.get("severity", "low").lower()
    source = finding.get("source", "llm")
    description = finding.get("description", "")
    suggested_fix = finding.get("suggested_fix")

    emoji = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🔵"}.get(severity, "🔵")
    source_name = _SOURCE_NAMES.get(source, source.capitalize())

    body_parts = [
        f"### {emoji} {severity.capitalize()} finding from {source_name}",
        description,
    ]
    if suggested_fix:
        body_parts.append(f"**Suggested Fix:**\n{suggested_fix}")

    return "\n\n".join(body_parts)


def build_pr_review_payload(
    review_id: str,
    score: int,
    review_narrative: str,
    findings: list[dict[str, Any]],
    diff_hunks: list[Any],
    max_inline: int = 15,
    settings: Any = None,
) -> tuple[str, list[dict[str, Any]]]:
    """
    Build the pull request review body (overall markdown) and inline comments list.
    """
    if settings is None:
        settings = get_settings()

    # Step 1: Separate findings into qualifying inline and other findings
    qualifying_inline = []
    not_inline_findings = []

    for f in findings:
        if is_finding_in_diff(f, diff_hunks):
            qualifying_inline.append(f)
        else:
            not_inline_findings.append(f)

    # Step 2: Sort qualifying inline findings by severity
    severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}

    def finding_sort_key(f):
        sev = f.get("severity", "low").lower()
        file_val = f.get("file") or ""
        line_start = f.get("line_start")
        line_val = line_start if line_start is not None else float("inf")
        return (severity_order.get(sev, 4), file_val, line_val)

    qualifying_inline = sorted(qualifying_inline, key=finding_sort_key)

    # Step 3: Apply inline comments cap
    inline_selected = qualifying_inline[:max_inline]
    inline_rejected = qualifying_inline[max_inline:]

    # Any rejected qualifying comments go to the body list
    not_inline_findings.extend(inline_rejected)

    # Step 4: Build inline comments list payload
    inline_comments_payload = []
    for f in inline_selected:
        inline_comments_payload.append({
            "path": f.get("file"),
            "line": f.get("line_start"),
            "side": "RIGHT",
            "body": format_inline_comment_body(f),
        })

    # Step 5: Build overall review body
    body_lines = [
        f"## Code Review — Score: {score}/100",
        "",
        review_narrative,
        "",
        "### Findings summary",
    ]

    critical_count = sum(1 for f in findings if f.get("severity", "").lower() == "critical")
    high_count = sum(1 for f in findings if f.get("severity", "").lower() == "high")
    medium_count = sum(1 for f in findings if f.get("severity", "").lower() == "medium")
    low_count = sum(1 for f in findings if f.get("severity", "").lower() == "low")

    body_lines.append(
        f"- 🔴 Critical: {critical_count}   🟠 High: {high_count}   "
        f"🟡 Medium: {medium_count}   🔵 Low: {low_count}"
    )

    if not_inline_findings:
        body_lines.append("")
        sorted_not_inline = sorted(not_inline_findings, key=finding_sort_key)
        top_not_inline = sorted_not_inline[:10]

        for f in top_not_inline:
            file_val = f.get("file")
            line_start = f.get("line_start")
            if file_val:
                if line_start is not None:
                    file_str = f"**{file_val}:{line_start}**"
                else:
                    file_str = f"**{file_val} (no direct line)**"
            else:
                file_str = "**no direct line**"

            desc = f.get("description", "")
            desc = desc.replace("\n", " ")
            body_lines.append(f"- {file_str} — {desc}")

        if len(sorted_not_inline) > 10:
            remaining = len(sorted_not_inline) - 10
            body_lines.append(f"+ {remaining} more — see full report")

    # View full report link
    base_url = settings.frontend_review_url_base.rstrip("/")
    body_lines.append("")
    body_lines.append(f"[View full report]({base_url}/{review_id})")

    overall_body = "\n".join(body_lines)
    return overall_body, inline_comments_payload


async def post_github_comment(
    review_id: str,
    repo_url: str,
    pr_number: int,
    score: int,
    review_narrative: str,
    findings: list[dict[str, Any]],
    pr_files: list[dict[str, Any]] | None = None,
    settings: Any = None,
) -> None:
    """
    Generate and post the review report back to the GitHub PR.
    """
    cfg = settings or get_settings()
    if not cfg.github_comment_enabled:
        logger.debug("[github_comment] PR review comments are disabled via kill switch.")
        return

    # Extract owner/repo
    owner, repo = _parse_owner_repo(repo_url)

    # 1. Fetch pr_files if not provided
    if pr_files is None:
        async with GitHubClient() as client:
            pr_files = await client.get_pr_files(owner, repo, pr_number)

    # 2. Extract diff hunks
    diff_hunks = extract_diff_hunks(pr_files)

    # 3. Build payload
    body, comments = build_pr_review_payload(
        review_id=review_id,
        score=score,
        review_narrative=review_narrative,
        findings=findings,
        diff_hunks=diff_hunks,
        max_inline=cfg.github_comment_max_inline,
        settings=cfg,
    )

    # 4. Post using GitHub client
    async with GitHubClient() as client:
        await client.post_pr_review(
            owner=owner,
            repo=repo,
            pull_number=pr_number,
            body=body,
            event="COMMENT",
            comments=comments,
        )
