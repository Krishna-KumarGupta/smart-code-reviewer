from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.config import get_settings
from app.models import DiffHunk, ImpactSlice, LLMFinding
from app.review.llm_client import run_llm_review


@pytest.fixture(autouse=True)
def reset_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_all_valid_findings_single_pass(monkeypatch):
    monkeypatch.setenv("LLM_ORCHESTRATION", "langgraph")
    get_settings.cache_clear()

    diff_hunks = [
        DiffHunk(file="app/main.py", line_start=10, line_end=20, content="+x = 1"),
    ]
    slices = [
        ImpactSlice(file="app/utils.py", line_start=5, line_end=15, symbol="helper", distance=0, content="def helper():pass"),
    ]

    mock_findings = [
        LLMFinding(
            file="app/main.py",
            line_start=12,
            line_end=15,
            severity="low",
            confidence=0.8,
            description="low severity finding",
        ),
        LLMFinding(
            file="app/utils.py",
            line_start=8,
            line_end=12,
            severity="medium",
            confidence=0.9,
            description="medium severity finding",
        ),
    ]

    with patch("app.review.llm_client.LLMReviewClient") as MockClient:
        mock_instance = MockClient.return_value
        mock_instance.review.return_value = ("Prose review text.", ["Improvement 1"], mock_findings)

        review_text, improvements, findings = run_llm_review(
            diff_context="diff context",
            impact_slices_text="slices text",
            lint_findings=[],
            circular_findings=[],
            diff_files={"app/main.py"},
            diff_hunks=diff_hunks,
            slices=slices,
        )

        assert mock_instance.review.call_count == 1
        assert review_text == "Prose review text."
        assert improvements == ["Improvement 1"]
        assert len(findings) == 2
        assert findings[0].file == "app/main.py"
        assert findings[1].file == "app/utils.py"


def test_invalid_finding_triggers_single_retry(monkeypatch):
    monkeypatch.setenv("LLM_ORCHESTRATION", "langgraph")
    get_settings.cache_clear()

    diff_hunks = [
        DiffHunk(file="app/main.py", line_start=10, line_end=20, content="+x = 1"),
    ]
    slices = []

    # First pass: returns 1 invalid finding (file not in context) and 1 valid finding
    first_pass_findings = [
        LLMFinding(
            file="nonexistent.py",
            line_start=5,
            line_end=10,
            severity="high",
            confidence=0.7,
            description="invalid finding",
        ),
        LLMFinding(
            file="app/main.py",
            line_start=12,
            line_end=15,
            severity="low",
            confidence=0.8,
            description="valid finding",
        ),
    ]

    # Second pass: returns only the valid finding
    second_pass_findings = [
        LLMFinding(
            file="app/main.py",
            line_start=12,
            line_end=15,
            severity="low",
            confidence=0.8,
            description="valid finding",
        ),
    ]

    with patch("app.review.llm_client.LLMReviewClient") as MockClient:
        mock_instance = MockClient.return_value
        # Side effect returns first pass then second pass
        mock_instance.review.side_effect = [
            ("First review", ["Improvement 1"], first_pass_findings),
            ("Second review", ["Improvement 1"], second_pass_findings),
        ]

        review_text, improvements, findings = run_llm_review(
            diff_context="diff context",
            impact_slices_text="slices text",
            lint_findings=[],
            circular_findings=[],
            diff_files={"app/main.py"},
            diff_hunks=diff_hunks,
            slices=slices,
        )

        assert mock_instance.review.call_count == 2
        # Check retry feedback was passed to the second call's diff_context
        second_call_args = mock_instance.review.call_args_list[1][1]
        assert "CORRECTION REQUIRED" in second_call_args["diff_context"]
        assert "cited file 'nonexistent.py' was not in the provided context" in second_call_args["diff_context"]

        assert review_text == "Second review"
        assert len(findings) == 1
        assert findings[0].file == "app/main.py"


def test_two_invalid_passes_no_third_loop(monkeypatch):
    monkeypatch.setenv("LLM_ORCHESTRATION", "langgraph")
    get_settings.cache_clear()

    diff_hunks = [
        DiffHunk(file="app/main.py", line_start=10, line_end=20, content="+x = 1"),
    ]
    slices = []

    # First pass invalid range
    first_pass_findings = [
        LLMFinding(
            file="app/main.py",
            line_start=1,
            line_end=5,
            severity="high",
            confidence=0.7,
            description="invalid range",
        ),
    ]

    # Second pass also invalid range
    second_pass_findings = [
        LLMFinding(
            file="app/main.py",
            line_start=30,
            line_end=35,
            severity="high",
            confidence=0.7,
            description="still invalid range",
        ),
    ]

    with patch("app.review.llm_client.LLMReviewClient") as MockClient:
        mock_instance = MockClient.return_value
        mock_instance.review.side_effect = [
            ("First review", [], first_pass_findings),
            ("Second review", [], second_pass_findings),
        ]

        review_text, improvements, findings = run_llm_review(
            diff_context="diff context",
            impact_slices_text="slices text",
            lint_findings=[],
            circular_findings=[],
            diff_files={"app/main.py"},
            diff_hunks=diff_hunks,
            slices=slices,
        )

        # Should stop after exactly 2 calls and drop the invalid ones, returning empty findings
        assert mock_instance.review.call_count == 2
        assert review_text == "Second review"
        assert len(findings) == 0


def test_simple_orchestration_no_graph(monkeypatch):
    monkeypatch.setenv("LLM_ORCHESTRATION", "simple")
    get_settings.cache_clear()

    mock_findings = [
        LLMFinding(
            file="app/main.py",
            line_start=12,
            line_end=15,
            severity="low",
            confidence=0.8,
            description="valid finding",
        )
    ]

    with patch("app.review.llm_client.LLMReviewClient") as MockClient:
        mock_instance = MockClient.return_value
        mock_instance.review.return_value = ("Simple review", [], mock_findings)

        # Even with nonexistent files or missing hunks, simple client should return exactly what LLM outputs without validating
        review_text, improvements, findings = run_llm_review(
            diff_context="diff context",
            impact_slices_text="slices text",
            lint_findings=[],
            circular_findings=[],
            diff_files={"app/main.py"},
            diff_hunks=[],
            slices=[],
        )

        assert mock_instance.review.call_count == 1
        assert review_text == "Simple review"
        assert len(findings) == 1
        assert findings[0].file == "app/main.py"
