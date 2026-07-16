"""
structure/checker.py — Language/framework detection and directory layout checking.

Detects the stack from manifest files (pyproject.toml, package.json, go.mod, etc.)
then applies YAML rules from app/structure/rules/<stack>.yaml.

Returns StructureFinding objects with type="layout" for violations.
"""

from __future__ import annotations

import fnmatch
import logging
from pathlib import Path

import yaml

from app.models import StructureFinding

logger = logging.getLogger(__name__)

_RULES_DIR = Path(__file__).parent / "rules"

# Detection priority: first match wins
_MANIFEST_TO_STACK: list[tuple[str, str]] = [
    ("pyproject.toml", "python"),
    ("setup.py",       "python"),
    ("setup.cfg",      "python"),
    ("requirements.txt", "python"),
    ("go.mod",         "go"),
    ("package.json",   "node"),
]


def detect_stack(repo_dir: str) -> str | None:
    """
    Detect the primary language/stack from manifest files in repo_dir.
    Returns a stack name ("python", "node", "go") or None if unknown.
    """
    root = Path(repo_dir)
    for manifest, stack in _MANIFEST_TO_STACK:
        if (root / manifest).exists():
            logger.info("[checker] Detected stack=%s via %s", stack, manifest)
            return stack
    return None


def _load_rules(stack: str) -> dict | None:
    rules_file = _RULES_DIR / f"{stack}.yaml"
    if not rules_file.exists():
        return None
    with rules_file.open() as f:
        return yaml.safe_load(f)


def check_layout(repo_dir: str, all_files: list[str]) -> tuple[list[StructureFinding], str | None]:
    """
    Check the repository layout against the detected stack's rules.

    Args:
        repo_dir:   Absolute path to the cloned repo.
        all_files:  List of all file paths in the repo (relative).

    Returns:
        (findings, stack_name) — findings is a list of StructureFinding (type="layout").
        stack_name is None if the stack was not detected.
    """
    stack = detect_stack(repo_dir)
    if stack is None:
        logger.info("[checker] No known stack detected — skipping layout check")
        return [], None

    rules = _load_rules(stack)
    if rules is None:
        logger.warning("[checker] No rules file for stack=%s", stack)
        return [], stack

    findings: list[StructureFinding] = []
    file_set = set(all_files)

    # ── Required / recommended paths ─────────────────────────────────────────
    for rule in rules.get("rules", []):
        if rule.get("optional", True):
            continue  # Skip optional rules (advisory only, not violations)

        path_pattern = rule["path"]
        desc = rule["description"]
        sev = rule.get("severity", "warning")

        matched = any(
            fnmatch.fnmatch(f, path_pattern) or f.startswith(path_pattern)
            for f in file_set
        )
        if not matched:
            findings.append(StructureFinding(
                type="layout",
                description=f"[{stack}] {desc}",
                severity=_map_severity(sev),
                line_start=0,
                line_end=0,
            ))

    # ── Forbidden paths ───────────────────────────────────────────────────────
    for rule in rules.get("forbidden", []):
        path_pattern = rule["path"]
        desc = rule["description"]
        sev = rule.get("severity", "warning")

        for f in file_set:
            if fnmatch.fnmatch(f, path_pattern) or f.startswith(path_pattern.rstrip("/")):
                findings.append(StructureFinding(
                    type="layout",
                    file=f,
                    description=f"[{stack}] {desc}",
                    severity=_map_severity(sev),
                    line_start=0,
                    line_end=0,
                ))
                break  # One finding per rule is enough

    logger.info("[checker] Layout check: %d finding(s) for stack=%s", len(findings), stack)
    return findings, stack


def _map_severity(raw: str) -> str:
    mapping = {"error": "high", "warning": "low", "info": "low"}
    return mapping.get(raw, "low")
