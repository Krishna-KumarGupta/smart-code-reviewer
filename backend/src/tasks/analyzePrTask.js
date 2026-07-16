import celery from 'celery-node';
import { PersistenceService } from '../services/persistence.service.js';
import { supabaseAdmin } from '../config/supabase.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const celeryClient = celery.createClient(
  REDIS_URL,
  REDIS_URL,
  'node-queue'
);

export const analyzePrTask = celeryClient.createTask('tasks.analyzePr');

/**
 * Executes the integration review workflow by calling the review-agent service.
 *
 * The `reviewId` in the payload is the Supabase `reviews.id` that was already
 * created synchronously by the ReviewController before this task was dispatched.
 * This ensures the frontend can navigate to /history/report?reviewId=<id> immediately.
 *
 * The review-agent has its own internal database and returns its own `review_id`
 * (agentReviewId). We use agentReviewId ONLY to poll the agent's status endpoint.
 * All Supabase updates go through the backend's `reviewId`.
 */
export async function analyzePrHandler(payload) {
  const { owner, repo, pullNumber, pull_number, userId, repositoryId, reviewId } = payload;
  const prNumber = parseInt(pullNumber || pull_number, 10);
  const repoUrl = `https://github.com/${owner}/${repo}`;

  const reviewAgentUrl = process.env.REVIEW_AGENT_URL;
  const serviceApiKey = process.env.SERVICE_API_KEY;

  try {
    if (!reviewAgentUrl || !serviceApiKey) {
      throw new Error('[Worker] Missing required environment variables: REVIEW_AGENT_URL or SERVICE_API_KEY');
    }

    if (!reviewId) {
      throw new Error('[Worker] No reviewId in payload — Supabase row was not pre-created by the controller');
    }

    // 1. Resolve User Email from payload or fallback to admin auth lookup
    let userEmail = payload.userEmail;
    if (!userEmail && userId) {
      try {
        const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
        if (!userError && userData?.user) {
          userEmail = userData.user.email;
        }
      } catch (err) {
        console.warn(`[Worker] Failed user email lookup for ID ${userId}:`, err.message);
      }
    }

    console.log(`[Worker] Starting review-agent call for PR #${prNumber} on ${repoUrl} (reviewId: ${reviewId})`);

    // 2. Trigger the review on the review-agent API.
    //    The agent creates its own local DB row and returns its own review_id.
    //    We call this `agentReviewId` to avoid confusion with our Supabase `reviewId`.
    const response = await fetch(`${reviewAgentUrl.replace(/\/$/, '')}/reviews`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Api-Key': serviceApiKey,
        'X-User-Id': userId || '',
        'X-User-Email': userEmail || '',
      },
      body: JSON.stringify({
        repo_url: repoUrl,
        pr_number: prNumber,
        review_id: reviewId,
        github_token: payload.github_token || null,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Review agent returned status ${response.status}: ${errText}`);
    }

    const resData = await response.json();
    // agentReviewId is the same as reviewId if passed, but let's read it from response
    const agentReviewId = resData.review_id;

    console.log(
      `[Worker] Agent enqueued agentReviewId=${agentReviewId}. ` +
      `Will update Supabase reviewId=${reviewId}. Starting polling...`
    );

    // 3. Poll review-agent GET /reviews/{agentReviewId} until completed or failed.
    //    On every status change, update the Supabase row at `reviewId`.
    const maxPollTimeMs = 8 * 60 * 1000; // 8 minutes
    const pollIntervalMs = 5000;          // 5 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxPollTimeMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

      try {
        const pollResponse = await fetch(
          `${reviewAgentUrl.replace(/\/$/, '')}/reviews/${agentReviewId}`,
          {
            method: 'GET',
            headers: {
              'X-Service-Api-Key': serviceApiKey,
              'X-User-Id': userId || '',
              'X-User-Email': userEmail || '',
            },
          }
        );

        if (!pollResponse.ok) {
          console.warn(`[Worker] Poll returned ${pollResponse.status} for agentReviewId ${agentReviewId}. Retrying...`);
          continue;
        }

        const pollData = await pollResponse.json();
        const agentStatus = pollData.status; // queued | running | completed | failed

        // Map agent status to our Supabase status vocabulary
        let localStatus = 'pending';
        if (agentStatus === 'running') localStatus = 'processing';
        else if (agentStatus === 'completed') localStatus = 'completed';
        else if (agentStatus === 'failed') localStatus = 'failed';

        // Update the exact Supabase row that was pre-created by the controller
        await PersistenceService.updateReviewStatus(
          reviewId,
          localStatus,
          pollData.report || pollData.result || null,
          localStatus === 'failed'
            ? (pollData.error_message || pollData.error || 'Review agent reported failure')
            : null
        );

        if (localStatus === 'completed' || localStatus === 'failed') {
          console.log(`[Worker] Review ${reviewId} finished with status: ${localStatus}`);
          return { success: true, reviewId, status: localStatus };
        }

      } catch (pollErr) {
        console.error(`[Worker] Error in polling loop for reviewId=${reviewId}:`, pollErr);
      }
    }

    // Polling timed out — mark the Supabase row as failed
    console.error(`[Worker] Polling timeout exceeded for reviewId=${reviewId}`);
    await PersistenceService.updateReviewStatus(
      reviewId, 'failed', null, 'Timeout waiting for review agent'
    );
    return { success: false, reviewId, error: 'Timeout waiting for review agent' };

  } catch (error) {
    console.error(`[Worker] analyzePrHandler failed for reviewId=${reviewId}:`, error.message);
    if (reviewId) {
      try {
        await PersistenceService.updateReviewStatus(
          reviewId, 'failed', null, error.message || 'Worker error'
        );
      } catch (dbErr) {
        console.error('[Worker] Failed to write failure status to Supabase:', dbErr.message);
      }
    }
    return { success: false, reviewId, error: error.message };
  }
}
