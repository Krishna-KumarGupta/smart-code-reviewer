# nginx — Webhook Reverse Proxy

This directory contains the nginx configuration for the Smart Code Reviewer webhook entry point.

## Architecture

```
GitHub webhook events
        │
        ▼
  nginx :8080 (host)
  nginx :80   (container)
        │
        ├─── primary ──▶  webhook-service:5001
        │
        └─── failover ──▶ backend:5000
             (automatic, via proxy_next_upstream)
```

nginx is the **only** service exposed to GitHub. Both upstream services verify the HMAC signature independently — nginx does not inspect or modify `X-Hub-Signature-256`, `X-GitHub-Event`, or `X-GitHub-Delivery`.

## Files

| File | Purpose |
|------|---------|
| `nginx.conf` | Full nginx configuration (upstream blocks, location rules, failover settings) |

## Failover Conditions

nginx retries against `backend` when `webhook-service` returns any of:

- TCP connection error or reset
- Connect / read / send timeout
- HTTP 502, 503, or 504

Up to 2 upstream attempts are made (primary + failover). Total timeout budget is 15 s.

## Health Probe

`GET http://localhost:8080/health` returns `200 ok` from nginx itself (no upstream involved). Use this to verify the nginx container is running.

## Full Documentation

See [`webhook-service/README.md`](../webhook-service/README.md) for the complete primary/failover architecture, HMAC independence, duplicate delivery semantics, and manual verification steps.
