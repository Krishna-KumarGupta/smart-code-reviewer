"""
slicing/graph.py — Bounded BFS over callers/callees for impact slicing.

Strategy:
  - For each diff hunk, find the enclosing symbol (via symbols.py).
  - Perform BFS up to max_depth=2 levels, finding identifiers that appear
    in/call the changed symbol, using a simple identifier-search approach.
  - Return ImpactSlice objects tagged with distance.

This is an approximation — we look for identifier occurrences, not
a full call graph. It is fast (no LLM, no runtime) and good enough for
the "impact context" use case.
"""

from __future__ import annotations

import logging
import re
from collections import deque
from pathlib import Path

from app.models import DiffHunk, ImpactSlice
from app.slicing.symbols import detect_language, find_enclosing_symbol, extract_symbol_body

logger = logging.getLogger(__name__)

_MAX_DEPTH = 2


def _read_file_lines(repo_dir: str, filepath: str) -> list[str] | None:
    """Read a file relative to repo_dir and return its lines."""
    full = Path(repo_dir) / filepath
    try:
        return full.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return None


def _identifier_pattern(name: str) -> re.Pattern:
    """Return a regex that matches `name` as a whole word."""
    escaped = re.escape(name)
    return re.compile(rf"\b{escaped}\b")


def build_impact_slices(
    repo_dir: str,
    diff_hunks: list[DiffHunk],
    all_repo_files: list[str],
    max_depth: int = _MAX_DEPTH,
) -> list[ImpactSlice]:
    """
    Perform bounded BFS over callers/callees and return ImpactSlice objects.

    Args:
        repo_dir:       Absolute path to the cloned repository.
        diff_hunks:     Changed hunks from the PR (distance 0).
        all_repo_files: All source files in the repo (relative paths).
        max_depth:      BFS depth limit (spec says 2).

    Returns:
        List of ImpactSlice objects, distance 0 always included.
    """
    slices: list[ImpactSlice] = []
    visited_symbols: set[tuple[str, str]] = set()  # (file, symbol_name)

    # ── Seed: distance-0 hunks ────────────────────────────────────────────────
    queue: deque[tuple[str, str, int, int, int]] = deque()  # file, symbol, start, end, dist

    for hunk in diff_hunks:
        lines = _read_file_lines(repo_dir, hunk.file)
        if lines is None:
            continue

        lang = detect_language(hunk.file)
        source = "\n".join(lines)

        symbol_info = None
        if lang:
            symbol_info = find_enclosing_symbol(source, lang, hunk.line_start, hunk.line_end)

        if symbol_info:
            sym_name, sym_start, sym_end = symbol_info
            key = (hunk.file, sym_name)
            if key not in visited_symbols:
                visited_symbols.add(key)
                body = extract_symbol_body(lines, sym_start, sym_end)
                slices.append(ImpactSlice(
                    file=hunk.file,
                    line_start=sym_start,
                    line_end=sym_end,
                    symbol=sym_name,
                    distance=0,
                    content=body,
                ))
                queue.append((hunk.file, sym_name, sym_start, sym_end, 0))
        else:
            # No enclosing symbol found — include the raw hunk lines
            body = "\n".join(lines[hunk.line_start - 1 : hunk.line_end])
            slices.append(ImpactSlice(
                file=hunk.file,
                line_start=hunk.line_start,
                line_end=hunk.line_end,
                symbol="<unknown>",
                distance=0,
                content=body,
            ))

    # ── BFS: find callers/callees ──────────────────────────────────────────────
    while queue:
        _, sym_name, _, _, dist = queue.popleft()

        if dist >= max_depth:
            continue

        pat = _identifier_pattern(sym_name)

        for candidate_file in all_repo_files:
            if detect_language(candidate_file) is None:
                continue

            lines = _read_file_lines(repo_dir, candidate_file)
            if lines is None:
                continue

            # Check if the symbol name appears in this file
            source = "\n".join(lines)
            if not pat.search(source):
                continue

            lang = detect_language(candidate_file)
            if lang is None:
                continue

            # Find the enclosing symbol of each matching line
            for i, line in enumerate(lines, start=1):
                if pat.search(line):
                    sym_info = find_enclosing_symbol(source, lang, i, i)
                    if sym_info:
                        found_name, found_start, found_end = sym_info
                        key = (candidate_file, found_name)
                        if key in visited_symbols:
                            continue
                        visited_symbols.add(key)
                        body = extract_symbol_body(lines, found_start, found_end)
                        new_dist = dist + 1
                        slices.append(ImpactSlice(
                            file=candidate_file,
                            line_start=found_start,
                            line_end=found_end,
                            symbol=found_name,
                            distance=new_dist,
                            content=body,
                        ))
                        queue.append((candidate_file, found_name, found_start, found_end, new_dist))

    return slices
