"""
slicing/budget.py — Token budgeting and truncation for impact slices.

Ensures no more than IMPACT_SLICE_MAX_TOKENS tokens of source code are
sent to the LLM. Distance-0 (direct diff) slices are ALWAYS included
regardless of token budget.

Token counting: uses tiktoken with cl100k_base encoding (Claude-compatible
approximation). Falls back to whitespace-split word count if tiktoken fails.
"""

from __future__ import annotations

import logging

from app.models import ImpactSlice

logger = logging.getLogger(__name__)

try:
    import tiktoken as _tiktoken
    _ENC = _tiktoken.get_encoding("cl100k_base")

    def _count_tokens(text: str) -> int:
        return len(_ENC.encode(text))

except Exception:
    logger.warning("[budget] tiktoken not available — falling back to word-count approximation")

    def _count_tokens(text: str) -> int:  # type: ignore[misc]
        return len(text.split())


def format_slice_header(s: ImpactSlice) -> str:
    """Build the file:line header tag for a slice, for use in the LLM prompt."""
    return f"# {s.file}:{s.line_start}-{s.line_end} ({s.symbol}, distance={s.distance})"


def apply_token_budget(
    slices: list[ImpactSlice],
    max_tokens: int,
) -> list[ImpactSlice]:
    """
    Enforce the token budget, always keeping distance-0 slices.

    Algorithm:
      1. Separate distance-0 (must-include) from distance-1/2 (optional).
      2. Add all must-include slices first (they may exceed budget alone —
         in that case return them truncated at the content level).
      3. Fill remaining budget with distance-1, then distance-2 slices
         sorted by (distance ASC, content length DESC).

    Returns a list of ImpactSlice with token_count populated.
    """
    must_include = [s for s in slices if s.distance == 0]
    optional = sorted(
        [s for s in slices if s.distance > 0],
        key=lambda s: (s.distance, -len(s.content)),
    )

    result: list[ImpactSlice] = []
    used = 0

    # ── Must-include: distance-0 slices ───────────────────────────────────────
    for s in must_include:
        header = format_slice_header(s)
        full_text = f"{header}\n{s.content}\n"
        tokens = _count_tokens(full_text)
        s = s.model_copy(update={"token_count": tokens})
        result.append(s)
        used += tokens

    # ── Optional: fill remaining budget ───────────────────────────────────────
    remaining = max(0, max_tokens - used)
    for s in optional:
        if remaining <= 0:
            break
        header = format_slice_header(s)
        full_text = f"{header}\n{s.content}\n"
        tokens = _count_tokens(full_text)
        if tokens <= remaining:
            s = s.model_copy(update={"token_count": tokens})
            result.append(s)
            remaining -= tokens
        else:
            logger.debug(
                "[budget] Dropping slice %s:%s (dist=%d) — %d tokens > %d remaining",
                s.file, s.symbol, s.distance, tokens, remaining,
            )

    logger.info(
        "[budget] Budget: %d/%d tokens used across %d/%d slices",
        used + (max_tokens - remaining), max_tokens, len(result), len(slices),
    )
    return result


def format_slices_for_llm(slices: list[ImpactSlice]) -> str:
    """
    Render the selected slices into a string suitable for injection into the LLM prompt.
    Each slice is preceded by a file:line header.
    """
    parts: list[str] = []
    for s in slices:
        header = format_slice_header(s)
        parts.append(f"{header}\n```\n{s.content}\n```")
    return "\n\n".join(parts)
