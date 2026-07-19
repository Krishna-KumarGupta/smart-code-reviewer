# DECISIONS.md — Architectural decisions for `review-agent`

This file records every non-obvious design choice made during implementation,
particularly where the spec was ambiguous or where a sensible default was chosen.

---

## D-001 · Token counting approximation

**Decision**: Use `tiktoken` (cl100k_base encoding) for token counting in the
impact slicer, falling back to whitespace word-count if tiktoken is unavailable.

**Rationale**: Claude's tokenizer is not publicly documented, but cl100k_base
(GPT-4 / Claude-compatible) is a close approximation. The budget is a soft cap —
slightly over/under by a few percent is acceptable.

---

## D-002 · pyproject.toml over requirements.txt

**Decision**: Use `pyproject.toml` with `hatchling` as the build backend rather
than a bare `requirements.txt`.

**Rationale**: `pyproject.toml` is the modern Python standard (PEP 517/518).
It keeps dev and runtime deps clearly separated, and Hatchling is lightweight
with no additional config needed.

---

## D-003 · asyncio.run() inside Celery tasks

**Decision**: The Celery task (`tasks.py`) calls `asyncio.run()` to execute the
async pipeline steps.

**Rationale**: Celery workers are synchronous by default. Using `asyncio.run()`
allows the pipeline steps (GitHub API calls, subprocess linters, etc.) to run
concurrently via `asyncio.gather` without requiring a full async Celery setup.
The overhead of creating an event loop per task is acceptable for long-running
review jobs (seconds to minutes).

---

## D-004 · GitHub webhook in this service vs. backend

**Decision**: `review-agent` has its own `/webhook/github` endpoint for webhooks.

**Rationale**: The spec explicitly describes this endpoint as "the only public-facing
route." The existing backend already has a webhook handler, but the spec requires
review-agent to have its own — and in production the two can be used independently
(backend for repo management webhooks, review-agent for PR review triggers).

---

## D-005 · SQLite fallback for local development

**Decision**: `DATABASE_URL=sqlite+aiosqlite:///./review_agent.db` is the default
for local development (no Postgres required).

**Rationale**: Lowers the barrier to running the service locally. In CI/Docker,
Postgres via asyncpg is used. The SQLAlchemy ORM is database-agnostic.

---

## D-006 · networkx.simple_cycles for cycle detection

**Decision**: Use `nx.simple_cycles(graph)` exactly as specified; do not hand-roll
cycle detection.

**Rationale**: `simple_cycles` implements Johnson's algorithm (O((n+e)(c+1)) where
c = number of cycles). It enumerates all elementary cycles correctly. Hand-rolling
would introduce bugs and test burden.

---

## D-007 · Import resolution is file-scoped only (no runtime analysis)

**Decision**: The circular dependency checker resolves imports to files within the
repo only. External (third-party) packages are ignored. Dynamic imports and
conditional imports are not followed.

**Rationale**: Spec §5c explicitly says "static imports only — no call-graph or
runtime resolution." This keeps the step fast and free of false positives from
external libraries.

---

## D-008 · LLM review is synchronous within the Celery task

**Decision**: The `LLMReviewClient.review()` call is synchronous (not async) and
wrapped in `asyncio.to_thread()` inside the task.

**Rationale**: The Anthropic SDK is synchronous. `to_thread()` prevents it from
blocking the event loop during the concurrent pipeline steps.

---

## D-009 · Circular dep cap at 24 points (3 × 8)

**Decision**: The circular dependency score cap is 24 points (3 cycles × 8 per cycle)
as stated in spec §6, matching `score_weight_circular_dep_cap=24`.

**Rationale**: Spec is explicit. The cap prevents pathological repos with many
small cycles from reaching 0 via circular dep alone.

---

## D-010 · docker-compose frontend with `profiles: full`

**Decision**: The `frontend` service uses `profiles: [full]` in docker-compose.yml.

**Rationale**: The frontend has no Dockerfile yet. Adding `profiles: [full]` means
`docker-compose up` (without `--profile full`) skips frontend but starts everything
else. This avoids build failures when the frontend doesn't have a Dockerfile.

---

## D-011 · Error response shape matches backend convention

**Decision**: All HTTP errors from review-agent follow `{ success: false, error: "...", code: "..." }`
in the FastAPI `HTTPException.detail` dict.

**Rationale**: Matches the shape used by `backend`'s `errorHandler.js` and
`verifyJWT.js` (observed during codebase inspection). Consistency makes it easier
for `backend` to parse and forward errors to the frontend.

---

## D-012 · Webhook user context

**Decision**: When a review is triggered by GitHub webhook (not via `POST /reviews`),
the `user_id` and `user_email` stored in the DB are set to `"webhook"` and
`"webhook@github.com"` respectively.

**Rationale**: Webhooks arrive from GitHub, not an authenticated user. The field
cannot be null (schema constraint), and using a sentinel value makes the trigger
source auditable in the reviews table.
