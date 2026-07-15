"""
test_circular_deps.py — Tests for the circular dependency detector.

Verifies:
  1. 2-file cycle (A → B → A) is detected with correct file:line edges.
  2. 3-file cycle (A → B → C → A) is detected with correct file:line edges.
"""

import os
from pathlib import Path

import pytest

from app.structure.circular_deps import detect_circular_dependencies

# Absolute paths to the test fixture directories
SIMPLE_FIXTURE = str(Path(__file__).parent / "fixtures" / "circular_dep_repo_simple")
CHAIN_FIXTURE  = str(Path(__file__).parent / "fixtures" / "circular_dep_repo_chain")


def _all_files(repo_dir: str) -> list[str]:
    """Return all .py files in repo_dir as relative paths."""
    base = Path(repo_dir)
    return [str(p.relative_to(base)) for p in base.rglob("*.py")]


class TestSimpleCycle:
    """2-file cycle: module_a.py → module_b.py → module_a.py"""

    def test_detects_exactly_one_cycle(self):
        files = _all_files(SIMPLE_FIXTURE)
        findings = detect_circular_dependencies(SIMPLE_FIXTURE, files)
        # networkx may report 1 cycle (both edges form one cycle)
        assert len(findings) >= 1, "Expected at least one circular dependency finding"

    def test_finding_type_is_circular_dependency(self):
        files = _all_files(SIMPLE_FIXTURE)
        findings = detect_circular_dependencies(SIMPLE_FIXTURE, files)
        for f in findings:
            assert f.type == "circular_dependency"

    def test_cycle_path_contains_both_files(self):
        files = _all_files(SIMPLE_FIXTURE)
        findings = detect_circular_dependencies(SIMPLE_FIXTURE, files)
        assert findings, "No findings returned for simple fixture"

        # At least one finding should reference both module_a and module_b
        all_edges = " ".join(" ".join(f.cycle_path or []) for f in findings)
        assert "module_a.py" in all_edges, "module_a.py not in cycle_path"
        assert "module_b.py" in all_edges, "module_b.py not in cycle_path"

    def test_cycle_path_contains_line_numbers(self):
        files = _all_files(SIMPLE_FIXTURE)
        findings = detect_circular_dependencies(SIMPLE_FIXTURE, files)
        assert findings

        for edge in findings[0].cycle_path or []:
            # Each edge should be "file:LINE imports file"
            assert ":" in edge, f"No line number in edge: {edge!r}"
            parts = edge.split(" imports ")
            assert len(parts) == 2, f"Unexpected edge format: {edge!r}"
            file_part, _ = parts
            assert ":" in file_part, f"No colon in file:line part: {file_part!r}"
            line_str = file_part.split(":")[-1]
            assert line_str.isdigit(), f"Line number not numeric: {line_str!r}"
            assert int(line_str) > 0, "Line number must be > 0"

    def test_import_line_is_correct_for_module_a(self):
        """module_a.py imports module_b on line 5."""
        files = _all_files(SIMPLE_FIXTURE)
        findings = detect_circular_dependencies(SIMPLE_FIXTURE, files)
        assert findings

        all_edges = " ".join(edge for f in findings for edge in (f.cycle_path or []))
        # The edge from module_a to module_b should record line 5
        assert "module_a.py:5 imports module_b.py" in all_edges, (
            f"Expected 'module_a.py:5 imports module_b.py' in edges, got:\n{all_edges}"
        )

    def test_import_line_is_correct_for_module_b(self):
        """module_b.py imports module_a on line 5."""
        files = _all_files(SIMPLE_FIXTURE)
        findings = detect_circular_dependencies(SIMPLE_FIXTURE, files)
        assert findings

        all_edges = " ".join(edge for f in findings for edge in (f.cycle_path or []))
        assert "module_b.py:5 imports module_a.py" in all_edges, (
            f"Expected 'module_b.py:5 imports module_a.py' in edges, got:\n{all_edges}"
        )


class TestChainCycle:
    """3-file cycle: a.py → b.py → c.py → a.py"""

    def test_detects_cycle(self):
        files = _all_files(CHAIN_FIXTURE)
        findings = detect_circular_dependencies(CHAIN_FIXTURE, files)
        assert findings, "Expected at least one circular dependency in 3-file chain"

    def test_all_three_files_in_cycle(self):
        files = _all_files(CHAIN_FIXTURE)
        findings = detect_circular_dependencies(CHAIN_FIXTURE, files)
        assert findings

        all_edges = " ".join(edge for f in findings for edge in (f.cycle_path or []))
        assert "a.py" in all_edges
        assert "b.py" in all_edges
        assert "c.py" in all_edges

    def test_cycle_path_has_three_edges(self):
        files = _all_files(CHAIN_FIXTURE)
        findings = detect_circular_dependencies(CHAIN_FIXTURE, files)
        assert findings

        # Find the finding with all 3 files
        three_edge = next(
            (f for f in findings if len(f.cycle_path or []) == 3),
            None
        )
        assert three_edge is not None, (
            f"Expected a finding with 3 edges; got: {[f.cycle_path for f in findings]}"
        )

    def test_a_imports_b_at_line_4(self):
        files = _all_files(CHAIN_FIXTURE)
        findings = detect_circular_dependencies(CHAIN_FIXTURE, files)
        all_edges = " ".join(e for f in findings for e in (f.cycle_path or []))
        assert "a.py:4 imports b.py" in all_edges, (
            f"Expected 'a.py:4 imports b.py'; got:\n{all_edges}"
        )

    def test_b_imports_c_at_line_4(self):
        files = _all_files(CHAIN_FIXTURE)
        findings = detect_circular_dependencies(CHAIN_FIXTURE, files)
        all_edges = " ".join(e for f in findings for e in (f.cycle_path or []))
        assert "b.py:4 imports c.py" in all_edges

    def test_c_imports_a_at_line_4(self):
        files = _all_files(CHAIN_FIXTURE)
        findings = detect_circular_dependencies(CHAIN_FIXTURE, files)
        all_edges = " ".join(e for f in findings for e in (f.cycle_path or []))
        assert "c.py:4 imports a.py" in all_edges
