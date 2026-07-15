"""
vuln/osv_parser.py — Parse osv-scanner JSON output into OsvVulnerability objects.

osv-scanner v2 JSON output shape:
{
  "results": [
    {
      "source": { "path": "requirements.txt", "type": "lockfile" },
      "packages": [
        {
          "package": { "name": "requests", "version": "2.19.1", "ecosystem": "PyPI" },
          "vulnerabilities": [
            {
              "id": "CVE-2018-18074",
              "summary": "...",
              "database_specific": { "severity": "HIGH" },
              "severity": [{ "type": "CVSS_V3", "score": "CVSS:3.1/AV:N/..." }]
            }
          ]
        }
      ]
    }
  ]
}

We also cross-reference each vulnerable package name/version back to its
manifest/lockfile to get the exact line number.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

from app.models import OsvVulnerability

logger = logging.getLogger(__name__)


# ─── Severity resolution ──────────────────────────────────────────────────────

def _cvss_score_to_severity(score_str: str) -> str:
    """
    Map a numeric CVSS score (embedded in CVSS vector string or standalone)
    to critical/high/medium/low.
    """
    # CVSS:3.1/AV:N/.../S:X — extract base score from the database_specific field instead
    return "medium"  # fallback


def _resolve_severity(vuln: dict) -> str:
    """
    Attempt severity resolution in priority order:
      1. database_specific.severity (string: CRITICAL/HIGH/MEDIUM/LOW)
      2. severity[0].score CVSS base score
      3. Default: medium
    """
    db_sev = vuln.get("database_specific", {}).get("severity", "")
    if db_sev:
        mapping = {
            "CRITICAL": "critical",
            "HIGH": "high",
            "MODERATE": "medium",
            "MEDIUM": "medium",
            "LOW": "low",
        }
        normalized = mapping.get(db_sev.upper())
        if normalized:
            return normalized

    # Try CVSS numeric score
    severities = vuln.get("severity", [])
    for sev_entry in severities:
        score_str = sev_entry.get("score", "")
        # Extract base score (e.g. "7.5" from "CVSS:3.1/AV:N/...")
        numeric_match = re.search(r"(\d+\.\d+)$", score_str)
        if numeric_match:
            score = float(numeric_match.group(1))
            if score >= 9.0:
                return "critical"
            elif score >= 7.0:
                return "high"
            elif score >= 4.0:
                return "medium"
            else:
                return "low"

    return "medium"


# ─── Manifest line resolution ─────────────────────────────────────────────────

def _find_package_line(manifest_path: str, pkg_name: str, pkg_version: str) -> int | None:
    """
    Scan the manifest file for the first line mentioning package_name==version
    (or package_name~=version etc.). Returns None if not found — callers must
    treat None as "location unknown" (transitive dependency not directly listed).
    """
    try:
        content = Path(manifest_path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None

    # Match patterns like: requests==2.19.1, requests~=2.19, requests>=2.19.0
    # Also handles package.json "requests": "2.19.1" and go.mod
    patterns = [
        re.compile(rf"""{re.escape(pkg_name)}\s*[=~^<>!]+\s*{re.escape(pkg_version)}""", re.IGNORECASE),
        re.compile(rf"""["']{re.escape(pkg_name)}["']\s*:\s*["'^~>=<]*{re.escape(pkg_version)}""", re.IGNORECASE),
        re.compile(rf"""{re.escape(pkg_name)}\s+v?{re.escape(pkg_version)}""", re.IGNORECASE),
    ]

    lines = content.splitlines()

    # Primary: match exact package==version (skip comment/blank lines)
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        for pat in patterns:
            if pat.search(line):
                return i

    # Fallback: just look for the package name on a non-comment line
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if pkg_name.lower() in line.lower():
            return i

    # Package not directly listed (transitive dependency)
    return None


# ─── Main parser ──────────────────────────────────────────────────────────────

def parse_osv_output(osv_json: dict, repo_dir: str) -> list[OsvVulnerability]:
    """
    Convert osv-scanner JSON output into OsvVulnerability objects.

    Args:
        osv_json: Parsed dict from osv_runner.run_osv_scanner().
        repo_dir: Absolute path to the cloned repo (for manifest line lookup).

    Returns:
        List of OsvVulnerability objects.
    """
    vulns: list[OsvVulnerability] = []

    for result in osv_json.get("results", []):
        source = result.get("source", {})
        raw_path = source.get("path", "")

        # osv-scanner v2 may emit an absolute path for the manifest file
        # (e.g. the full temp-clone path).  Strip the repo_dir prefix so the
        # field matches the repo-relative format used everywhere else in the
        # report (e.g. "requirements.txt", not "C:/tmp/review-agent-clone-xyz/requirements.txt").
        if raw_path:
            try:
                manifest_rel = str(
                    Path(raw_path).relative_to(repo_dir)
                ).replace("\\", "/")
            except ValueError:
                # raw_path was already relative, or uses a different root — keep as-is
                manifest_rel = raw_path.replace("\\", "/")
        else:
            manifest_rel = ""

        manifest_abs = str(Path(repo_dir) / manifest_rel) if manifest_rel else ""

        for pkg_entry in result.get("packages", []):
            pkg = pkg_entry.get("package", {})
            pkg_name = pkg.get("name", "")
            pkg_version = pkg.get("version", "")

            for vuln in pkg_entry.get("vulnerabilities", []):
                vuln_id = vuln.get("id", "UNKNOWN")
                summary = vuln.get("summary", vuln.get("details", "No description available"))
                severity = _resolve_severity(vuln)

                # _find_package_line returns None when the package is not
                # directly listed in the manifest (i.e. it's a transitive
                # dependency).  We propagate None so the report omits
                # line_start/line_end rather than falsely reporting line 0.
                manifest_line: int | None = None
                if manifest_abs:
                    manifest_line = _find_package_line(manifest_abs, pkg_name, pkg_version)

                vulns.append(OsvVulnerability(
                    package_name=pkg_name,
                    package_version=pkg_version,
                    vuln_id=vuln_id,
                    severity=severity,
                    description=f"{vuln_id}: {summary}",
                    manifest_file=manifest_rel,
                    manifest_line=manifest_line,
                ))

    logger.info("[osv_parser] Parsed %d vulnerability/ies", len(vulns))
    return vulns
