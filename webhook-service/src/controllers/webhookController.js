import { verifyWebhookSignature } from '../utils/githubWebhookVerifier.js';
import { handlePullRequestEvent, handlePingEvent } from '../services/webhookQueueService.js';

/**
 * Handle incoming GitHub Webhook POST request.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export const handleWebhook = async (req, res, next) => {
  try {
    const rawBody = req.rawBody;
    const signature = req.headers['x-hub-signature-256'];
    const eventType = req.headers['x-github-event'];
    const deliveryId = req.headers['x-github-delivery'] || null;

    console.log(`[Webhook Service] Received event "${eventType}" for delivery ID "${deliveryId}"`);

    // ── Step 1: Verify HMAC signature (MUST be first)
    const isValid = verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      console.warn('[Webhook Service] Invalid signature received — rejecting with 401');
      return res.status(401).json({
        success: false,
        error: 'Invalid webhook signature',
      });
    }

    // ── Step 2: Parse JSON body after verification
    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch (parseError) {
      console.error('[Webhook Service] Failed to parse raw body as JSON');
      return res.status(400).json({
        success: false,
        error: 'Invalid JSON body',
      });
    }

    // ── Step 3: Handle Ping Event
    if (eventType === 'ping') {
      const result = handlePingEvent();
      return res.status(200).json({
        success: true,
        handled: result.handled,
        message: result.message,
      });
    }

    // ── Step 4: Handle Pull Request Event
    if (eventType === 'pull_request') {
      const result = await handlePullRequestEvent(payload, deliveryId, eventType);

      let status = 200;
      if (result.reason === 'repository_not_managed') {
        status = 404;
      } else if (result.reason === 'repository_disabled') {
        status = 403;
      } else if (result.reason === 'installation_missing') {
        status = 400;
      } else if (result.reason === 'invalid_payload') {
        status = 400;
      } else if (result.reason === 'database_error') {
        status = 500;
      } else if (result.reason === 'queue_failure') {
        status = 500;
      } else if (result.reason === 'duplicate_delivery') {
        status = 200;
      } else if (result.reason === 'unsupported_action') {
        status = 200;
      } else if (result.handled) {
        status = 202; // Accepted
      }

      return res.status(status).json({
        success: result.handled || result.reason === 'duplicate_delivery' || result.reason === 'unsupported_action',
        handled: result.handled,
        message: result.message || result.reason,
        ...(result.reason && { reason: result.reason }),
        ...(result.reviewId && { reviewId: result.reviewId }),
      });
    }

    // ── Step 5: Handle Unsupported Event Types (GitHub requires 2xx)
    console.log(`[Webhook Service] Unsupported event "${eventType}" — ignored`);
    return res.status(200).json({
      success: true,
      handled: false,
      message: `Unsupported event: ${eventType}`,
      reason: `unsupported_event:${eventType}`,
    });

  } catch (err) {
    console.error('[Webhook Service] Unexpected error handling webhook:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
};
