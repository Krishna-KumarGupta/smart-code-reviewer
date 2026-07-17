"""
celery_app.py — Celery application instance.

The broker and result backend both point at Redis (REDIS_URL setting).
Workers are started with:
  celery -A app.celery_app worker --loglevel=info
"""


from celery import Celery

from app.config import get_settings


def _make_celery() -> Celery:
    settings = get_settings()
    app = Celery(
        "review_agent",
        broker=settings.redis_url,
        backend=settings.redis_url,
        include=["app.tasks"],
    )
    app.conf.update(
        task_serializer="json",
        result_serializer="json",
        accept_content=["json"],
        timezone="UTC",
        enable_utc=True,
        task_track_started=True,
        task_acks_late=True,          # Don't ack until task is fully done
        worker_prefetch_multiplier=1, # One task at a time per worker process
        result_expires=86400,         # Celery results expire after 1 day
    )
    return app


celery_app = _make_celery()