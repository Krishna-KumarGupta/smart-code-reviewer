"""
structure/circular_deps.py — Static import-graph construction and cycle detection.

Strategy (spec §5c):
  1. Walk all source files in the repo (Python / JS / TS / Go).
  2. For each file, parse ONLY import/require statements via tree-sitter.
  3. Resolve each import to another file in the repo (drop third-party/external).
  4. Build a networkx.DiGraph: node=file, edge=import with source line.
  5. Run nx.simple_cycles() to enumerate all cycles.
  6. Emit one StructureFinding per cycle, with cycle_path listing every
     "fileA:line imports fileB" edge that forms the cycle.

Runs over the ENTIRE repo, not just the diff — cheap because there's no LLM.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

import networkx as nx

from app.models import StructureFinding
from app.slicing.symbols import detect_language

logger = logging.getLogger(__name__)


# ─── Import parsing ───────────────────────────────────────────────────────────

def _parse_python_imports(source: str, filepath: str) -> list[tuple[str, int]]:
    """
    Parse Python `import X` and `from X import Y` statements.
    Returns list of (raw_module_path, line_number).
    """
    results: list[tuple[str, int]] = []

    try:
        from tree_sitter_language_pack import get_parser  # type: ignore
        parser = get_parser("python")
    except Exception:
        # Fallback: regex
        for i, line in enumerate(source.splitlines(), 1):
            m = re.match(r"^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.,\s]+))", line)
            if m:
                mod = m.group(1) or m.group(2).split(",")[0].strip()
                results.append((mod, i))
        return results

    tree = parser.parse(source.encode())

    def _walk(node) -> None:
        if node.type == "import_statement":
            for child in node.children:
                if child.type == "dotted_name":
                    results.append((child.text.decode(), node.start_point[0] + 1))
        elif node.type == "import_from_statement":
            for child in node.children:
                if child.type == "dotted_name":
                    results.append((child.text.decode(), node.start_point[0] + 1))
                    break  # first dotted_name is the module
        for child in node.children:
            _walk(child)

    _walk(tree.root_node)
    return results


def _parse_js_imports(source: str) -> list[tuple[str, int]]:
    """
    Parse JS/TS `import ... from '...'` and `require('...')`.
    Returns list of (specifier, line_number).
    """
    results: list[tuple[str, int]] = []

    try:
        from tree_sitter_language_pack import get_parser  # type: ignore
        parser = get_parser("javascript")
    except Exception:
        # Fallback: regex
        for i, line in enumerate(source.splitlines(), 1):
            m = re.search(r"""(?:import\s+.*?\s+from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))""", line)
            if m:
                spec = m.group(1) or m.group(2)
                results.append((spec, i))
        return results

    tree = parser.parse(source.encode())

    def _walk(node) -> None:
        if node.type in ("import_statement", "import_declaration"):
            for child in node.children:
                if child.type == "string":
                    spec = child.text.decode().strip("\"'")
                    results.append((spec, node.start_point[0] + 1))
        elif node.type == "call_expression":
            # require('...')
            fn = node.child_by_field_name("function")
            args = node.child_by_field_name("arguments")
            if fn and fn.text == b"require" and args:
                for arg in args.children:
                    if arg.type == "string":
                        spec = arg.text.decode().strip("\"'")
                        results.append((spec, node.start_point[0] + 1))
        for child in node.children:
            _walk(child)

    _walk(tree.root_node)
    return results


def _parse_go_imports(source: str) -> list[tuple[str, int]]:
    """
    Parse Go `import (...)` and single-line `import "..."` statements.
    Returns list of (import_path, line_number).
    """
    results: list[tuple[str, int]] = []

    try:
        from tree_sitter_language_pack import get_parser  # type: ignore
        parser = get_parser("go")
    except Exception:
        for i, line in enumerate(source.splitlines(), 1):
            m = re.search(r'import\s+"([^"]+)"', line)
            if m:
                results.append((m.group(1), i))
        return results

    tree = parser.parse(source.encode())

    def _walk(node) -> None:
        if node.type == "import_spec":
            path_node = node.child_by_field_name("path")
            if path_node:
                spec = path_node.text.decode().strip('"')
                results.append((spec, node.start_point[0] + 1))
        for child in node.children:
            _walk(child)

    _walk(tree.root_node)
    return results


# ─── Import resolution ────────────────────────────────────────────────────────

def _resolve_python_import(
    specifier: str,
    importing_file: str,
    file_set: set[str],
) -> str | None:
    """
    Try to resolve a Python module specifier to a file in the repo.
    Handles relative imports (dots prefix).
    Returns relative file path or None if external.
    """
    # Strip any "from X" style — we only have the module name
    module = specifier.strip()
    is_relative = module.startswith(".")
    if is_relative:
        module = module.lstrip(".")

    # module.submodule → module/submodule.py or module/submodule/__init__.py
    parts = module.replace(".", "/") if module else ""
    base = Path(importing_file).parent if is_relative else Path("")

    candidates = [
        str(base / f"{parts}.py"),
        str(base / parts / "__init__.py"),
        f"{parts}.py",
        f"{parts}/__init__.py",
    ]
    for c in candidates:
        normalized = str(Path(c))
        if normalized in file_set:
            return normalized
    return None


def _resolve_js_import(
    specifier: str,
    importing_file: str,
    file_set: set[str],
) -> str | None:
    """
    Try to resolve a JS/TS import specifier (relative only — external packages start with letter/@ ).
    """
    if not specifier.startswith("."):
        return None  # External package

    base = Path(importing_file).parent
    target = (base / specifier).resolve()

    # Try several extensions
    for ext in ["", ".js", ".jsx", ".ts", ".tsx", "/index.js", "/index.ts"]:
        candidate = str(target) + ext
        # Normalize to relative from repo root (approximate)
        for f in file_set:
            if f.endswith(candidate.replace("\\", "/").split("/")[-1]):
                return f
    return None


def _resolve_go_import(
    specifier: str,
    all_files: set[str],
) -> str | None:
    """
    Match a Go import path to a directory in the repo (Go modules).
    If the specifier's last component matches a directory that contains .go files,
    return the representative file.
    """
    last = specifier.split("/")[-1]
    for f in all_files:
        if f.endswith(".go") and f.startswith(last + "/") or ("/" + last + "/") in f:
            return f
    return None


# ─── Main entry point ─────────────────────────────────────────────────────────

def detect_circular_dependencies(
    repo_dir: str,
    all_files: list[str],
) -> list[StructureFinding]:
    """
    Build the import graph and detect all circular dependency cycles.

    Args:
        repo_dir:   Absolute path to the cloned repository.
        all_files:  All source file paths in the repo (relative to repo_dir).

    Returns:
        One StructureFinding per cycle, with cycle_path populated.
    """
    graph: nx.DiGraph = nx.DiGraph()
    file_set = set(all_files)

    # node → list of (imported_file, line_number) for edge labelling
    edge_lines: dict[tuple[str, str], int] = {}

    for filepath in all_files:
        lang = detect_language(filepath)
        if lang not in ("python", "javascript", "typescript", "go"):
            continue

        full_path = Path(repo_dir) / filepath
        try:
            source = full_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue

        graph.add_node(filepath)

        if lang == "python":
            raw_imports = _parse_python_imports(source, filepath)
            resolve_fn = lambda spec, f: _resolve_python_import(spec, f, file_set)
        elif lang in ("javascript", "typescript"):
            raw_imports = _parse_js_imports(source)
            resolve_fn = lambda spec, f: _resolve_js_import(spec, f, file_set)
        elif lang == "go":
            raw_imports = _parse_go_imports(source)
            resolve_fn = lambda spec, _: _resolve_go_import(spec, file_set)
        else:
            continue

        for specifier, line_no in raw_imports:
            resolved = resolve_fn(specifier, filepath)
            if resolved and resolved != filepath:
                graph.add_edge(filepath, resolved)
                edge_lines[(filepath, resolved)] = line_no

    # ── Cycle detection via networkx ──────────────────────────────────────────
    findings: list[StructureFinding] = []

    try:
        cycles = list(nx.simple_cycles(graph))
    except Exception as exc:
        logger.error("[circular_deps] simple_cycles failed: %s", exc)
        return []

    for cycle in cycles:
        if len(cycle) < 2:
            continue

        # Build the cycle_path: ["fileA:12 imports fileB", "fileB:5 imports fileA", ...]
        cycle_path: list[str] = []
        for i, src_file in enumerate(cycle):
            dst_file = cycle[(i + 1) % len(cycle)]
            line_no = edge_lines.get((src_file, dst_file), 0)
            cycle_path.append(f"{src_file}:{line_no} imports {dst_file}")

        findings.append(StructureFinding(
            type="circular_dependency",
            description=f"Circular dependency detected: {' → '.join(cycle + [cycle[0]])}",
            severity="high",
            cycle_path=cycle_path,
            file=cycle[0],
            line_start=edge_lines.get((cycle[0], cycle[1]), 0),
            line_end=edge_lines.get((cycle[0], cycle[1]), 0),
        ))

    logger.info(
        "[circular_deps] Detected %d cycle(s) across %d files",
        len(findings), graph.number_of_nodes()
    )
    return findings
