"""
tests/test_budget_enforcement.py — Tests for total prompt token budget hard cap enforcement.
"""

import logging
from unittest.mock import MagicMock, patch

from app.review.prompts import SYSTEM_PROMPT, build_user_message
from app.review.llm_client import LLMReviewClient
from app.slicing.budget import count_tokens, truncate_text_to_tokens


def test_truncate_text_to_tokens():
    text = "Word " * 1000
    truncated = truncate_text_to_tokens(text, max_tokens=100)
    assert count_tokens(truncated) <= 100
    assert "truncated" in truncated


def test_build_user_message_within_budget():
    diff = "diff --git a/foo.py b/foo.py\n+print('hello')"
    msg = build_user_message(
        diff_context=diff,
        impact_slices="slice content",
        lint_summary="lint finding",
        circular_summary="circular dep",
        max_tokens=20000,
    )
    total_tokens = count_tokens(SYSTEM_PROMPT) + count_tokens(msg)
    assert total_tokens <= 20000
    assert "hello" in msg


def test_build_user_message_huge_diff_hard_capped(caplog):
    # Simulate a massive diff (e.g., 30,000 words ~ 30,000 tokens)
    huge_diff = "def big_func():\n" + "    x = 1\n" * 15000
    orig_tokens = count_tokens(huge_diff)
    assert orig_tokens > 15000

    max_budget = 2000
    with caplog.at_level(logging.WARNING):
        msg = build_user_message(
            diff_context=huge_diff,
            impact_slices="some impact slices",
            lint_summary="some lint findings",
            circular_summary="some circular deps",
            max_tokens=max_budget,
        )

    total_tokens = count_tokens(SYSTEM_PROMPT) + count_tokens(msg)
    assert total_tokens <= max_budget
    assert "[budget] Hard-capping diff_context" in caplog.text


def test_build_user_message_priority_truncation(caplog):
    diff = "diff --git a/a.py b/a.py\n+a = 1"
    huge_lint = "lint error line\n" * 5000
    huge_circ = "circular dep cycle\n" * 5000

    max_budget = 1000
    with caplog.at_level(logging.WARNING):
        msg = build_user_message(
            diff_context=diff,
            impact_slices="some slices",
            lint_summary=huge_lint,
            circular_summary=huge_circ,
            max_tokens=max_budget,
        )

    total_tokens = count_tokens(SYSTEM_PROMPT) + count_tokens(msg)
    assert total_tokens <= max_budget
    # Diff should be preserved since summaries were truncated/dropped first
    assert "+a = 1" in msg


def test_llm_client_enforces_budget():
    huge_diff = "### massive.py\n```diff\n" + "+line\n" * 25000 + "```"
    client = LLMReviewClient()

    with patch.object(client._client.chat.completions, "create") as mock_create:
        mock_create.return_value.choices = [
            MagicMock(message=MagicMock(content='{"review": "ok", "improvements": [], "findings": []}'))
        ]
        mock_create.return_value.usage.prompt_tokens = 500

        client.review(
            diff_context=huge_diff,
            impact_slices_text="slices",
            lint_findings=[],
            circular_findings=[],
            diff_files={"massive.py"},
        )

        assert mock_create.called
        kwargs = mock_create.call_args.kwargs
        sent_user_msg = kwargs["messages"][1]["content"]
        total_sent_tokens = count_tokens(SYSTEM_PROMPT) + count_tokens(sent_user_msg)
        assert total_sent_tokens <= 20000
