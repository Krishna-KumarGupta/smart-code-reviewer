"""
test_impact_slicer.py — Tests for the token budgeting / impact slicer.

Verifies:
  1. Distance-0 slices are ALWAYS included regardless of budget.
  2. Optional slices are dropped when budget is exceeded.
  3. Token count is populated after budget application.
  4. Slices are ordered correctly (distance-0 first, then by distance/size).
"""

import pytest

from app.models import ImpactSlice
from app.slicing.budget import apply_token_budget, format_slices_for_llm, format_slice_header


def make_slice(
    distance: int,
    content: str = "x" * 100,
    file: str = "test.py",
    symbol: str = "func",
    line_start: int = 1,
    line_end: int = 10,
) -> ImpactSlice:
    return ImpactSlice(
        file=file,
        line_start=line_start,
        line_end=line_end,
        symbol=symbol,
        distance=distance,
        content=content,
    )


class TestBudgetEnforcement:
    def test_distance_0_always_included(self):
        """Distance-0 slices must be included even if over budget."""
        must_include = [make_slice(0, content="x" * 500)]
        optional = [make_slice(1, content="y" * 500)]

        # Very tight budget — only enough for ~10 tokens
        result = apply_token_budget(must_include + optional, max_tokens=10)

        files = [s.file for s in result]
        # The distance-0 slice must be present
        assert any(s.distance == 0 for s in result), "Distance-0 slice was dropped"

    def test_optional_slices_dropped_when_budget_exceeded(self):
        """Optional slices should not appear when budget is exhausted."""
        must_include = [make_slice(0, content="x" * 1000)]
        optional = [make_slice(1, content="y" * 1000, symbol="optional_func")]

        # Budget: 0 extra tokens after must-include
        must_tokens = len(must_include[0].content.split())
        result = apply_token_budget(must_include + optional, max_tokens=must_tokens)

        assert not any(s.distance == 1 for s in result), "Optional slice should have been dropped"

    def test_optional_slices_included_when_budget_allows(self):
        """Optional slices appear when there's enough budget."""
        must_include = [make_slice(0, content="def foo(): pass")]
        optional = [make_slice(1, content="def bar(): pass")]

        result = apply_token_budget(must_include + optional, max_tokens=100_000)
        assert len(result) == 2

    def test_all_distance_0_slices_included(self):
        """Multiple distance-0 slices must all be included."""
        dist0 = [
            make_slice(0, content="a" * 100, symbol="fn_a"),
            make_slice(0, content="b" * 100, symbol="fn_b"),
            make_slice(0, content="c" * 100, symbol="fn_c"),
        ]
        result = apply_token_budget(dist0, max_tokens=5)  # tiny budget
        assert len([s for s in result if s.distance == 0]) == 3

    def test_token_count_populated(self):
        """After apply_token_budget, token_count should be > 0."""
        slices = [make_slice(0, content="def hello(): return 42")]
        result = apply_token_budget(slices, max_tokens=10_000)
        assert result[0].token_count > 0

    def test_empty_input_returns_empty(self):
        result = apply_token_budget([], max_tokens=10_000)
        assert result == []

    def test_slices_ranked_by_distance(self):
        """Dist-1 slices should appear before dist-2 slices in output."""
        slices = [
            make_slice(0, content="a" * 10, symbol="fn0"),
            make_slice(2, content="c" * 10, symbol="fn2"),
            make_slice(1, content="b" * 10, symbol="fn1"),
        ]
        result = apply_token_budget(slices, max_tokens=100_000)
        distances = [s.distance for s in result]
        dist0_indices = [i for i, d in enumerate(distances) if d == 0]
        dist1_indices = [i for i, d in enumerate(distances) if d == 1]
        dist2_indices = [i for i, d in enumerate(distances) if d == 2]
        # All dist-0 before dist-1 before dist-2
        if dist0_indices and dist1_indices:
            assert max(dist0_indices) < min(dist1_indices)
        if dist1_indices and dist2_indices:
            assert max(dist1_indices) < min(dist2_indices)


class TestFormatting:
    def test_format_slice_header_contains_file(self):
        s = make_slice(0, file="src/auth.py", line_start=10, line_end=25, symbol="verify")
        header = format_slice_header(s)
        assert "src/auth.py" in header

    def test_format_slice_header_contains_lines(self):
        s = make_slice(0, file="f.py", line_start=10, line_end=25, symbol="func")
        header = format_slice_header(s)
        assert "10" in header
        assert "25" in header

    def test_format_slice_header_contains_symbol(self):
        s = make_slice(0, file="f.py", symbol="my_func")
        header = format_slice_header(s)
        assert "my_func" in header

    def test_format_slices_for_llm_uses_headers(self):
        slices = [make_slice(0, file="main.py", symbol="main")]
        text = format_slices_for_llm(slices)
        assert "main.py" in text
        assert "main" in text

    def test_format_slices_for_llm_empty_returns_empty_string(self):
        text = format_slices_for_llm([])
        assert text == ""
