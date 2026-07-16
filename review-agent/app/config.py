"""
config.py — Application settings via pydantic-settings.

All values are read from environment variables / .env file.
Override the scoring weights by setting the corresponding env vars.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Server ───────────────────────────────────────────────────────────────
    port: int = 5050
    environment: Literal["development", "production", "test"] = "development"

    # ── Service-to-service auth ───────────────────────────────────────────────
    service_api_key: str = Field(..., description="Shared secret with backend service")

    # ── GitHub ────────────────────────────────────────────────────────────────
    github_webhook_secret: str = Field(..., description="HMAC secret for GitHub webhook")
    github_app_token: str = Field("", description="GitHub token for API calls")

    # ── Redis / Celery ────────────────────────────────────────────────────────
    redis_url: str = "redis://localhost:6379/0"

    # ── LLM ──────────────────────────────────────────────────────────────────
    # When routing through OpenRouter, OPENAI_API_KEY holds your OpenRouter key
    # and OPENROUTER_BASE_URL points to the OpenRouter API endpoint.
    openai_api_key: str = Field(..., description="OpenRouter (or OpenAI) API key")
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    # OpenRouter model IDs require a provider prefix, e.g. openai/gpt-5-mini.
    # To use direct OpenAI instead, clear OPENROUTER_BASE_URL and use gpt-5-mini.
    openai_model: str = "openai/gpt-5-mini"

    # ── Impact slicing ────────────────────────────────────────────────────────
    impact_slice_max_tokens: int = 20_000

    # ── Email Settings ────────────────────────────────────────────────────────
    email_enabled: bool = False
    email_provider: Literal["brevo", "ses"] = "brevo"
    brevo_api_key: str | None = None
    brevo_sender_email: str | None = None
    brevo_sender_name: str = "review-agent"
    aws_ses_access_key: str | None = None
    aws_ses_secret_key: str | None = None
    aws_ses_region: str = "us-east-1"
    aws_ses_sender_email: str | None = None
    frontend_review_url_base: str = "http://localhost:5173/reviews"

    # ── GitHub Comment Settings ───────────────────────────────────────────────
    github_comment_enabled: bool = False
    github_comment_max_inline: int = 15

    # ── Database ──────────────────────────────────────────────────────────────
    database_url: str = "sqlite+aiosqlite:///./review_agent.db"

    @property
    def DATABASE_URL(self) -> str:  # noqa: N802 — uppercase alias for convenience
        """Uppercase alias so both settings.DATABASE_URL and settings.database_url work."""
        return self.database_url

    # ── Scoring weights ───────────────────────────────────────────────────────
    score_weight_osv_critical: int = 15
    score_weight_osv_high: int = 10
    score_weight_osv_medium: int = 5
    score_weight_osv_low: int = 2

    score_weight_lint_error: int = 5
    score_weight_lint_warning: int = 2

    score_weight_circular_dep: int = 8
    score_weight_circular_dep_cap: int = 24

    score_weight_llm_critical: int = 12
    score_weight_llm_high: int = 8
    score_weight_llm_medium: int = 4
    score_weight_llm_low: int = 1

    score_weight_structure: int = 3


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached singleton Settings instance."""
    return Settings()
