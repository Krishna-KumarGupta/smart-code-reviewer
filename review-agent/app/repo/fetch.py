"""
repo/fetch.py — Blobless shallow clone of a target repository.

Strategy (from spec §4):
  git clone --filter=blob:none --depth=1 --no-checkout <url> <dir>
  git fetch --depth=1 origin <base_sha> <head_sha>
  git checkout <head_sha>

Pre-check: if ALL changed files match the docs/asset ignore list, skip the
full clone and return early — no LLM tokens wasted.

Cleanup: caller must call cleanup_clone(tmpdir) in a finally block.
"""

import asyncio
import logging
import re
import shutil
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Dependency manifest / lockfile safelist
# ---------------------------------------------------------------------------
# These filenames (matched against the basename of the changed file) are
# NEVER considered docs/assets — they must always flow through the full
# pipeline so that osv-scanner can inspect them.
#
# Rule: if a file's basename appears here it is automatically treated as
# code, regardless of its extension or directory.
_MANIFEST_FILENAMES: frozenset[str] = frozenset({
    # Python
    "requirements.txt",
    "requirements-dev.txt",
    "requirements-test.txt",
    "Pipfile",
    "Pipfile.lock",
    "pyproject.toml",
    "setup.cfg",
    "setup.py",
    "poetry.lock",
    # Node / JS / TS
    "package.json",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    ".npmrc",
    # Go
    "go.mod",
    "go.sum",
    # Ruby
    "Gemfile",
    "Gemfile.lock",
    # Rust
    "Cargo.toml",
    "Cargo.lock",
    # Java / JVM
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "gradle.lockfile",
    "ivy.xml",
    # PHP
    "composer.json",
    "composer.lock",
    # .NET / NuGet
    "packages.config",
    # Swift / CocoaPods / SPM
    "Podfile",
    "Podfile.lock",
    "Package.swift",
    "Package.resolved",
    # Dart / Flutter
    "pubspec.yaml",
    "pubspec.lock",
    # Generic
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
})

# Patterns applied to the full file path.  A file is skipped only if:
#   (a) its basename is NOT in _MANIFEST_FILENAMES, AND
#   (b) its path matches at least one of the patterns below.
_DOCS_ASSET_PATTERNS: list[re.Pattern] = [
    re.compile(r"\.md$", re.IGNORECASE),
    # .txt files are docs UNLESS they are a known manifest (requirements.txt
    # et al. are guarded by the safelist check that runs first).
    re.compile(r"\.txt$", re.IGNORECASE),
    re.compile(r"\.rst$", re.IGNORECASE),
    re.compile(r"\.png$", re.IGNORECASE),
    re.compile(r"\.jpe?g$", re.IGNORECASE),
    re.compile(r"\.gif$", re.IGNORECASE),
    re.compile(r"\.svg$", re.IGNORECASE),
    re.compile(r"\.ico$", re.IGNORECASE),
    re.compile(r"\.pdf$", re.IGNORECASE),
    re.compile(r"^docs/", re.IGNORECASE),
    re.compile(r"^\.github/", re.IGNORECASE),
    re.compile(r"CHANGELOG", re.IGNORECASE),
    re.compile(r"LICENSE", re.IGNORECASE),
]


def _is_manifest(filename: str) -> bool:
    """Return True if *filename* is a known dependency manifest or lockfile.

    Checks the basename against ``_MANIFEST_FILENAMES`` so that paths like
    ``backend/requirements.txt`` are correctly identified regardless of their
    directory prefix.
    """
    name = Path(filename).name.lower()
    if name in {m.lower() for m in _MANIFEST_FILENAMES}:
        return True
    # Extension-based manifests (.csproj, .nuspec, .cabal, .gemspec, …)
    return Path(filename).suffix.lower() in {
        ".csproj", ".vbproj", ".fsproj", ".nuspec",
        ".cabal", ".gemspec",
    }


def is_docs_only(changed_files: list[str]) -> bool:
    """Return True if every changed file is a documentation or asset file.

    A file is **not** docs-only if:
      * Its basename matches a known dependency manifest / lockfile
        (``_MANIFEST_FILENAMES``), OR
      * Its path does not match any pattern in ``_DOCS_ASSET_PATTERNS``.

    Empty list → False (no files means something went wrong; don't skip).
    """
    if not changed_files:
        return False

    for f in changed_files:
        # Manifests always count as code — short-circuit immediately.
        if _is_manifest(f):
            return False
        # If no doc/asset pattern matches, this file is code → not docs-only.
        if not any(p.search(f) for p in _DOCS_ASSET_PATTERNS):
            return False

    return True


async def _run_git(args: list[str], cwd: str | None = None) -> str:
    """Run a git subprocess and return stdout. Raises on non-zero exit."""
    proc = await asyncio.create_subprocess_exec(
        "git", *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=cwd,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        err = stderr.decode(errors="replace").strip()
        raise RuntimeError(f"git {' '.join(args[:3])} failed: {err}")
    return stdout.decode(errors="replace").strip()


async def blobless_clone(clone_url: str, base_sha: str, head_sha: str, github_token: str | None = None) -> str:
    """
    Perform a blobless shallow clone and check out head_sha.

    Returns the path to the cloned directory (caller must call cleanup_clone).
    Raises RuntimeError on git failures.
    """
    tmpdir = tempfile.mkdtemp(prefix="review-agent-clone-")
    logger.info("[fetch] Cloning %s into %s", clone_url, tmpdir)

    authed_url = clone_url
    if github_token:
        authed_url = clone_url.replace("https://", f"https://x-access-token:{github_token}@", 1)

    try:
        # Step 1 — blobless, depth-1, no checkout
        await _run_git([
            "clone",
            "--filter=blob:none",
            "--depth=1",
            "--no-checkout",
            authed_url,
            tmpdir,
        ])

        # Step 2 — fetch both SHAs (needed for diff, even in depth-1 clone)
        await _run_git(
            ["fetch", "--depth=1", "origin", base_sha, head_sha],
            cwd=tmpdir,
        )

        # Step 3 — checkout head
        await _run_git(["checkout", head_sha], cwd=tmpdir)

        logger.info("[fetch] Clone ready at %s (head=%s)", tmpdir, head_sha[:8])
        return tmpdir

    except Exception:
        # Clean up on failure so we don't leak temp dirs
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise


def cleanup_clone(tmpdir: str) -> None:
    """Remove the cloned repository directory."""
    if tmpdir and Path(tmpdir).exists():
        shutil.rmtree(tmpdir, ignore_errors=True)
        logger.debug("[fetch] Cleaned up %s", tmpdir)
