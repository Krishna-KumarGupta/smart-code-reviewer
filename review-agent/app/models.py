"""
models.py — All Pydantic v2 data models for review-agent.

These are the canonical data shapes used across the entire pipeline.
The public API output schema (Bug, ReviewReport) must match §7 of the spec exactly.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ─── Public output schema (§7) ───────────────────────────────────────────────

class Bug(BaseModel):
    """A single finding surfaced in the final review report."""

    file: str = Field(..., description="Relative path to the file containing the issue")
    line_start: int | None = Field(None, description="First line of the relevant range (1-indexed); null for transitive/unlocatable findings")
    line_end: int | None = Field(None, description="Last line of the relevant range (1-indexed); null for transitive/unlocatable findings")
    source: Literal["lint", "osv", "llm", "circular_dependency", "structure"] = Field(
        ..., description="Which pipeline step produced this finding"
    )
    severity: Literal["critical", "high", "medium", "low"] = Field(
        ..., description="Severity level"
    )
    description: str = Field(..., description="Human-readable description of the issue")
    suggested_fix: str | None = Field(None, description="Optional remediation hint")
    cycle_path: list[str] | None = Field(
        None, description="Populated only for circular_dependency findings; each element is 'file:line imports file'"
    )


class ReviewReport(BaseModel):
    """The merged output of the entire review pipeline."""

    score: int = Field(..., ge=0, le=100, description="Overall health score 0–100")
    review: str = Field(..., description="Prose summary of the review")
    improvements: list[str] = Field(..., description="Ordered list of improvement suggestions")
    bugs: list[Bug] = Field(..., description="All findings (lint, OSV, LLM, structural)")


# ─── Internal pipeline models ─────────────────────────────────────────────────

class DiffHunk(BaseModel):
    """A single changed hunk from a PR diff."""

    file: str
    line_start: int
    line_end: int
    content: str
    patch: str = ""


class ImpactSlice(BaseModel):
    """A code slice extracted by the impact slicer."""

    file: str
    line_start: int
    line_end: int
    symbol: str
    distance: int = Field(..., description="0 = direct diff, 1 = direct caller/callee, 2 = transitive")
    content: str
    token_count: int = 0


class LintFinding(BaseModel):
    """A finding produced by a deterministic linter (ruff/eslint/golangci-lint)."""

    file: str
    line: int
    rule: str
    severity: Literal["error", "warning"]
    message: str
    linter: str = ""


class StructureFinding(BaseModel):
    """A structural or circular-dependency finding (rule-based, no LLM)."""

    type: Literal["circular_dependency", "layout"]
    file: str = ""
    line_start: int = 0
    line_end: int = 0
    description: str = ""
    cycle_path: list[str] | None = None  # each element: "file:line imports file"
    severity: Literal["critical", "high", "medium", "low"] = "high"


class OsvVulnerability(BaseModel):
    """A vulnerability found by osv-scanner."""

    package_name: str
    package_version: str
    vuln_id: str
    severity: Literal["critical", "high", "medium", "low"]
    description: str
    manifest_file: str = ""
    manifest_line: int | None = None  # None = transitive dep, not directly listed in manifest


class LLMFinding(BaseModel):
    """A finding produced by the LLM review step."""

    file: str
    line_start: int
    line_end: int
    severity: Literal["critical", "high", "medium", "low"]
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence score 0.0–1.0")
    description: str
    suggested_fix: str | None = None


# ─── API request/response bodies ─────────────────────────────────────────────

class TriggerReviewRequest(BaseModel):
    repo_url: str = Field(..., description="HTTPS clone URL of the repository")
    pr_number: int = Field(..., gt=0, description="Pull request number")


class TriggerReviewResponse(BaseModel):
    review_id: str
    status: Literal["queued"] = "queued"


class ReviewStatusResponse(BaseModel):
    review_id: str
    status: Literal["queued", "running", "completed", "failed"]
    repo_url: str
    pr_number: int
    created_at: str
    report: ReviewReport | None = None
    error: str | None = None


class ReviewListItem(BaseModel):
    review_id: str
    repo_url: str
    pr_number: int
    status: Literal["queued", "running", "completed", "failed"]
    score: int | None = None
    finding_count: int | None = None
    created_at: str
