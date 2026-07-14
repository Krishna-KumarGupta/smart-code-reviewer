/**
 * GitHub Webhook Signature Verifier
 *
 * The ONLY module responsible for validating GitHub webhook signatures.
 * No other controller, service, or middleware may perform this verification.
 *
 * Security model:
 *   GitHub signs every webhook payload with HMAC-SHA256 using the webhook
 *   secret (GITHUB_WEBHOOK_SECRET) configured in the repository/app settings.
 *   The signature is sent in the `X-Hub-Signature-256` header as:
 *     sha256=<hex_digest>
 *
 *   We recompute the HMAC over the raw request body and compare using
 *   crypto.timingSafeEqual() to prevent timing-based side-channel attacks.
 *
 * Requirements:
 *   - GITHUB_WEBHOOK_SECRET must be set in .env
 *   - Caller must pass the RAW body buffer (not parsed JSON)
 *   - Returns a boolean — never throws to the caller
 *
 * Security rules:
 *   - NEVER log the webhook secret
 *   - NEVER log the received or computed signature
 *   - NEVER expose verification failure details in HTTP responses
 *
 * @module githubWebhookVerifier
 */

import crypto from 'crypto';

// ─── Environment ──────────────────────────────────────────────────────────────

/**
 * Webhook secret read directly from the environment.
 * Validated at call time (not at module load) so that the absence of this
 * secret does not crash the server for other routes during development.
 */
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Verify the HMAC-SHA256 signature attached by GitHub to a webhook delivery.
 *
 * Algorithm:
 *   1. Read GITHUB_WEBHOOK_SECRET from environment — reject if missing.
 *   2. Extract the hex digest from the `X-Hub-Signature-256` header value.
 *   3. Recompute HMAC-SHA256 over the raw request body using the same secret.
 *   4. Compare received digest vs. computed digest with timingSafeEqual().
 *
 * @param {Buffer} rawBody  - The raw, unparsed request body buffer.
 *                            Must be captured before any JSON parsing occurs.
 * @param {string} signature - The value of the `X-Hub-Signature-256` header,
 *                             e.g. "sha256=abc123...".
 * @returns {boolean} true if the signature is valid, false otherwise.
 *
 * @example
 *   const isValid = verifyWebhookSignature(req.rawBody, req.headers['x-hub-signature-256']);
 *   if (!isValid) return res.status(401).json({ error: 'Invalid signature' });
 */
export const verifyWebhookSignature = (rawBody, signature) => {
  // ── Step 1: Guard — secret must be configured ──────────────────────────────
  // If GITHUB_WEBHOOK_SECRET is not set, we cannot verify anything.
  // Reject all requests rather than silently accepting unverified payloads.
  if (!WEBHOOK_SECRET) {
    console.error('[githubWebhookVerifier] GITHUB_WEBHOOK_SECRET is not configured');
    return false;
  }

  // ── Step 2: Guard — signature header must be present ──────────────────────
  // GitHub always sends X-Hub-Signature-256. A missing header is suspicious.
  if (!signature || typeof signature !== 'string') {
    return false;
  }

  // ── Step 3: Extract the hex digest portion ────────────────────────────────
  // Header format: "sha256=<64-char hex digest>"
  // We strip the "sha256=" prefix before comparing.
  if (!signature.startsWith('sha256=')) {
    return false;
  }

  const receivedHex = signature.slice('sha256='.length);

  // ── Step 4: Guard — raw body must be a non-empty Buffer ───────────────────
  if (!rawBody || !Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    return false;
  }

  // ── Step 5: Recompute HMAC-SHA256 over the raw body ───────────────────────
  // Use the same secret that was registered in the GitHub webhook settings.
  const computedHex = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  // ── Step 6: Timing-safe comparison ────────────────────────────────────────
  // crypto.timingSafeEqual() requires Buffers of equal length.
  // If lengths differ the signature is trivially invalid — no side-channel here.
  const receivedBuf = Buffer.from(receivedHex, 'hex');
  const computedBuf = Buffer.from(computedHex, 'hex');

  if (receivedBuf.length !== computedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(receivedBuf, computedBuf);
};
