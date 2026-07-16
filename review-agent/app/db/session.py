"""
db/session.py — Async SQLAlchemy engine and session factory.

Supports both PostgreSQL (asyncpg) and SQLite (aiosqlite) via the
DATABASE_URL setting. SQLite is convenient for local development without
a running Postgres instance.

Usage:
    async with get_session() as session:
        session.add(review)
        await session.commit()
"""

from __future__ import annotations

from contextlib import asynccontextmanager
import logging
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings
from app.db.models import Base

logger = logging.getLogger(__name__)


def _create_engine():
    settings = get_settings()
    db_url = settings.database_url

    # SQLite needs check_same_thread=False equivalent (handled by aiosqlite)
    connect_args = {}
    if db_url.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
    else:
        # Supabase and other hosted Postgres instances require SSL
        connect_args = {"ssl": "require"}

    return create_async_engine(
        db_url,
        echo=settings.environment == "development",
        pool_pre_ping=True,
        connect_args=connect_args,
    )



# Module-level singletons — created on first import
_engine = None
_session_factory = None


def get_engine():
    global _engine
    if _engine is None:
        _engine = _create_engine()
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            bind=get_engine(),
            expire_on_commit=False,
            class_=AsyncSession,
        )
    return _session_factory


async def dispose_engine() -> None:
    """Dispose the async engine and reset module-level singletons.

    Must be called (and awaited) at the end of every asyncio.run() scope
    that uses the engine — e.g. in the finally block of each Celery task's
    _run_async function.  Without this, pooled asyncpg connections remain
    bound to an event loop that has already been closed, causing:

        RuntimeError: Event loop is closed

    on the *next* task when SQLAlchemy tries to reuse or terminate them.
    """
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None


@asynccontextmanager
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Context manager yielding an async session with automatic commit/rollback."""
    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db() -> None:
    """Create all tables if they don't exist (idempotent)."""
    from sqlalchemy import text, inspect
    engine = get_engine()
    
    # 1. Create tables if they don't exist (run in their own transaction)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # 2. Inspect existing columns to prevent running redundant ALTER statements
    existing_columns = set()
    try:
        async with engine.connect() as conn:
            def get_cols(sync_conn):
                inspector = inspect(sync_conn)
                return [c["name"] for c in inspector.get_columns("reviews")]
            cols = await conn.run_sync(get_cols)
            existing_columns = {col.lower() for col in cols}
    except Exception as exc:
        logger.warning("Could not inspect reviews table columns: %s. Will fallback to running ALTER and catching errors.", exc)

    # 3. Helper to run each ALTER in its own transaction/connection
    async def add_column_if_missing(column_name: str, alter_sql: str):
        if column_name.lower() in existing_columns:
            logger.info("Column '%s' already exists in 'reviews' table, skipping ALTER.", column_name)
            return

        try:
            async with engine.begin() as conn:
                await conn.execute(text(alter_sql))
            logger.info("Successfully added column '%s' to 'reviews' table.", column_name)
        except Exception as exc:
            exc_str = str(exc).lower()
            # Postgres duplicate column error: 'column "..." of relation "reviews" already exists'
            # SQLite duplicate column error: 'duplicate column name: ...'
            if "already exists" in exc_str or "duplicate column name" in exc_str or "duplicate column" in exc_str:
                logger.info("Column '%s' already exists (caught from DB exception).", column_name)
            else:
                logger.error("Database migration error while adding %s: %s", column_name, exc)

    await add_column_if_missing(
        "email_sent",
        "ALTER TABLE reviews ADD COLUMN email_sent BOOLEAN NOT NULL DEFAULT FALSE"
    )
    await add_column_if_missing(
        "email_error",
        "ALTER TABLE reviews ADD COLUMN email_error TEXT"
    )
    await add_column_if_missing(
        "github_comment_posted",
        "ALTER TABLE reviews ADD COLUMN github_comment_posted BOOLEAN NOT NULL DEFAULT FALSE"
    )
    await add_column_if_missing(
        "github_comment_error",
        "ALTER TABLE reviews ADD COLUMN github_comment_error TEXT"
    )

