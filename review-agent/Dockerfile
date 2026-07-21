# ─── Stage 1: Builder ────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

# System deps for building Python packages (asyncpg, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    curl \
    git \
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
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy osv-scanner
COPY --from=osv-downloader /usr/local/bin/osv-scanner /usr/local/bin/osv-scanner

# Install ruff (linter)
RUN pip install --no-cache-dir ruff

# Install Python packages
COPY pyproject.toml .
RUN pip install --no-cache-dir hatchling && \
    pip install --no-cache-dir -e .

# Copy application source and startup script
COPY app/ ./app/
COPY start.sh .

# Ensure start.sh has execute permissions
RUN chmod +x start.sh

# Non-root user for security
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

# Expose FastAPI port
EXPOSE 5050

# Command to run both FastAPI and Celery Worker
CMD ["./start.sh"]
