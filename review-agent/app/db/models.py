"""
db/models.py — SQLAlchemy ORM models for review-agent's own storage.

This service owns its own database (review history). It does NOT read/write
the Supabase project used by frontend/backend.

Table: reviews
  id          — UUID primary key
  repo_url    — HTTPS URL of the reviewed repository
  pr_number   — Pull request number
  user_id     — Forwarded from backend (X-User-Id header)
  user_email  — Forwarded from backend (X-User-Email header)
  status      — queued | running | completed | failed
  report_json — Serialized ReviewReport (JSON text) or null
  error       — Error message if status=failed
  created_at  — Timestamp
  updated_at  — Timestamp
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    repo_url: Mapped[str] = mapped_column(String(512), nullable=False)
    pr_number: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[str] = mapped_column(String(256), nullable=False)
    user_email: Mapped[str] = mapped_column(String(256), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="queued"
    )
    report_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )
