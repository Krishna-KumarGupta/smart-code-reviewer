"""
merge/report.py — Merge all pipeline findings into a final ReviewReport.

Converts each finding type into a Bug and assembles ReviewReport matching §7.
"""

from __future__ import annotations

import logging

from app.models import (
    Bug,
    LintFinding,
    LLMFinding,
    OsvVulnerability,
    ReviewReport,
    StructureFinding,
)
from app.merge.scorer import compute_score

logger = logging.getLogger(__name__)


def _lint_to_bug(f: LintFinding) -> Bug:
    return Bug(
        file=f.file,
        line_start=f.line,
        line_end=f.line,
        source="lint",
        severity="high" if f.severity == "error" else "low",
        description=f"[{f.linter}/{f.rule}] {f.message}",
        suggested_fix=None,
    )


def _osv_to_bug(v: OsvVulnerability) -> Bug:
    return Bug(
        file=v.manifest_file or "unknown",
        line_start=v.manifest_line,
        line_end=v.manifest_line,
        source="osv",
        severity=v.severity,
        description=v.description,
        suggested_fix=f"Upgrade {v.package_name} to a version that does not have {v.vuln_id}",
    )


def _circular_to_bug(f: StructureFinding) -> Bug:
    return Bug(
        file=f.file or "unknown",
        line_start=f.line_start,
        line_end=f.line_end,
        source="circular_dependency",
        severity=f.severity,
        description=f.description,
        suggested_fix="Refactor to break the import cycle (introduce an interface / dependency inversion).",
        cycle_path=f.cycle_path,
    )


def _layout_to_bug(f: StructureFinding) -> Bug:
    return Bug(
        file=f.file or ".",
        line_start=0,
        line_end=0,
        source="structure",
        severity=f.severity,
        description=f.description,
        suggested_fix=None,
    )


def _llm_to_bug(f: LLMFinding) -> Bug:
    return Bug(
        file=f.file,
        line_start=f.line_start,
        line_end=f.line_end,
        source="llm",
        severity=f.severity,
        description=f.description,
        suggested_fix=f.suggested_fix,
    )


def build_report(
    osv_vulns: list[OsvVulnerability],
    lint_findings: list[LintFinding],
    circular_findings: list[StructureFinding],
    layout_findings: list[StructureFinding],
    llm_findings: list[LLMFinding],
    review_text: str,
    improvements: list[str],
) -> ReviewReport:
    """
    Merge all pipeline outputs into a single ReviewReport matching spec §7.

    Args:
        osv_vulns:        OSV scanner vulnerabilities.
        lint_findings:    Deterministic linter findings.
        circular_findings: Circular dependency cycles.
        layout_findings:  Layout rule violations.
        llm_findings:     LLM-generated findings.
        review_text:      Prose review summary from LLM.
        improvements:     Improvement suggestions from LLM.

    Returns:
        ReviewReport ready for JSON serialisation.
    """
    score = compute_score(
        osv_vulns=osv_vulns,
        lint_findings=lint_findings,
        circular_findings=circular_findings,
        llm_findings=llm_findings,
        layout_findings=layout_findings,
    )

    bugs: list[Bug] = []
    bugs.extend(_lint_to_bug(f) for f in lint_findings)
    bugs.extend(_osv_to_bug(v) for v in osv_vulns)
    bugs.extend(_circular_to_bug(f) for f in circular_findings)
    bugs.extend(_layout_to_bug(f) for f in layout_findings)
    bugs.extend(_llm_to_bug(f) for f in llm_findings)

    # Sort: critical first, then high, medium, low
    _sev_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    bugs.sort(key=lambda b: _sev_order.get(b.severity, 4))

    logger.info(
        "[report] Built ReviewReport — score=%d, bugs=%d (lint=%d, osv=%d, circ=%d, layout=%d, llm=%d)",
        score, len(bugs),
        len(lint_findings), len(osv_vulns), len(circular_findings),
        len(layout_findings), len(llm_findings),
    )

    return ReviewReport(
        score=score,
        review=review_text or "Review completed.",
        improvements=improvements or [],
        bugs=bugs,
    )
