"""
merge/scorer.py — Pure deterministic scoring function.

Score formula (from spec §6):
  score = 100
  − {critical:15, high:10, medium:5, low:2} per OSV vulnerability
  − {error:5, warning:2} per lint finding
  − 8 per distinct circular dependency cycle (capped at 24)
  − {critical:12, high:8, medium:4, low:1} × confidence per LLM finding
  − 3 × layout violations count
  = clamp(score, 0, 100)

All weights are read from Settings so they can be overridden via env vars.
This function is pure — no I/O, no side effects, deterministic for identical inputs.
"""

from __future__ import annotations

from app.config import get_settings
from app.models import LintFinding, LLMFinding, OsvVulnerability, StructureFinding


def compute_score(
    osv_vulns: list[OsvVulnerability],
    lint_findings: list[LintFinding],
    circular_findings: list[StructureFinding],
    llm_findings: list[LLMFinding],
    layout_findings: list[StructureFinding],
) -> int:
    """
    Compute the overall review score (0–100) from pipeline findings.

    Args:
        osv_vulns:        Vulnerabilities from osv-scanner.
        lint_findings:    Findings from ruff/eslint/golangci-lint.
        circular_findings: Circular dependency cycles (one per cycle).
        llm_findings:     Findings from the LLM review step.
        layout_findings:  Structure/layout rule violations.

    Returns:
        Integer score in [0, 100].
    """
    s = get_settings()
    score = 100.0

    # ── OSV vulnerabilities ────────────────────────────────────────────────────
    osv_weights = {
        "critical": s.score_weight_osv_critical,
        "high":     s.score_weight_osv_high,
        "medium":   s.score_weight_osv_medium,
        "low":      s.score_weight_osv_low,
    }
    for v in osv_vulns:
        score -= osv_weights.get(v.severity, s.score_weight_osv_low)

    # ── Lint findings ──────────────────────────────────────────────────────────
    lint_weights = {
        "error":   s.score_weight_lint_error,
        "warning": s.score_weight_lint_warning,
    }
    for f in lint_findings:
        score -= lint_weights.get(f.severity, s.score_weight_lint_warning)

    # ── Circular dependencies (cap total deduction at cap value) ───────────────
    num_cycles = len(circular_findings)
    circ_deduction = min(
        num_cycles * s.score_weight_circular_dep,
        s.score_weight_circular_dep_cap,
    )
    score -= circ_deduction

    # ── LLM findings (weighted by confidence) ─────────────────────────────────
    llm_weights = {
        "critical": s.score_weight_llm_critical,
        "high":     s.score_weight_llm_high,
        "medium":   s.score_weight_llm_medium,
        "low":      s.score_weight_llm_low,
    }
    for f in llm_findings:
        weight = llm_weights.get(f.severity, s.score_weight_llm_low)
        score -= weight * f.confidence

    # ── Layout violations ──────────────────────────────────────────────────────
    score -= len(layout_findings) * s.score_weight_structure

    # ── Clamp ─────────────────────────────────────────────────────────────────
    return int(max(0, min(100, round(score))))
