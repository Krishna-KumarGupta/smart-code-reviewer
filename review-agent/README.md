# review-agent

> **Internal-only microservice** · AI Code Review pipeline for Smart Code Reviewer

---

## Overview

`review-agent` is a Python FastAPI microservice that reviews GitHub pull requests
using LLM-assisted analysis, static import-graph cycle detection, OSV vulnerability
scanning, and deterministic linting. It returns a unified `ReviewReport` (score,
review, improvements, bugs) for every PR.

It is called **exclusively server-to-server by `backend`**. The frontend never
talks to it directly.

---

## ⚠️ Network Posture — READ THIS FIRST

**This service must NOT be reachable from the public internet.**

In production:
- Deploy `review-agent` inside a private Docker network / VPC / internal service mesh.
- Only `backend` should be able to reach port 5050.
- Remove the `ports:` mapping for `review-agent` in `docker-compose.yml` in production.

The `X-Service-Api-Key` check is **defense-in-depth** on top of network isolation.
It protects against misconfigured network rules but is not a substitute for them.
An attacker with network access and a brute-forced key could still make requests.
Network isolation is the primary control.

```
Internet → [Load Balancer] → backend:5000 → [internal network] → review-agent:5050
                                                                → redis
Internet ↛ review-agent (blocked at network boundary)
```

---

## Architecture

```
frontend (React/Vite)
    ↓  JWT auth (Supabase)
backend (Node/Express)
    ↓  X-Service-Api-Key + X-User-Id + X-User-Email + X-User-Role
review-agent (FastAPI)
    ↓  Celery task enqueue
    ├── 5a. Structure/lint checker (ruff / eslint / golangci-lint)
    ├── 5b. Impact slicer (tree-sitter, BFS depth-2)
    ├── 5c. Circular dependency detector (networkx.simple_cycles)
    ├── 5d. OSV vulnerability scanner
    └── 5e. LLM review (Claude, structured tool-use)
              ↓  merge + score
         ReviewReport → stored in DB → returned to backend
```

---

## API

All routes except `/health` and `/webhook/github` require `X-Service-Api-Key`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | None | Liveness probe |
| `POST` | `/webhook/github` | GitHub HMAC | Receive GitHub PR events |
| `POST` | `/reviews` | Service key | Trigger a review |
| `GET` | `/reviews/{id}` | Service key | Fetch review result |
| `GET` | `/reviews?repo=...` | Service key | List reviews |

### Required headers for service-key-protected routes

| Header | Required | Description |
|--------|----------|-------------|
| `X-Service-Api-Key` | ✅ | Shared secret matching `SERVICE_API_KEY` env var |
| `X-User-Id` | ✅ | Supabase user UUID (forwarded by backend) |
| `X-User-Email` | ✅ | User email (forwarded by backend) |
| `X-User-Role` | Optional | e.g. `admin` — trusted as-is, backend already authorized |

---

## Curl example — correctly authenticated request

```bash
# Trigger a review
curl -X POST http://localhost:5050/reviews \
  -H "Content-Type: application/json" \
  -H "X-Service-Api-Key: your-shared-secret-here" \
  -H "X-User-Id: 550e8400-e29b-41d4-a716-446655440000" \
  -H "X-User-Email: developer@example.com" \
  -H "X-User-Role: user" \
  -d '{"repo_url": "https://github.com/owner/repo", "pr_number": 42}'

# Poll the result
curl http://localhost:5050/reviews/REVIEW_ID_HERE \
  -H "X-Service-Api-Key: your-shared-secret-here" \
  -H "X-User-Id: 550e8400-e29b-41d4-a716-446655440000" \
  -H "X-User-Email: developer@example.com"

# Health check (no auth needed)
curl http://localhost:5050/health
```

---

## Local Development

### Prerequisites

- Python 3.12+
- Redis (local or Docker)
- `osv-scanner` v2 in PATH (optional — scan step skipped if absent)
- `ruff` in PATH (or installed via pip)

### Setup

```bash
cd review-agent

# Create .env
cp .env.example .env
# Edit .env — fill in SERVICE_API_KEY, ANTHROPIC_API_KEY, GITHUB_WEBHOOK_SECRET

# Install dependencies
pip install -e ".[dev]"

# Start FastAPI server
uvicorn app.main:app --reload --port 5050

# In a separate terminal — start Celery worker
celery -A app.celery_app worker --loglevel=info
```

### Run tests

```bash
cd review-agent
pytest tests/ -v
```

---

## Docker (all services)

From the repo root:

```bash
docker-compose up --build
```

Services:
- Frontend: http://localhost:5173 (requires `--profile full`)
- Backend:  http://localhost:5000
- review-agent: http://localhost:5050 (internal — remove port mapping in production)

---

## Environment Variables

See [`.env.example`](.env.example) for the full list with descriptions.

Key variables:

| Variable | Description |
|----------|-------------|
| `SERVICE_API_KEY` | Shared secret for backend→review-agent auth |
| `GITHUB_WEBHOOK_SECRET` | HMAC secret for GitHub webhook verification |
| `ANTHROPIC_API_KEY` | Claude API key |
| `REDIS_URL` | Redis connection URL (broker + result backend) |
| `DATABASE_URL` | SQLAlchemy async URL (Postgres or SQLite) |
| `IMPACT_SLICE_MAX_TOKENS` | Max LLM context tokens (default 20000) |

---

## Output Schema

```python
class ReviewReport(BaseModel):
    score: int          # 0–100
    review: str         # Prose summary
    improvements: list[str]
    bugs: list[Bug]

class Bug(BaseModel):
    file: str
    line_start: int
    line_end: int
    source: Literal["lint", "osv", "llm", "circular_dependency", "structure"]
    severity: Literal["critical", "high", "medium", "low"]
    description: str
    suggested_fix: str | None
    cycle_path: list[str] | None  # populated for circular_dependency findings
```

---

## Scoring

```
score = 100
− 15/10/5/2  per OSV vuln (critical/high/medium/low)
− 5/2         per lint finding (error/warning)
− 8           per circular dep cycle (capped at 24)
− 12/8/4/1 × confidence per LLM finding (critical/high/medium/low)
− 3           per layout rule violation
= clamp(score, 0, 100)
```

All weights are configurable via `SCORE_WEIGHT_*` env vars.
