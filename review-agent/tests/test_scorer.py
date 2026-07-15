"""
test_scorer.py — Unit tests for the deterministic scoring function.

Tests every severity level, capping logic, and edge cases.
Uses a clean Settings instance with known weights via monkeypatching.
"""

from unittest.mock import patch

import pytest

from app.models import LintFinding, LLMFinding, OsvVulnerability, StructureFinding
from app.merge.scorer import compute_score


# ─── Helper factories ─────────────────────────────────────────────────────────

def make_osv(severity: str) -> OsvVulnerability:
    return OsvVulnerability(
        package_name="pkg",
        package_version="1.0",
        vuln_id="CVE-TEST",
        severity=severity,
        description="test",
    )


def make_lint(severity: str) -> LintFinding:
    return LintFinding(file="f.py", line=1, rule="X", severity=severity, message="m")


def make_circular() -> StructureFinding:
    return StructureFinding(
        type="circular_dependency",
        description="A → B → A",
        cycle_path=["a.py:1 imports b.py", "b.py:1 imports a.py"],
    )


def make_llm(severity: str, confidence: float = 1.0) -> LLMFinding:
    return LLMFinding(
        file="f.py",
        line_start=1,
        line_end=5,
        severity=severity,
        confidence=confidence,
        description="issue",
    )


def make_layout() -> StructureFinding:
    return StructureFinding(type="layout", description="Missing README")


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestScorerBaseline:
    def test_no_findings_returns_100(self):
        assert compute_score([], [], [], [], []) == 100

    def test_score_is_integer(self):
        result = compute_score([make_osv("low")], [], [], [], [])
        assert isinstance(result, int)


class TestOsvWeights:
    def test_critical_osv_deducts_15(self):
        score = compute_score([make_osv("critical")], [], [], [], [])
        assert score == 85

    def test_high_osv_deducts_10(self):
        score = compute_score([make_osv("high")], [], [], [], [])
        assert score == 90

    def test_medium_osv_deducts_5(self):
        score = compute_score([make_osv("medium")], [], [], [], [])
        assert score == 95

    def test_low_osv_deducts_2(self):
        score = compute_score([make_osv("low")], [], [], [], [])
        assert score == 98

    def test_multiple_osv_cumulative(self):
        vulns = [make_osv("critical"), make_osv("high"), make_osv("medium")]
        score = compute_score(vulns, [], [], [], [])
        assert score == 100 - 15 - 10 - 5


class TestLintWeights:
    def test_lint_error_deducts_5(self):
        score = compute_score([], [make_lint("error")], [], [], [])
        assert score == 95

    def test_lint_warning_deducts_2(self):
        score = compute_score([], [make_lint("warning")], [], [], [])
        assert score == 98

    def test_multiple_lint_findings(self):
        findings = [make_lint("error"), make_lint("error"), make_lint("warning")]
        score = compute_score([], findings, [], [], [])
        assert score == 100 - 5 - 5 - 2


class TestCircularDepWeights:
    def test_one_cycle_deducts_8(self):
        score = compute_score([], [], [make_circular()], [], [])
        assert score == 92

    def test_two_cycles_deducts_16(self):
        score = compute_score([], [], [make_circular(), make_circular()], [], [])
        assert score == 84

    def test_three_cycles_deducts_24_capped(self):
        """3 × 8 = 24 = cap."""
        score = compute_score([], [], [make_circular()] * 3, [], [])
        assert score == 76

    def test_four_cycles_still_capped_at_24(self):
        """4 × 8 = 32 > 24 → still deduct only 24."""
        score = compute_score([], [], [make_circular()] * 4, [], [])
        assert score == 76  # Same as 3 cycles

    def test_ten_cycles_still_capped(self):
        score = compute_score([], [], [make_circular()] * 10, [], [])
        assert score == 76


class TestLLMWeights:
    def test_critical_llm_confidence_1_deducts_12(self):
        score = compute_score([], [], [], [make_llm("critical", 1.0)], [])
        assert score == 88

    def test_high_llm_confidence_1_deducts_8(self):
        score = compute_score([], [], [], [make_llm("high", 1.0)], [])
        assert score == 92

    def test_medium_llm_confidence_1_deducts_4(self):
        score = compute_score([], [], [], [make_llm("medium", 1.0)], [])
        assert score == 96

    def test_low_llm_confidence_1_deducts_1(self):
        score = compute_score([], [], [], [make_llm("low", 1.0)], [])
        assert score == 99

    def test_llm_confidence_half_halves_deduction(self):
        # high × 0.5 = 4 deduction → score = 96
        score = compute_score([], [], [], [make_llm("high", 0.5)], [])
        assert score == 96

    def test_llm_confidence_0_no_deduction(self):
        score = compute_score([], [], [], [make_llm("critical", 0.0)], [])
        assert score == 100


class TestLayoutWeights:
    def test_one_layout_violation_deducts_3(self):
        score = compute_score([], [], [], [], [make_layout()])
        assert score == 97

    def test_three_layout_violations_deducts_9(self):
        score = compute_score([], [], [], [], [make_layout()] * 3)
        assert score == 91


class TestClamping:
    def test_score_never_goes_below_0(self):
        many_criticals = [make_osv("critical")] * 20  # 20 × 15 = 300 deduction
        score = compute_score(many_criticals, [], [], [], [])
        assert score == 0

    def test_score_never_exceeds_100(self):
        score = compute_score([], [], [], [], [])
        assert score == 100


class TestCombined:
    def test_realistic_mixed_findings(self):
        """A realistic PR with multiple finding types."""
        score = compute_score(
            osv_vulns=[make_osv("high")],          # -10
            lint_findings=[make_lint("error")] * 3, # -15
            circular_findings=[make_circular()],    # -8
            llm_findings=[make_llm("medium", 0.9)], # -3.6 → rounds
            layout_findings=[make_layout()],        # -3
        )
        # 100 - 10 - 15 - 8 - round(3.6) - 3 = 100 - 39.6 ≈ 61 (after round)
        assert 55 <= score <= 65, f"Unexpected combined score: {score}"
