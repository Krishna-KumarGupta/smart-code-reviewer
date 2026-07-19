from __future__ import annotations

import logging
from typing import Any, TypedDict
from langgraph.graph import StateGraph, START, END

from app.models import LLMFinding

logger = logging.getLogger(__name__)


class ReviewGraphState(TypedDict):
    # Inputs (immutable)
    diff_context: str
    impact_slices_text: str
    lint_findings: list[Any]
    circular_findings: list[Any]
    diff_files: set[str]
    context_bounds: dict[str, tuple[int, int]]
    retry_feedback: str

    # Counters
    retry_count: int

    # Outputs
    review_text: str
    improvements: list[str]
    valid_findings: list[LLMFinding]
    invalid_findings: list[tuple[LLMFinding, str]]


def _build_context_bounds(diff_hunks: list[Any], slices: list[Any]) -> dict[str, tuple[int, int]]:
    bounds: dict[str, tuple[int, int]] = {}
    for hunk in diff_hunks:
        f = hunk.file
        start = hunk.line_start
        end = hunk.line_end
        if f not in bounds:
            bounds[f] = (start, end)
        else:
            bounds[f] = (min(bounds[f][0], start), max(bounds[f][1], end))

    for sl in slices:
        f = sl.file
        start = sl.line_start
        end = sl.line_end
        if f not in bounds:
            bounds[f] = (start, end)
        else:
            bounds[f] = (min(bounds[f][0], start), max(bounds[f][1], end))

    return bounds


def _node_generate_review(state: ReviewGraphState) -> dict[str, Any]:
    from app.review.llm_client import LLMReviewClient
    client = LLMReviewClient()

    diff_context = state["diff_context"]
    if state.get("retry_feedback"):
        diff_context += (
            "\n\n## CORRECTION REQUIRED — Previous findings were invalid\n\n"
            "Your previous response contained findings that cited files or line ranges not in the provided context:\n"
            f"{state['retry_feedback']}\n\n"
            "Only cite files and line numbers that appear in the diff or impact context above."
        )
        logger.info("[langgraph_review] Retrying review with feedback appended to prompt.")
    else:
        logger.info("[langgraph_review] Generating initial LLM review.")

    review_text, improvements, findings = client.review(
        diff_context=diff_context,
        impact_slices_text=state["impact_slices_text"],
        lint_findings=state["lint_findings"],
        circular_findings=state["circular_findings"],
        diff_files=state["diff_files"],
    )

    return {
        "review_text": review_text,
        "improvements": improvements,
        "valid_findings": findings,
        "invalid_findings": [],
    }


def _node_verify_findings(state: ReviewGraphState) -> dict[str, Any]:
    context_bounds = state["context_bounds"]
    raw_findings = state["valid_findings"]

    valid: list[LLMFinding] = []
    invalid: list[tuple[LLMFinding, str]] = []

    for f in raw_findings:
        if f.file not in context_bounds:
            reason = f"cited file '{f.file}' was not in the provided context"
            invalid.append((f, reason))
            logger.warning(f"[langgraph_review] Finding invalid: {reason}")
            continue

        if (f.line_start is not None and f.line_start > 0) or (f.line_end is not None and f.line_end > 0):
            min_line, max_line = context_bounds[f.file]
            start = f.line_start or 0
            end = f.line_end or 0
            if start < min_line or end > max_line:
                reason = f"lines {start}-{end} are outside context range {min_line}-{max_line} for '{f.file}'"
                invalid.append((f, reason))
                logger.warning(f"[langgraph_review] Finding invalid: {reason}")
                continue

        valid.append(f)

    return {
        "valid_findings": valid,
        "invalid_findings": invalid,
    }


def _should_retry(state: ReviewGraphState) -> str:
    if state["invalid_findings"] and state["retry_count"] == 0:
        return "retry"
    return "finalize"


def _node_retry_setup(state: ReviewGraphState) -> dict[str, Any]:
    feedback_lines = []
    for f, reason in state["invalid_findings"]:
        feedback_lines.append(f"- File: {f.file}, Line Range: {f.line_start}-{f.line_end} -> Reason: {reason}")
    feedback_str = "\n".join(feedback_lines)

    return {
        "retry_count": state["retry_count"] + 1,
        "retry_feedback": feedback_str,
    }


def _node_finalize(state: ReviewGraphState) -> dict[str, Any]:
    logger.info(
        "[langgraph_review] Finalizing review. Valid findings: %d, Invalid dropped: %d",
        len(state["valid_findings"]),
        len(state["invalid_findings"]),
    )
    return {}


# Build the state graph
builder = StateGraph(ReviewGraphState)
builder.add_node("generate_review", _node_generate_review)
builder.add_node("verify_findings", _node_verify_findings)
builder.add_node("retry_setup", _node_retry_setup)
builder.add_node("finalize", _node_finalize)

builder.add_edge(START, "generate_review")
builder.add_edge("generate_review", "verify_findings")
builder.add_conditional_edges(
    "verify_findings",
    _should_retry,
    {
        "retry": "retry_setup",
        "finalize": "finalize",
    },
)
builder.add_edge("retry_setup", "generate_review")
builder.add_edge("finalize", END)

_GRAPH = builder.compile()


def run_llm_review_graph(
    diff_context: str,
    impact_slices_text: str,
    lint_findings: list[Any],
    circular_findings: list[Any],
    diff_files: set[str],
    diff_hunks: list[Any],
    slices: list[Any],
) -> tuple[str, list[str], list[LLMFinding]]:
    context_bounds = _build_context_bounds(diff_hunks, slices)

    initial_state: ReviewGraphState = {
        "diff_context": diff_context,
        "impact_slices_text": impact_slices_text,
        "lint_findings": lint_findings,
        "circular_findings": circular_findings,
        "diff_files": diff_files,
        "context_bounds": context_bounds,
        "retry_feedback": "",
        "retry_count": 0,
        "review_text": "",
        "improvements": [],
        "valid_findings": [],
        "invalid_findings": [],
    }

    result = _GRAPH.invoke(initial_state)
    return result["review_text"], result["improvements"], result["valid_findings"]
