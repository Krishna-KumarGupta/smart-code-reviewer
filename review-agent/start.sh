#!/bin/sh

# Start uvicorn (FastAPI) in the background
uvicorn app.main:app --host 0.0.0.0 --port 5050 &

# Start celery worker in the foreground
celery -A app.celery_app worker --loglevel=info --concurrency=2 --queues=celery
