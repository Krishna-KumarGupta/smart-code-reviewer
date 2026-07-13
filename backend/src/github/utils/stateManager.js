/**
 * OAuth State Manager
 *
 * Centralises creation and verification of the OAuth `state` parameter.
 * Controllers MUST NOT manually encode/decode state — use this module.
 *
 * State payload:
 *   {
 *     userId    : string   — authenticated Supabase user UUID
 *     nonce     : string   — cryptographically random 16-byte hex string
 *     timestamp : number   — Unix ms timestamp at creation
 *   }
 *
 * Signing:
 *   HMAC-SHA256 over the JSON payload using GITHUB_STATE_SECRET.
 *   The final state token is: base64url( JSON ) + "." + hex( HMAC )
 *
 * Verification checks:
 *   1. Format is valid (two segments separated by ".")
 *   2. HMAC signature matches (timing-safe comparison)
 *   3. Timestamp is within stateMaxAgeMs (default 10 min)
 *   4. Nonce is present and non-empty
 *
 * Replay attack resistance:
 *   The combination of nonce + timestamp makes replaying a captured state
 *   URL ineffective — an identical state can only be used once within the
 *   expiry window, and the nonce randomness makes collisions infeasible.
 *
 * Future improvement:
 *   Store used nonces in a short-lived Redis set to guarantee one-use.
 */

import crypto from 'crypto';
import githubConfig from './githubConfig.js';

const NONCE_LENGTH = 16; // bytes → 32 hex chars

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure random nonce.
 * @returns {string} 32-character lowercase hex string
 */
export const generateNonce = () =>
  crypto.randomBytes(NONCE_LENGTH).toString('hex');

/**
 * Compute HMAC-SHA256 of a message using GITHUB_STATE_SECRET.
 * @param {string} message
 * @returns {string} hex-encoded HMAC digest
 */
const sign = (message) =>
  crypto
    .createHmac('sha256', githubConfig.stateSecret)
    .update(message)
    .digest('hex');

/**
 * Validate that the state timestamp is within the allowed window.
 * @param {number} timestamp - Unix ms timestamp from the state payload
 * @returns {boolean} true if valid (not expired)
 */
export const validateTimestamp = (timestamp) => {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return false;
  const age = Date.now() - timestamp;
  return age >= 0 && age <= githubConfig.stateMaxAgeMs;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a signed OAuth state token for a given user.
 *
 * @param {string} userId - Authenticated Supabase user UUID
 * @returns {string} Signed state token safe to use as URL query parameter
 */
export const createSignedState = (userId) => {
  if (!userId) throw new Error('[stateManager] userId is required');

  const payload = {
    userId,
    nonce:     generateNonce(),
    timestamp: Date.now(),
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature  = sign(payloadB64);

  // Format: <base64url_payload>.<hex_signature>
  return `${payloadB64}.${signature}`;
};

/**
 * Verify a signed state token received in the OAuth callback.
 *
 * @param {string} stateToken - The raw state query param from GitHub callback
 * @returns {{ userId: string, nonce: string, timestamp: number }} Verified payload
 * @throws {Error} With a descriptive message if verification fails
 */
export const verifySignedState = (stateToken) => {
  if (!stateToken || typeof stateToken !== 'string') {
    throw new Error('State token is missing or invalid');
  }

  const dotIndex = stateToken.lastIndexOf('.');
  if (dotIndex === -1) {
    throw new Error('State token format is invalid (missing signature separator)');
  }

  const payloadB64      = stateToken.slice(0, dotIndex);
  const receivedSig     = stateToken.slice(dotIndex + 1);
  const expectedSig     = sign(payloadB64);

  // ── 1. Signature check (timing-safe) ─────────────────────────────────────
  const receivedBuf = Buffer.from(receivedSig,  'hex');
  const expectedBuf = Buffer.from(expectedSig,  'hex');

  if (
    receivedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(receivedBuf, expectedBuf)
  ) {
    throw new Error('State token signature is invalid');
  }

  // ── 2. Decode payload ─────────────────────────────────────────────────────
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    throw new Error('State token payload could not be decoded');
  }

  const { userId, nonce, timestamp } = payload;

  // ── 3. Nonce check ────────────────────────────────────────────────────────
  if (!nonce || typeof nonce !== 'string' || nonce.length === 0) {
    throw new Error('State token nonce is missing or invalid');
  }

  // ── 4. Timestamp / expiry check ───────────────────────────────────────────
  if (!validateTimestamp(timestamp)) {
    throw new Error('State token has expired or has an invalid timestamp');
  }

  // ── 5. UserId check ───────────────────────────────────────────────────────
  if (!userId || typeof userId !== 'string') {
    throw new Error('State token userId is missing or invalid');
  }

  return { userId, nonce, timestamp };
};
