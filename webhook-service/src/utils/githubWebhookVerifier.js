import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Verify the HMAC-SHA256 signature attached by GitHub to a webhook delivery.
 *
 * @param {Buffer} rawBody  - The raw, unparsed request body buffer.
 * @param {string} signature - The value of the `X-Hub-Signature-256` header.
 * @returns {boolean} true if the signature is valid, false otherwise.
 */
export const verifyWebhookSignature = (rawBody, signature) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!secret) {
    console.error('[githubWebhookVerifier] GITHUB_WEBHOOK_SECRET is not configured');
    return false;
  }

  if (!signature || typeof signature !== 'string') {
    return false;
  }

  if (!signature.startsWith('sha256=')) {
    return false;
  }

  const receivedHex = signature.slice('sha256='.length);

  if (!rawBody || !Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    return false;
  }

  const computedHex = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const receivedBuf = Buffer.from(receivedHex, 'hex');
  const computedBuf = Buffer.from(computedHex, 'hex');

  if (receivedBuf.length !== computedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(receivedBuf, computedBuf);
};
