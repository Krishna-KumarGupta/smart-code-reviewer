/**
 * GitHub Webhook Routes — Phase 3A
 *
 * Mounted at /api/github in server.js (alongside the existing githubRoutes).
 *
 * Routes defined here:
 *   POST /api/github/webhook — Receive GitHub webhook events
 *
 * Security model:
 *   This endpoint is PUBLIC — no JWT middleware, no OAuth.
 *   GitHub calls it directly from their infrastructure.
 *   Security is enforced exclusively via HMAC-SHA256 signature verification
 *   inside the controller (delegated to githubWebhookVerifier).
 *
 * Critical: Raw body capture
 *   GitHub signature verification requires the raw, unparsed request body.
 *   The global express.json() middleware (in server.js) parses the body
 *   before routes run, which destroys the raw bytes needed for HMAC.
 *
 *   Solution: This route is registered in server.js BEFORE the global
 *   express.json() middleware, using express.raw() to capture the body
 *   as a Buffer and attach it to req.rawBody.
 *
 *   Alternatively, express.raw() is applied inline here as route-level
 *   middleware, and server.js registration order is documented accordingly.
 *
 * Architecture note:
 *   This router is intentionally separate from githubRoutes.js (OAuth routes)
 *   to keep webhook concerns isolated and to make the public/private boundary
 *   immediately visible in the route file.
 */

import express          from 'express';
import { handleWebhook } from '../controllers/githubWebhookController.js';

const router = express.Router();

// ─── Webhook Endpoint ─────────────────────────────────────────────────────────

/**
 * POST /api/github/webhook
 *
 * Public endpoint — no JWT, no OAuth required.
 * GitHub delivers all webhook events to this URL.
 *
 * Middleware chain (route-level):
 *   express.raw({ type: 'application/json' })
 *     → Captures the body as a raw Buffer and attaches it to req.rawBody.
 *       This MUST run before any JSON parsing so the HMAC can be recomputed.
 *
 *   handleWebhook
 *     → Validates signature, determines event type, delegates to service.
 *
 * Why express.raw() instead of express.json() here?
 *   crypto.createHmac() requires the exact byte sequence that GitHub signed.
 *   express.json() re-serialises the body, which may alter whitespace or key
 *   order and therefore produce a different HMAC — causing every valid request
 *   to fail verification.
 */
router.post(
  '/webhook',

  // ── Capture raw body as Buffer ──────────────────────────────────────────
  // We use a custom verify function inside express.json() so that we can
  // capture rawBody without breaking the global JSON middleware on other routes.
  // express.raw() is used at the route level only for this endpoint.
  express.raw({ type: 'application/json' }),

  // ── Attach raw body to req.rawBody for use in the controller ──────────
  (req, _res, next) => {
    // req.body is a Buffer here (set by express.raw).
    // We copy it to req.rawBody so the controller can access it clearly.
    req.rawBody = req.body;
    next();
  },

  // ── Dispatch to controller ─────────────────────────────────────────────
  handleWebhook
);

export default router;
