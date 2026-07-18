"""
vuln/osv_runner.py — Subprocess wrapper for osv-scanner v2.

Runs: osv-scanner scan -r --format json <repo_dir>
Returns the raw parsed JSON output dict.

osv-scanner exits non-zero when vulnerabilities are found — we always
parse stdout regardless of exit code (as long as it produced JSON).
"""

from __future__ import annotations

import asyncio
import json
import logging

logger = logging.getLogger(__name__)

_OSV_BINARY = "osv-scanner"


async def run_osv_scanner(repo_dir: str) -> dict:
    """
    Execute osv-scanner on the given directory and return its JSON output.

    Args:
        repo_dir: Absolute path to the repository to scan.

    Returns:
        Parsed JSON dict from osv-scanner. Empty dict on failure.
    """
    args = [_OSV_BINARY, "scan", "-r", "--format", "json", repo_dir]
    logger.info("[osv_runner] Running: %s", " ".join(args))

    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
    except FileNotFoundError:
        logger.warning("[osv_runner] osv-scanner binary not found in PATH — skipping vuln scan")
        return {}
    except Exception as exc:
        logger.error("[osv_runner] Unexpected error: %s", exc)
        return {}

    stdout_str = stdout.decode(errors="replace").strip()
    stderr_str = stderr.decode(errors="replace").strip()

    if stderr_str:
        logger.debug("[osv_runner] stderr: %s", stderr_str[:500])

    # Exit code 128 is osv-scanner v2's ErrNoPackagesFound — the scanner ran
    # successfully but found no recognisable dependency manifests in the repo.
    # This is a valid, non-error outcome (e.g. a C or shell-only project).
    if proc.returncode == 128:
        logger.info(
            "[osv_runner] No dependency manifests found in %s "
            "(osv-scanner exit 128 / ErrNoPackagesFound) — skipping vuln results",
            repo_dir,
        )
        return {}

    if not stdout_str:
        if proc.returncode != 0:
            logger.error(
                "[osv_runner] osv-scanner exited with code %s and produced no output",
                proc.returncode,
            )
        else:
            logger.info("[osv_runner] osv-scanner produced no output (exit code 0)")
        return {}

    try:
        result = json.loads(stdout_str)
        logger.info("[osv_runner] Scan complete — exit code %s", proc.returncode)
        return result
    except json.JSONDecodeError as exc:
        logger.warning("[osv_runner] Could not parse osv-scanner JSON output: %s", exc)
        return {}
