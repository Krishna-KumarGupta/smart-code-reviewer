# webhook-service

Dedicated GitHub webhook receiver for Smart Code Reviewer.  This service is the **primary** handler for all GitHub webhook events. A backend failover layer (via nginx) ensures zero webhook-loss if this service is temporarily unavailable.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Primary / Failover Design](#2-primary--failover-design)
3. [nginx Configuration](#3-nginx-configuration)
4. [HMAC Independence](#4-hmac-independence)
5. [Duplicate Delivery Detection](#5-duplicate-delivery-detection)
6. [Environment Variables](#6-environment-variables)
7. [Running Locally](#7-running-locally)
8. [Verifying Failover](#8-verifying-failover)
9. [Webhook URL Migration](#9-webhook-url-migration)

---

## 1. Architecture Overview

```
GitHub
  │  POST /api/github/webhook
  ▼
nginx :8080  ──────────────────────────────────────────────────────────┐
  │                                                                    │
  │  proxy_pass (primary)                                              │
  ▼                                                                    │
webhook-service :5001                                                  │
  │  ✓ Verify HMAC-SHA256                                              │
  │  ✓ Deduplicate via X-GitHub-Delivery (Redis TTL 24 h)             │
  │  ✓ Route to Celery task queue                                      │
  │                                                                    │
  │  (if error / timeout / 5xx)                                        │
  │  proxy_next_upstream (automatic, no client retry)                  │
  ▼                                                                    │
backend :5000  ◀──────────────────────────────────────────────────────┘
  │  ✓ Verify HMAC-SHA256  (independently)
  │  ✓ Deduplicate via X-GitHub-Delivery (same Redis instance)
  │  ✓ Route to Celery task queue  (same queue)
```

### Key properties

| Property | Detail |
|----------|--------|
| **Webhook entry point** | `http://localhost:8080/api/github/webhook` (nginx) |
| **Primary handler** | `webhook-service` on port 5001 |
| **Failover handler** | `backend` on port 5000 |
| **Failover type** | Passive (nginx `proxy_next_upstream`) |
| **Failover latency** | < 5 s (connect timeout) |
| **Duplicate protection** | Redis key `webhook_delivery:<X-GitHub-Delivery>` with 24 h TTL |

---

## 2. Primary / Failover Design

### Why webhook-service is primary

`webhook-service` is a lightweight, single-purpose Node.js service with no database writes on the hot path beyond deduplication. It has lower latency and a smaller failure surface than `backend`.

### Why backend remains active

`backend`'s `githubWebhookController` / `githubWebhookService` remain fully operational as a live failover target. They share the same Redis broker and Celery queue, so a task queued by either service is processed identically by the Celery worker.

### Failover trigger conditions

nginx retries against `backend` if `webhook-service` returns:

- TCP connection refused / reset (`error`)
- Connect / read / send timeout exceeded (`timeout`)
- HTTP 502, 503, or 504 (`http_502 http_503 http_504`)

Up to **2 upstream attempts** total. Entire upstream selection budget: **15 s**.

### What failover does NOT handle

- HTTP 4xx from `webhook-service` (e.g., 400 bad signature, 200 OK but `handled: false`). These are legitimate application responses, not infrastructure failures.
- Events that were already successfully queued by `webhook-service` before it crashed mid-response. The deduplication layer in `backend` will detect the duplicate `X-GitHub-Delivery` ID and skip re-processing.

---

## 3. nginx Configuration

See [`nginx/nginx.conf`](../nginx/nginx.conf) for the full config.

Relevant tuning parameters:

```nginx
proxy_next_upstream        error timeout http_502 http_503 http_504;
proxy_next_upstream_tries  2;
proxy_next_upstream_timeout 15s;
proxy_connect_timeout       5s;
proxy_read_timeout          30s;
```

nginx health probe (tests nginx itself, not upstreams):

```bash
curl http://localhost:8080/health
# → 200 ok
```

---

## 4. HMAC Independence

Both `webhook-service` and `backend` verify `X-Hub-Signature-256` using the **same** `GITHUB_WEBHOOK_SECRET`. They each perform the verification independently — there is no shared middleware or pre-verification step in nginx.

nginx forwards all GitHub headers **verbatim**:

- `X-Hub-Signature-256`
- `X-GitHub-Event`
- `X-GitHub-Delivery`

The raw request body is forwarded intact (`proxy_buffering off` / `proxy_request_buffering on`) so that HMAC computation succeeds on the upstream side.

---

## 5. Duplicate Delivery Detection

Both services use the same Redis instance to deduplicate events by `X-GitHub-Delivery` header value.

```
Key:   webhook_delivery:<X-GitHub-Delivery>
Value: "true"
TTL:   86400 s (24 hours)
```

**Failover scenario**: If `webhook-service` successfully queues a task and then fails to return a response (e.g., OOM kill), nginx retries against `backend`. `backend` checks Redis, finds the delivery ID already recorded, and returns `{ handled: false, reason: "duplicate_delivery" }`. The task is NOT queued twice. ✓

---

## 6. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_WEBHOOK_SECRET` | Yes | Shared HMAC-SHA256 signing secret (must match backend's value) |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
| `REDIS_URL` | Yes | Redis connection string (e.g. `redis://redis:6379`) |
| `PORT` | No | HTTP port (default: 5001) |

Copy `.env.example` to `.env` and fill in values before starting.

---

## 7. Running Locally

```bash
# Start all services (nginx + webhook-service + backend + redis + ...)
docker compose up --build

# Start only the webhook stack (minimal)
docker compose up nginx webhook-service backend redis --build
```

Webhook entry point: `http://localhost:8080/api/github/webhook`

For ngrok tunnelling, set:
```bash
WEBHOOK_ENDPOINT_URL=https://<your-ngrok-id>.ngrok.io/api/github/webhook
```

---

## 8. Verifying Failover

Run these steps after `docker compose up --build`:

### Step 1 — Normal operation (primary handles event)

```bash
# Compute signature
SECRET=<your-webhook-secret>
PAYLOAD='{"action":"ping","repository":{"id":1}}'
SIG=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print "sha256="$2}')

# Send event
curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:8080/api/github/webhook \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: ping" \
  -H "X-GitHub-Delivery: verify-primary-$(date +%s)" \
  -H "X-Hub-Signature-256: $SIG" \
  -d "$PAYLOAD"
```

Check `webhook-service` logs — should show the event processed.

### Step 2 — Failover (primary down)

```bash
docker compose stop webhook-service
```

Send another event (new `X-GitHub-Delivery` ID). Check `backend` logs — should show the event processed.

```bash
docker compose start webhook-service
```

Send another event — `webhook-service` logs should show processing resumed.

### Step 3 — Run tests

```bash
# webhook-service — run twice to prove order independence
cd webhook-service && npm run test
cd webhook-service && npm run test

# backend
cd backend && npm run test
```

---

## 9. Webhook URL Migration

**Strategy: newly-enabled repositories only.**

Only repositories that are (re-)enabled after this change will receive webhooks at the nginx URL (`http://localhost:8080/api/github/webhook` or the configured `WEBHOOK_ENDPOINT_URL`).

Existing repositories registered before this change continue to deliver directly to `backend`'s endpoint and remain fully operational — no action required.

A bulk migration script (to update GitHub webhook URLs for all existing repos) is intentionally excluded because:

1. It requires a valid GitHub OAuth token per user.
2. It risks hitting GitHub's API rate limits.
3. The existing failover architecture means there is **zero risk** of webhook loss for existing repos.

To migrate an individual repository, simply disable and re-enable it via the Smart Code Reviewer UI. This triggers `githubWebhookCreationService` which registers a fresh webhook pointing at the nginx URL.
