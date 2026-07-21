#!/bin/sh

# Start FastAPI / Uvicorn server in background
uvicorn app.main:app --host 0.0.0.0 --port 5050 &

# Start Celery worker in foreground
exec celery -A app.celery_app worker --loglevel=info --concurrency=2

