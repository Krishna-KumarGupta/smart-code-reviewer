import { supabaseAdmin } from '../config/supabase.js';
import redis from '../config/redis.js';
import celery from 'celery-node';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Initialize Celery client matching backend configuration
const celeryClient = celery.createClient(
  REDIS_URL,
  REDIS_URL,
  'node-queue'
);

export const analyzePrTask = celeryClient.createTask('tasks.analyzePr');

const SUPPORTED_PR_ACTIONS = new Set(['opened', 'reopened', 'synchronize']);

/**
 * Handle a `pull_request` webhook event.
 *
 * @param {object} payload - Parsed JSON webhook payload
 * @param {string|null} deliveryId - X-GitHub-Delivery header
 * @param {string} eventType - Event type from X-GitHub-Event header
 * @returns {Promise<{
 *   handled: boolean,
 *   reason?: string,
 *   message?: string,
 *   reviewId?: string,
 * }>}
 */
export const handlePullRequestEvent = async (payload, deliveryId = null, eventType = 'pull_request') => {
  // ── Step 1: Validate payload structure
  if (!payload || !payload.repository || !payload.pull_request || !payload.sender) {
    return { handled: false, reason: 'invalid_payload', message: 'Pull request payload is invalid' };
  }

  // ── Step 2: Check the pull request action
  const action = payload.action;
  if (!SUPPORTED_PR_ACTIONS.has(action)) {
    console.log(`[Webhook Service] pull_request action "${action}" is not supported — ignoring`);
    return { handled: false, reason: 'unsupported_action', message: `pull_request action "${action}" is not supported` };
  }

  const cleanPayload = extractPullRequestPayload(payload);

  // ── Step 3: Duplicate protection check via Redis
  if (deliveryId) {
    const isDuplicate = await redis.get(`webhook_delivery:${deliveryId}`);
    if (isDuplicate) {
      console.warn(`[Webhook Service] Duplicate webhook delivery detected: ${deliveryId}`);
      return { handled: false, reason: 'duplicate_delivery', message: 'Duplicate delivery ignored' };
    }
  }

  // ── Step 4: Verify repository exists and is enabled in Supabase
  const repository = await getRepositoryDetails(cleanPayload.repository.id);
  if (!repository) {
    console.log(
      `[Webhook Service] Repository "${cleanPayload.repository.full_name}" ` +
      `(github_repo_id: ${cleanPayload.repository.id}) is not managed by Smart Code Reviewer`
    );
    return { handled: false, reason: 'repository_not_managed', message: 'Repository not found' };
  }

  if (!repository.is_active) {
    console.log(`[Webhook Service] Repository "${repository.full_name}" is disabled`);
    return { handled: false, reason: 'repository_disabled', message: 'Repository disabled' };
  }

  // ── Step 5: Verify GitHub installation/account connection exists
  const installationExists = await checkInstallationExists(repository.user_id, cleanPayload.installation?.id);
  if (!installationExists) {
    console.log(`[Webhook Service] No active installation or GitHub account found for user: ${repository.user_id}`);
    return { handled: false, reason: 'installation_missing', message: 'GitHub installation missing' };
  }

  // ── Step 6: Create the review row in Supabase synchronously
  const reviewId = crypto.randomUUID();
  const repoUrl = `https://github.com/${cleanPayload.repository.owner}/${cleanPayload.repository.name}`;

  const userEmail = null;

  try {
    const { error: insertError } = await supabaseAdmin
      .from('reviews')
      .insert({
        id: reviewId,
        user_id: repository.user_id,
        user_email: userEmail,
        repository_id: repository.id,
        repo_url: repoUrl,
        pr_number: cleanPayload.pullRequest.number,
        status: 'pending',
        report_json: null,
        error: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (insertError) {
      console.error('[Webhook Service] Failed to insert reviews row:', insertError);
      throw new Error(`Database error: ${insertError.message}`);
    }
  } catch (dbErr) {
    return { handled: false, reason: 'database_error', message: dbErr.message };
  }

  // ── Step 7: Prevent duplicate processing (set Redis lock after DB verification)
  if (deliveryId) {
    await redis.set(`webhook_delivery:${deliveryId}`, 'true', 'EX', 86400); // 24 hours lock
  }

  // ── Step 8: Construct unified review job payload matching exact backend worker spec
  const jobPayload = {
    reviewId, // ← critical link
    userId: repository.user_id,
    userEmail,
    repositoryId: repository.id,
    installation_id: cleanPayload.installation?.id || repository.installation_id || null,
    repository_id: cleanPayload.repository.id,
    owner: cleanPayload.repository.owner,
    repo: cleanPayload.repository.name,
    repository_full_name: cleanPayload.repository.full_name,
    pullNumber: cleanPayload.pullRequest.number,
    pull_number: cleanPayload.pullRequest.number,
    pull_request_id: cleanPayload.pullRequest.id,
    pull_request_url: cleanPayload.pullRequest.html_url,
    head_sha: cleanPayload.pullRequest.head_sha,
    base_sha: cleanPayload.pullRequest.base_sha,
    sender: cleanPayload.sender.login,
    event_type: eventType,
    delivery_id: deliveryId,
    timestamp: new Date().toISOString(),
  };

  // ── Step 9: Dispatch the Celery task asynchronously
  try {
    const taskResult = analyzePrTask.delay(jobPayload);
    console.log(`[Webhook Service] Enqueued review job for PR #${cleanPayload.pullRequest.number}. Celery Task ID: ${taskResult.taskId}`);

    return {
      handled: true,
      message: 'Review queued',
      reviewId,
    };
  } catch (queueErr) {
    console.error('[Webhook Service] Failed to queue task to Celery:', queueErr);

    // Fallback: update review status to failed
    try {
      await supabaseAdmin
        .from('reviews')
        .update({
          status: 'failed',
          error: `Queue failure: ${queueErr.message}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', reviewId);
    } catch (updateErr) {
      console.error('[Webhook Service] Failed to update review to failed status:', updateErr.message);
    }

    return {
      handled: false,
      reason: 'queue_failure',
      message: `Failed to queue Celery task: ${queueErr.message}`,
      reviewId,
    };
  }
};

/**
 * Handle a `ping` webhook event from GitHub.
 *
 * @returns {{ handled: boolean, message: string }}
 */
export const handlePingEvent = () => {
  console.log('[Webhook Service] Webhook verified successfully — ping received from GitHub');
  return { handled: true, message: 'Webhook verified successfully' };
};

// ─── Helpers ─────────────────────────────────────────────────────────

const extractPullRequestPayload = (payload) => {
  const { repository, pull_request, installation, sender } = payload;
  return {
    repository: {
      id: repository?.id,
      full_name: repository?.full_name,
      name: repository?.name,
      owner: repository?.owner?.login,
    },
    pullRequest: {
      id: pull_request?.id,
      number: pull_request?.number,
      title: pull_request?.title,
      state: pull_request?.state,
      html_url: pull_request?.html_url,
      diff_url: pull_request?.diff_url,
      patch_url: pull_request?.patch_url,
      head_sha: pull_request?.head?.sha,
      base_sha: pull_request?.base?.sha,
      base_ref: pull_request?.base?.ref,
      head_ref: pull_request?.head?.ref,
      author: pull_request?.user?.login,
    },
    installation: installation?.id != null ? { id: installation.id } : null,
    sender: {
      login: sender?.login,
    },
  };
};

const getRepositoryDetails = async (githubRepoId) => {
  if (!githubRepoId) return null;
  const { data, error } = await supabaseAdmin
    .from('repositories')
    .select('id, user_id, is_active, owner, name, full_name, installation_id')
    .eq('github_repo_id', githubRepoId)
    .maybeSingle();

  if (error) {
    console.error(`[Webhook Service] Database lookup failed for github_repo_id ${githubRepoId}:`, error.message);
    return null;
  }
  return data;
};

const checkInstallationExists = async (userId, installationId) => {
  if (installationId) {
    const { data: inst, error: instErr } = await supabaseAdmin
      .from('github_installations')
      .select('id')
      .eq('installation_id', installationId)
      .maybeSingle();
    if (!instErr && inst) return true;
  }

  const { data: acc, error: accErr } = await supabaseAdmin
    .from('github_accounts')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (!accErr && acc) return true;
  return false;
};
