/**
 * GitHub Webhook Controller — Phase 3A
 *
 * Thin request handler for the GitHub webhook endpoint.
 * All business logic is delegated to services and utils — no inline crypto,
 * no raw payload parsing, no direct DB access in this layer.
 *
 * Endpoint:
 *   POST /api/github/webhook — Public, no JWT, no OAuth middleware
 *
 * Controller responsibilities (only):
 *   1. Read the raw body and signature header from the request
 *   2. Delegate signature verification to githubWebhookVerifier
 *   3. Determine the event type from the X-GitHub-Event header
 *   4. Delegate event processing to githubWebhookService
 *   5. Return the appropriate HTTP response
 *
 * Security:
 *   - Signature validation is ALWAYS the first step — before any JSON parsing
 *   - Raw body must be captured as a Buffer (express.raw() middleware required)
 *   - Invalid signatures return 401 immediately — no event type is read first
 *   - No tokens, JWTs, webhook secrets, or signature values are ever logged
 *
 * Supported events:
 *   ping         — GitHub connectivity verification (sent on webhook creation)
 *   pull_request — PR opened, reopened, or synchronize actions
 *
 * Unsupported events:
 *   All others → 200 OK with { handled: false } (GitHub requires 2xx always)
 *
 * Error codes:
 *   401 — Invalid or missing webhook signature
 *   200 — All valid requests (including unsupported events and ignored actions)
 *   500 — Unexpected server error during event processing
 */

import { verifyWebhookSignature }                        from '../utils/githubWebhookVerifier.js';
import { handlePullRequestEvent, handlePingEvent }       from '../services/githubWebhookService.js';
import { REVIEW_AGENT_URL, makeReviewAgentHeaders }     from '../../utils/reviewAgent.js';

// ─── POST /api/github/webhook ─────────────────────────────────────────────────

/**
 * Receive, verify, and dispatch a GitHub webhook event.
 *
 * This handler is mounted without any authentication middleware.
 * GitHub calls this endpoint directly — there is no user session.
 *
 * Flow:
 *   1. Read raw body buffer and X-Hub-Signature-256 header
 *   2. Verify HMAC-SHA256 signature via githubWebhookVerifier
 *   3. Parse the JSON body (only after signature is confirmed valid)
 *   4. Read the X-GitHub-Event header to determine event type
 *   5. Dispatch to the appropriate service handler
 *   6. Return HTTP 200 for all valid deliveries
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export const handleWebhook = async (req, res, next) => {
  try {
    // ── Step 1: Read raw body and signature header ─────────────────────────
    // req.rawBody is set by the express.raw() middleware on this route.
    // We need the raw Buffer — not the parsed JSON — for HMAC computation.
    const rawBody   = req.rawBody;
    const signature = req.headers['x-hub-signature-256'];
    const eventType = req.headers['x-github-event'];

    console.log(`[githubWebhookController] Webhook received — event: "${eventType}"`);

    // ── Step 2: Verify webhook signature ──────────────────────────────────
    // This MUST happen before any JSON parsing or event processing.
    // githubWebhookVerifier is the single authority for signature validation.
    const isValid = verifyWebhookSignature(rawBody, signature);

    if (!isValid) {
      // Return 401 with a generic message — do NOT reveal why validation failed
      // or what the computed/received signature was.
      console.warn('[githubWebhookController] Signature verification failed — rejecting request');
      return res.status(401).json({
        success: false,
        error:   'Invalid webhook signature',
      });
    }

    // ── Step 3: Parse JSON body (signature is confirmed valid) ────────────
    // We parse only after verification so that a spoofed payload is never
    // processed even partially before the signature check.
    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch (parseError) {
      console.error('[githubWebhookController] Failed to parse webhook body as JSON');
      return res.status(400).json({
        success: false,
        error:   'Invalid JSON body',
      });
    }

    // ── Step 4: Dispatch by event type ────────────────────────────────────
    // Only `ping` and `pull_request` are handled in Phase 3A.
    // All other events are acknowledged with 200 but not processed.

    if (eventType === 'ping') {
      // ── ping: GitHub is verifying the webhook endpoint is reachable ──────
      const result = handlePingEvent();
      return res.status(200).json({
        success:  true,
        handled:  result.handled,
        message:  result.message,
      });
    }

    if (eventType === 'pull_request') {
      // ── pull_request: Delegate full processing to the service layer ───────
      const result = await handlePullRequestEvent(payload);

      if (result.handled) {
        try {
          const repo_url = result.repository.html_url || `https://github.com/${result.repository.full_name}`;
          const pr_number = result.pullRequest.number;
          const userEmail = result.ownerEmail || 'webhook@system.local';
          const headers = makeReviewAgentHeaders({ id: 'webhook-system', email: userEmail });

          console.log(`[githubWebhookController] Processing pull_request for ${repo_url} PR #${pr_number}`);

          // Duplicate prevention check
          const checkParams = new URLSearchParams({ repo: repo_url });
          const checkResponse = await fetch(
            `${REVIEW_AGENT_URL}/reviews?${checkParams.toString()}`,
            {
              method:  'GET',
              headers,
            }
          );

          let hasDuplicate = false;
          if (checkResponse.ok) {
            const list = await checkResponse.json().catch(() => []);
            const duplicate = list.find(
              item => item.pr_number === pr_number &&
                      ['queued', 'running', 'pending', 'processing'].includes(item.status)
            );
            if (duplicate) {
              console.log(
                `[githubWebhookController] Duplicate active review found (id: ${duplicate.review_id}, status: ${duplicate.status}) for PR #${pr_number}. Skipping trigger.`
              );
              hasDuplicate = true;
            }
          } else {
            console.warn(`[githubWebhookController] Duplicate check failed to query reviews list (status: ${checkResponse.status})`);
          }

          if (!hasDuplicate) {
            const agentResponse = await fetch(`${REVIEW_AGENT_URL}/reviews`, {
              method:  'POST',
              headers,
              body:    JSON.stringify({ repo_url, pr_number }),
            });

            if (!agentResponse.ok) {
              const errorData = await agentResponse.json().catch(() => ({}));
              console.error('[githubWebhookController] review-agent responded with error:', errorData);
            } else {
              const data = await agentResponse.json();
              console.log(`[githubWebhookController] Successfully enqueued review pipeline. review_id: ${data.review_id}`);
            }
          }
        } catch (error) {
          console.error('[githubWebhookController] Failed to trigger review-agent:', error);
        }
      }

      return res.status(200).json({
        success: true,
        handled: result.handled,
        ...(result.reason && { reason: result.reason }),
      });
    }

    // ── Unsupported event type ─────────────────────────────────────────────
    // GitHub requires a 2xx response for all deliveries — even ones we ignore.
    // We return 200 with handled: false so GitHub does not retry.
    console.log(
      `[githubWebhookController] Unsupported event type "${eventType}" — acknowledged but not processed`
    );
    return res.status(200).json({
      success: true,
      handled: false,
      reason:  `unsupported_event:${eventType}`,
    });

  } catch (err) {
    // ── Unexpected error during webhook processing ─────────────────────────
    // Delegate to the global error handler for consistent error formatting.
    // Never expose internal error details in the response.
    console.error('[githubWebhookController] Unexpected error:', err.message);
    next(err);
  }
};
