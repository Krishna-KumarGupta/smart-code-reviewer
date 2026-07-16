"""
test_osv_parser.py — Tests for the OSV scanner output parser.

Verifies:
  1. A known-vulnerable package is detected from a mock osv-scanner response.
  2. Severity is correctly resolved.
  3. The manifest file and line number are correctly cross-referenced.
"""

import os
from pathlib import Path
from unittest.mock import patch

import pytest

from app.vuln.osv_parser import parse_osv_output, _find_package_line, _resolve_severity

VULN_FIXTURE_DIR = str(Path(__file__).parent / "fixtures" / "vuln_repo")

# Realistic osv-scanner v2 JSON output for requests==2.19.1
MOCK_OSV_JSON = {
    "results": [
        {
            "source": {
                "path": "requirements.txt",
                "type": "lockfile"
            },
            "packages": [
                {
                    "package": {
                        "name": "requests",
                        "version": "2.19.1",
                        "ecosystem": "PyPI"
                    },
                    "vulnerabilities": [
                        {
                            "id": "GHSA-9wx4-h78v-vm56",
                            "summary": "Improper Authentication in requests",
                            "database_specific": {
                                "severity": "HIGH"
                            },
                            "severity": []
                        }
                    ]
                }
            ]
        }
    ]
}


class TestOsvParser:
    def test_detects_vulnerable_package(self):
        vulns = parse_osv_output(MOCK_OSV_JSON, VULN_FIXTURE_DIR)
        assert vulns, "Expected at least one vulnerability"

    def test_package_name_is_correct(self):
        vulns = parse_osv_output(MOCK_OSV_JSON, VULN_FIXTURE_DIR)
        assert any(v.package_name == "requests" for v in vulns)

    def test_package_version_is_correct(self):
        vulns = parse_osv_output(MOCK_OSV_JSON, VULN_FIXTURE_DIR)
        assert any(v.package_version == "2.19.1" for v in vulns)

    def test_vuln_id_is_correct(self):
        vulns = parse_osv_output(MOCK_OSV_JSON, VULN_FIXTURE_DIR)
        assert any(v.vuln_id == "GHSA-9wx4-h78v-vm56" for v in vulns)

    def test_severity_is_high(self):
        vulns = parse_osv_output(MOCK_OSV_JSON, VULN_FIXTURE_DIR)
        vuln = next(v for v in vulns if v.vuln_id == "GHSA-9wx4-h78v-vm56")
        assert vuln.severity == "high"

    def test_manifest_file_is_requirements_txt(self):
        vulns = parse_osv_output(MOCK_OSV_JSON, VULN_FIXTURE_DIR)
        assert any(v.manifest_file == "requirements.txt" for v in vulns)

    def test_manifest_line_is_correct(self):
        """The vulnerable package appears on line 4 in the fixture requirements.txt (after 3 comment lines)."""
        vulns = parse_osv_output(MOCK_OSV_JSON, VULN_FIXTURE_DIR)
        vuln = next(v for v in vulns if v.package_name == "requests")
        assert vuln.manifest_line > 0, "manifest_line should be > 0"
        # Line 4 in the fixture (3 comment lines, then requests==2.19.1)
        assert vuln.manifest_line == 4, (
            f"Expected manifest_line=4, got {vuln.manifest_line}"
        )

    def test_empty_osv_json_returns_no_vulns(self):
        vulns = parse_osv_output({}, VULN_FIXTURE_DIR)
        assert vulns == []

    def test_osv_json_with_no_results_returns_empty(self):
        vulns = parse_osv_output({"results": []}, VULN_FIXTURE_DIR)
        assert vulns == []


class TestSeverityResolution:
    def test_critical_string(self):
        vuln = {"database_specific": {"severity": "CRITICAL"}}
        assert _resolve_severity(vuln) == "critical"

    def test_high_string(self):
        vuln = {"database_specific": {"severity": "HIGH"}}
        assert _resolve_severity(vuln) == "high"

    def test_moderate_maps_to_medium(self):
        vuln = {"database_specific": {"severity": "MODERATE"}}
        assert _resolve_severity(vuln) == "medium"

    def test_low_string(self):
        vuln = {"database_specific": {"severity": "LOW"}}
        assert _resolve_severity(vuln) == "low"

    def test_cvss_9_5_is_critical(self):
        vuln = {"severity": [{"type": "CVSS_V3", "score": "9.5"}]}
        assert _resolve_severity(vuln) == "critical"

    def test_cvss_7_5_is_high(self):
        vuln = {"severity": [{"type": "CVSS_V3", "score": "7.5"}]}
        assert _resolve_severity(vuln) == "high"

    def test_cvss_5_0_is_medium(self):
        vuln = {"severity": [{"type": "CVSS_V3", "score": "5.0"}]}
        assert _resolve_severity(vuln) == "medium"

    def test_cvss_2_0_is_low(self):
        vuln = {"severity": [{"type": "CVSS_V3", "score": "2.0"}]}
        assert _resolve_severity(vuln) == "low"

    def test_no_severity_info_defaults_to_medium(self):
        vuln = {}
        assert _resolve_severity(vuln) == "medium"


class TestFindPackageLine:
    def test_finds_requests_line_in_fixture(self):
        req_file = str(Path(VULN_FIXTURE_DIR) / "requirements.txt")
        line = _find_package_line(req_file, "requests", "2.19.1")
        assert line == 4, f"Expected line 4, got {line}"

    def test_returns_none_for_unknown_package(self):
        req_file = str(Path(VULN_FIXTURE_DIR) / "requirements.txt")
        line = _find_package_line(req_file, "nonexistent-package", "9.9.9")
        assert line is None

    def test_returns_none_for_nonexistent_file(self):
        line = _find_package_line("/does/not/exist/requirements.txt", "pkg", "1.0")
        assert line is None
