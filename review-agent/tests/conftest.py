"""conftest.py — shared pytest fixtures."""

import os
import pytest


@pytest.fixture(autouse=True)
def set_test_env(monkeypatch):
    """
    Set required environment variables for all tests before any module-level code runs.
    Also clears the lru_cache on get_settings() so each test gets a fresh Settings.
    """
    monkeypatch.setenv("SERVICE_API_KEY", "test-secret-key-1234")
    monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", "test-webhook-secret")
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///./test_review_agent.db")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")

    # Clear the cached Settings instance so each test sees the monkeypatched env
    from app.config import get_settings
    get_settings.cache_clear()

    yield

    # Clear again after the test so the next test starts fresh
    get_settings.cache_clear()
