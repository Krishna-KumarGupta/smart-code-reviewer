# ─── Stage 1: Builder ────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
WORKDIR /build

# System deps for building Python packages (asyncpg, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps into /build/venv
COPY pyproject.toml .
RUN pip install --no-cache-dir hatchling && \
    pip install --no-cache-dir -e ".[dev]"

# ─── Stage 2: osv-scanner binary ────────────────────────────────────────────
# Download osv-scanner v2 Linux AMD64 binary
FROM debian:bookworm-slim AS osv-downloader
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL \
      https://github.com/google/osv-scanner/releases/download/v2.0.0/osv-scanner_linux_amd64 \
      -o /usr/local/bin/osv-scanner && \
    chmod +x /usr/local/bin/osv-scanner

# ─── Stage 3: Runtime image ──────────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

# Runtime system libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy osv-scanner
COPY --from=osv-downloader /usr/local/bin/osv-scanner /usr/local/bin/osv-scanner

# Install ruff (linter)
RUN pip install --no-cache-dir ruff

# Install Python packages
COPY pyproject.toml .
RUN pip install --no-cache-dir hatchling && \
    pip install --no-cache-dir -e .

# Copy application source
COPY app/ ./app/

# Non-root user for security
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

# Expose FastAPI port
EXPOSE 5050

# Default command: FastAPI server.
# Override with "celery worker" command in docker-compose for the worker service.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5050"]
