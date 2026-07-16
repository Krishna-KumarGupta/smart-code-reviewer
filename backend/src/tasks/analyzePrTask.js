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
 * Executes the integration review workflow by calling review-agent.
 */
export async function analyzePrHandler(payload) {
  const { owner, repo, pullNumber, pull_number, userId, repositoryId } = payload;
  const prNumber = parseInt(pullNumber || pull_number, 10);
  const repoUrl = `https://github.com/${owner}/${repo}`;

  const reviewAgentUrl = process.env.REVIEW_AGENT_URL;
  const serviceApiKey = process.env.SERVICE_API_KEY;

  let localCreatedReviewId = null;

  try {
    if (!reviewAgentUrl || !serviceApiKey) {
      throw new Error('[Worker] Missing required environment variables: REVIEW_AGENT_URL or SERVICE_API_KEY');
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

    console.log(`[Worker] Triggering review-agent review for PR #${prNumber} on ${repoUrl}...`);

    // 2. Trigger review on review-agent API
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
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Review agent returned status ${response.status}: ${errText}`);
    }

    const resData = await response.json();
    const reviewId = resData.review_id;
    const initialStatus = resData.status || 'queued';
    localCreatedReviewId = reviewId;

    // 3. Persist the initial review state to our database using the review_id returned by review-agent
    await PersistenceService.createReview({
      id: reviewId,
      userId,
      userEmail,
      repositoryId,
      prNumber,
      prUrl: `${repoUrl}/pull/${prNumber}`,
      status: initialStatus === 'queued' ? 'pending' : initialStatus,
    });

    console.log(`[Worker] Successfully enqueued review ${reviewId} on agent. Starting polling loop...`);

    // 4. Status Tracking: poll review-agent GET /reviews/{review_id} until completed or failed
    const maxPollTimeMs = 8 * 60 * 1000; // 8 minutes timeout
    const pollIntervalMs = 5000; // 5 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxPollTimeMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

      try {
        const pollResponse = await fetch(`${reviewAgentUrl.replace(/\/$/, '')}/reviews/${reviewId}`, {
          method: 'GET',
          headers: {
            'X-Service-Api-Key': serviceApiKey,
            'X-User-Id': userId || '',
            'X-User-Email': userEmail || '',
          },
        });

        if (!pollResponse.ok) {
          console.warn(`[Worker] Poll failed with status ${pollResponse.status}. Retrying...`);
          continue;
        }

        const pollData = await pollResponse.json();
        const agentStatus = pollData.status; // queued, running, completed, failed

        let localStatus = 'pending';
        if (agentStatus === 'running') {
          localStatus = 'processing';
        } else if (agentStatus === 'completed') {
          localStatus = 'completed';
        } else if (agentStatus === 'failed') {
          localStatus = 'failed';
        }

        // Update local database status
        // Pass result and error message to keep local records synchronised
        await PersistenceService.updateReviewStatus(
          reviewId,
          localStatus,
          pollData.result || null,
          pollData.error_message || pollData.error || null
        );

        if (localStatus === 'completed' || localStatus === 'failed') {
          console.log(`[Worker] Review ${reviewId} completed polling loop with status: ${localStatus}`);
          return { success: true, reviewId, status: localStatus };
        }
      } catch (pollErr) {
        console.error(`[Worker] Error occurred in status polling loop for ${reviewId}:`, pollErr);
      }
    }

    // Timeout exceeded
    console.error(`[Worker] Polling timeout exceeded for review ${reviewId}`);
    await PersistenceService.updateReviewStatus(reviewId, 'failed', null, 'Timeout waiting for review agent');
    return { success: false, reviewId, error: 'Timeout waiting for review agent' };

  } catch (error) {
    console.error(`[Worker] Celery handler task processing failed:`, error.message, error.details || error);
    if (localCreatedReviewId) {
      try {
        await PersistenceService.updateReviewStatus(localCreatedReviewId, 'failed', null, error.message || 'Worker error');
      } catch (dbErr) {
        console.error('[Worker] Failed to write failure status to DB:', dbErr.message);
      }
    }
    return { success: false, error: error.message };
  }
}
