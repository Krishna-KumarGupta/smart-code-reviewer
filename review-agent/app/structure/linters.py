"""
structure/linters.py — Subprocess wrappers for deterministic linters.

Supported linters:
  - ruff      (Python)   — ruff check --output-format json
  - eslint    (JS/TS)    — eslint --format json (requires eslint in PATH)
  - golangci-lint (Go)   — golangci-lint run --out-format json

Each wrapper returns a list of LintFinding. Failures in any linter are
caught and logged as warnings — they do not abort the pipeline.
"""

from __future__ import annotations

import asyncio
import json
import logging

from app.models import LintFinding

logger = logging.getLogger(__name__)


async def _run_subprocess(args: list[str], cwd: str) -> tuple[int, str, str]:
    """Run a subprocess and return (returncode, stdout, stderr)."""
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )
        stdout, stderr = await proc.communicate()
        return proc.returncode, stdout.decode(errors="replace"), stderr.decode(errors="replace")
    except FileNotFoundError:
        logger.warning("[linters] Binary not found: %s", args[0])
        return -1, "", f"{args[0]} not found in PATH"
    except Exception as exc:
        logger.warning("[linters] Subprocess error: %s", exc)
        return -1, "", str(exc)


# ─── ruff (Python) ────────────────────────────────────────────────────────────

async def run_ruff(repo_dir: str) -> list[LintFinding]:
    """
    Run ruff check in JSON output mode.
    Linters exit non-zero when findings exist; that's expected.
    """
    rc, stdout, stderr = await _run_subprocess(
        ["ruff", "check", "--output-format", "json", "."],
        cwd=repo_dir,
    )
    if rc == -1:
        return []

    findings: list[LintFinding] = []
    try:
        data = json.loads(stdout or "[]")
    except json.JSONDecodeError:
        logger.warning("[linters] ruff produced invalid JSON: %s", stdout[:200])
        return []

    for item in data:
        # ruff JSON: { filename, row, col, code, message, fix?, ... }
        findings.append(LintFinding(
            file=item.get("filename", ""),
            line=item.get("location", {}).get("row", 0),
            rule=item.get("code", "RUFF"),
            severity="error" if item.get("fix") is None else "warning",
            message=item.get("message", ""),
            linter="ruff",
        ))

    logger.info("[linters] ruff: %d finding(s)", len(findings))
    return findings


# ─── eslint (JS/TS) ───────────────────────────────────────────────────────────

async def run_eslint(repo_dir: str) -> list[LintFinding]:
    """
    Run eslint in JSON output mode.
    eslint exits 1 when lint errors exist — still parse the output.
    """
    rc, stdout, stderr = await _run_subprocess(
        ["npx", "eslint", "--format", "json", "."],
        cwd=repo_dir,
    )
    if rc == -1:
        return []

    findings: list[LintFinding] = []
    try:
        data = json.loads(stdout or "[]")
    except json.JSONDecodeError:
        logger.warning("[linters] eslint produced invalid JSON: %s", stdout[:200])
        return []

    for file_result in data:
        filepath = file_result.get("filePath", "")
        for msg in file_result.get("messages", []):
            sev_code = msg.get("severity", 1)
            severity = "error" if sev_code == 2 else "warning"
            findings.append(LintFinding(
                file=filepath,
                line=msg.get("line", 0),
                rule=msg.get("ruleId") or "eslint",
                severity=severity,
                message=msg.get("message", ""),
                linter="eslint",
            ))

    logger.info("[linters] eslint: %d finding(s)", len(findings))
    return findings


# ─── golangci-lint (Go) ───────────────────────────────────────────────────────

async def run_golangci_lint(repo_dir: str) -> list[LintFinding]:
    """
    Run golangci-lint in JSON output mode.
    """
    rc, stdout, stderr = await _run_subprocess(
        ["golangci-lint", "run", "--out-format", "json"],
        cwd=repo_dir,
    )
    if rc == -1:
        return []

    findings: list[LintFinding] = []
    try:
        data = json.loads(stdout or "{}")
    except json.JSONDecodeError:
        logger.warning("[linters] golangci-lint produced invalid JSON: %s", stdout[:200])
        return []

    for issue in data.get("Issues") or []:
        pos = issue.get("Pos", {})
        sev_raw = issue.get("Severity", "warning")
        findings.append(LintFinding(
            file=pos.get("Filename", ""),
            line=pos.get("Line", 0),
            rule=issue.get("FromLinter", "golangci-lint"),
            severity="error" if sev_raw in ("error", "critical") else "warning",
            message=issue.get("Text", ""),
            linter="golangci-lint",
        ))

    logger.info("[linters] golangci-lint: %d finding(s)", len(findings))
    return findings


# ─── Dispatcher ───────────────────────────────────────────────────────────────

async def run_linters(repo_dir: str, stack: str | None) -> list[LintFinding]:
    """Run the appropriate linter(s) for the detected stack."""
    if stack == "python":
        return await run_ruff(repo_dir)
    elif stack == "node":
        return await run_eslint(repo_dir)
    elif stack == "go":
        return await run_golangci_lint(repo_dir)
    else:
        logger.info("[linters] No linter mapped for stack=%s — skipping", stack)
        return []
