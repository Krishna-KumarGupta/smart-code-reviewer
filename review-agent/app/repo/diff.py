"""
repo/diff.py — Parse GitHub pull request diff patches into DiffHunk objects.

GitHub returns the `patch` field on each file in the PR Files API response.
This module converts that unified-diff patch into structured DiffHunk objects
for downstream consumption (impact slicing, LLM context building).
"""

import re

from app.models import DiffHunk


# Matches unified-diff hunk headers:  @@ -a,b +c,d @@ optional context
_HUNK_HEADER = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def parse_patch(filename: str, patch: str) -> list[DiffHunk]:
    """
    Parse a unified-diff `patch` string into a list of DiffHunk objects.

    Each DiffHunk represents a contiguous block of added/changed lines in the
    *new* file (using the `+` side of the diff).

    Args:
        filename: The file path (relative to repo root).
        patch:    The `patch` field from the GitHub Files API response.

    Returns:
        A list of DiffHunk objects. Empty if patch is None/empty.
    """
    if not patch:
        return []

    hunks: list[DiffHunk] = []
    current_new_line = 0
    hunk_start: int | None = None
    hunk_lines: list[str] = []

    def _flush_hunk() -> None:
        nonlocal hunk_start, hunk_lines
        if hunk_start is not None and hunk_lines:
            hunk_end = hunk_start + len(hunk_lines) - 1
            hunks.append(
                DiffHunk(
                    file=filename,
                    line_start=hunk_start,
                    line_end=max(hunk_start, hunk_end),
                    content="\n".join(hunk_lines),
                )
            )
        hunk_start = None
        hunk_lines = []

    for raw_line in patch.splitlines():
        m = _HUNK_HEADER.match(raw_line)
        if m:
            _flush_hunk()
            # The +N,M group: N = starting line in the new file, M = line count
            current_new_line = int(m.group(3))
            hunk_start = current_new_line
            hunk_lines = []
            continue

        if raw_line.startswith("+") and not raw_line.startswith("+++"):
            # Added line — record the actual content (strip leading "+")
            hunk_lines.append(raw_line[1:])
            current_new_line += 1
        elif raw_line.startswith("-") and not raw_line.startswith("---"):
            # Removed line — does not advance the new-file line counter
            pass
        else:
            # Context line — if we have an open hunk, flush it and move on
            if hunk_lines:
                _flush_hunk()
                hunk_start = None
            current_new_line += 1

    _flush_hunk()
    return hunks


def extract_diff_hunks(pr_files: list[dict]) -> list[DiffHunk]:
    """
    Convert the GitHub PR Files API response into DiffHunk objects.

    Args:
        pr_files: List of file objects from GET /repos/.../pulls/{n}/files.

    Returns:
        Flat list of DiffHunk objects across all changed files.
    """
    all_hunks: list[DiffHunk] = []
    for f in pr_files:
        filename = f.get("filename", "")
        patch = f.get("patch")
        if patch:
            all_hunks.extend(parse_patch(filename, patch))
    return all_hunks
