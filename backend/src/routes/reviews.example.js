/**
 * reviews.example.js — Example: how backend proxies review requests to review-agent
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS A REFERENCE/EXAMPLE FILE ONLY.
 * Do NOT import or mount this router without deliberate integration work.
 * It shows the exact headers and conventions for calling review-agent.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Endpoint added (when integrated):
 *   POST /api/reviews      — Trigger a review for a PR
 *   GET  /api/reviews/:id  — Poll review status/result
 *
 * Auth flow:
 *   1. verifyJWT validates the Supabase Bearer token → populates req.user
 *   2. This handler forwards the already-verified user identity to review-agent
 *      via X-User-Id / X-User-Email / X-User-Role headers
 *   3. review-agent trusts those headers — backend is the single source of auth truth
 *
 * Network:
 *   In Docker: review-agent is reachable at http://review-agent:5050
 *   Local dev:  review-agent is reachable at http://localhost:5050
 *
 * To integrate for real:
 *   1. Add REVIEW_AGENT_URL=http://review-agent:5050 to backend/.env
 *   2. Add SERVICE_API_KEY=<shared-secret> to backend/.env (same value as review-agent/.env)
 *   3. Rename this file to reviews.js, import it in server.js, and mount at /api
 */

import express  from 'express';
import verifyJWT from '../middleware/verifyJWT.js';
import { sendSuccess, sendError } from '../utils/response.js';

const router = express.Router();

// ─── Config ──────────────────────────────────────────────────────────────────

const REVIEW_AGENT_URL  = process.env.REVIEW_AGENT_URL  || 'http://localhost:5050';
const SERVICE_API_KEY   = process.env.SERVICE_API_KEY   || '';

if (!SERVICE_API_KEY) {
  console.warn(
    '[reviews.example] WARNING: SERVICE_API_KEY is not set. ' +
    'All review-agent calls will be rejected with 401.'
  );
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Build the standard headers that review-agent requires on every proxied call.
 *
 * @param {import('../middleware/verifyJWT.js').SupabaseUser} user - req.user from verifyJWT
 * @param {string} [role] - optional role string (e.g. "admin") from isAdmin middleware
 * @returns {Record<string, string>}
 */
function makeReviewAgentHeaders(user, role) {
  const headers = {
    'Content-Type':      'application/json',
    'X-Service-Api-Key': SERVICE_API_KEY,
    'X-User-Id':         user.id,
    'X-User-Email':      user.email,
  };
  if (role) {
    headers['X-User-Role'] = role;
  }
  return headers;
}

// ─── POST /api/reviews — Trigger a review ────────────────────────────────────

/**
 * POST /api/reviews
 * Requires: verifyJWT (req.user must be set)
 *
 * Body: { repo_url: string, pr_number: number }
 * Response: { review_id: string, status: "queued" }
 *
 * Forwards the authenticated user's identity to review-agent and enqueues
 * a review job. Returns the review_id for polling.
 */
router.post('/reviews', verifyJWT, async (req, res, next) => {
  try {
    const { repo_url, pr_number } = req.body;

    if (!repo_url || !pr_number) {
      return sendError(res, 'Missing required fields: repo_url and pr_number', 400);
    }

    console.log(
      `[reviews] Triggering review for ${repo_url} PR#${pr_number} by user ${req.user.id}`
    );

    const agentResponse = await fetch(`${REVIEW_AGENT_URL}/reviews`, {
      method:  'POST',
      headers: makeReviewAgentHeaders(req.user, req.userRole || null),
      body:    JSON.stringify({ repo_url, pr_number }),
    });

    if (!agentResponse.ok) {
      const errorData = await agentResponse.json().catch(() => ({}));
      console.error('[reviews] review-agent responded with error:', errorData);
      return sendError(
        res,
        errorData.detail?.error || 'review-agent returned an error',
        agentResponse.status,
      );
    }

    const data = await agentResponse.json();
    return sendSuccess(res, data, 202);

  } catch (err) {
    next(err);
  }
});

// ─── GET /api/reviews/:reviewId — Poll review status ─────────────────────────

/**
 * GET /api/reviews/:reviewId
 * Requires: verifyJWT
 *
 * Polls review-agent for the current status and (if completed) the full report.
 * Response: { review_id, status, report?, error? }
 */
router.get('/reviews/:reviewId', verifyJWT, async (req, res, next) => {
  try {
    const { reviewId } = req.params;

    const agentResponse = await fetch(`${REVIEW_AGENT_URL}/reviews/${encodeURIComponent(reviewId)}`, {
      method:  'GET',
      headers: makeReviewAgentHeaders(req.user, req.userRole || null),
    });

    if (!agentResponse.ok) {
      const errorData = await agentResponse.json().catch(() => ({}));
      return sendError(
        res,
        errorData.detail?.error || 'review-agent returned an error',
        agentResponse.status,
      );
    }

    const data = await agentResponse.json();
    return sendSuccess(res, data);

  } catch (err) {
    next(err);
  }
});

// ─── GET /api/reviews — List reviews for a repo ───────────────────────────────

/**
 * GET /api/reviews?repo=<url>
 * Requires: verifyJWT
 *
 * Lists past reviews from review-agent, optionally filtered by repo URL.
 */
router.get('/reviews', verifyJWT, async (req, res, next) => {
  try {
    const params = new URLSearchParams();
    if (req.query.repo) params.set('repo', req.query.repo);

    const agentResponse = await fetch(
      `${REVIEW_AGENT_URL}/reviews?${params.toString()}`,
      {
        method:  'GET',
        headers: makeReviewAgentHeaders(req.user, req.userRole || null),
      }
    );

    if (!agentResponse.ok) {
      const errorData = await agentResponse.json().catch(() => ({}));
      return sendError(
        res,
        errorData.detail?.error || 'review-agent returned an error',
        agentResponse.status,
      );
    }

    const data = await agentResponse.json();
    return sendSuccess(res, data);

  } catch (err) {
    next(err);
  }
});

export default router;
