/**
 * GitHub Webhook Service — Phase 3A
 *
 * Business logic layer for GitHub webhook event processing.
 *
 * Responsibilities:
 *   - Extract and map clean pull_request payloads from raw GitHub event bodies
 *   - Verify that the receiving repository is managed by Smart Code Reviewer
 *     (match by github_repo_id in the local `repositories` table)
 *   - Return clean, typed result objects to the controller
 *
 * This service does NOT:
 *   - Perform signature verification (that belongs to githubWebhookVerifier)
 *   - Handle Express request / response objects
 *   - Call the GitHub API
 *   - Invoke AI / OpenAI / Gemini
 *   - Clone repositories or parse diffs
 *   - Handle credentials or raw signatures
 *
 * @module githubWebhookService
 */

import { supabaseAdmin } from '../../config/supabase.js';
import { PersistenceService } from '../../services/persistence.service.js';
import { analyzePrTask } from '../../tasks/analyzePrTask.js';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Pull request actions that Smart Code Reviewer reacts to.
 * All other actions (labeled, assigned, closed, etc.) are silently ignored.
 */
const SUPPORTED_PR_ACTIONS = new Set(['opened', 'reopened', 'synchronize']);

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Handle a `pull_request` webhook event from GitHub.
 *
 * @param {object} payload - The parsed JSON body of the GitHub webhook event.
 * @param {string|null} deliveryId - GitHub unique delivery ID header.
 * @param {string} eventType - The x-github-event header.
 * @returns {Promise<{
 *   handled:    boolean,
 *   reason?:    string,
 *   message?:   string,
 *   reviewId?:  string,
 * }>} A clean result describing what was processed and why.
 */
export const handlePullRequestEvent = async (payload, deliveryId = null, eventType = 'pull_request') => {
  // ── Step 1: Validate payload structure ───────────────────────────
  if (!payload || !payload.repository || !payload.pull_request || !payload.sender) {
    return { handled: false, reason: 'invalid_payload', message: 'Pull request payload is invalid' };
  }

  // ── Step 2: Check the pull request action ────────────────────────────────
  const action = payload.action;

  if (!SUPPORTED_PR_ACTIONS.has(action)) {
    console.log(
      `[githubWebhookService] pull_request action "${action}" is not supported — ignoring`
    );
    return { handled: false, reason: 'unsupported_action', message: `pull_request action "${action}" is not supported` };
  }

  // ── Step 3: Extract a clean, structured payload ───────────────────────────
  const cleanPayload = extractPullRequestPayload(payload);

  // ── Step 4: Duplicate protection check via Redis ─────────────────────────
  if (deliveryId) {
    const isDuplicate = await redis.get(`webhook_delivery:${deliveryId}`);
    if (isDuplicate) {
      console.warn(`[githubWebhookService] Duplicate webhook delivery detected: ${deliveryId}`);
      return { handled: false, reason: 'duplicate_delivery', message: 'Duplicate delivery ignored' };
    }
  }

  // ── Step 5: Verify repository exists and is enabled ──────────────────────
  const repository = await getRepositoryDetails(cleanPayload.repository.id);

  if (!repository) {
    console.log(
      `[githubWebhookService] Repository "${cleanPayload.repository.full_name}" ` +
      `(github_repo_id: ${cleanPayload.repository.id}) is not managed by Smart Code Reviewer`
    );
    return { handled: false, reason: 'repository_not_managed', message: 'Repository not found' };
  }

  if (!repository.is_active) {
    console.log(`[githubWebhookService] Repository "${repository.full_name}" is disabled`);
    return { handled: false, reason: 'repository_disabled', message: 'Repository disabled' };
  }

  // ── Step 6: Verify GitHub installation exists ────────────────────────────
  const installationExists = await checkInstallationExists(repository.user_id, cleanPayload.installation?.id);
  if (!installationExists) {
    console.log(`[githubWebhookService] No active installation or GitHub account found for user: ${repository.user_id}`);
    return { handled: false, reason: 'installation_missing', message: 'GitHub installation exists' };
  }

  // ── Step 7: Prevent duplicate processing (set Redis lock after DB verification) ──
  if (deliveryId) {
    await redis.set(`webhook_delivery:${deliveryId}`, 'true', 'EX', 86400); // 24 hours lock
  }

  // ── Step 8: Persist the initial 'pending' review state to the database ───
  const reviewId = await PersistenceService.createReview({
    userId: repository.user_id,
    repositoryId: repository.id,
    prNumber: cleanPayload.pullRequest.number,
    prTitle: cleanPayload.pullRequest.title,
    prUrl: cleanPayload.pullRequest.html_url,
    prAuthor: cleanPayload.pullRequest.author,
    baseBranch: cleanPayload.pullRequest.base_ref,
    headBranch: cleanPayload.pullRequest.head_ref || 'main',
  });

  // ── Step 9: Construct unified review job payload ─────────────────────────
  const jobPayload = {
    reviewId,
    userId: repository.user_id,
    repositoryId: repository.id,
    installation_id: cleanPayload.installation?.id || repository.installation_id || null,
    repository_id: cleanPayload.repository.id,
    owner: cleanPayload.repository.owner,
    repo: cleanPayload.repository.name,
    repository_full_name: cleanPayload.repository.full_name,
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

  // ── Step 10: Dispatch the Celery task asynchronously ─────────────────────
  const taskResult = analyzePrTask.delay(jobPayload);
  console.log(`[githubWebhookService] Enqueued review job for PR #${cleanPayload.pullRequest.number}. Celery Task ID: ${taskResult.taskId}`);

  return {
    handled: true,
    message: 'Review queued',
    reviewId,
  };
};

/**
 * Handle a `ping` webhook event from GitHub.
 *
 * @returns {{ handled: boolean, message: string }}
 */
export const handlePingEvent = () => {
  console.log('[githubWebhookService] Webhook verified successfully — ping received from GitHub');
  return { handled: true, message: 'Webhook verified successfully' };
};

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Extract only the required fields from a raw pull_request event payload.
 */
const extractPullRequestPayload = (payload) => {
  const { repository, pull_request, installation, sender } = payload;

  return {
    repository: {
      id:        repository?.id,
      full_name: repository?.full_name,
      name:      repository?.name,
      owner:     repository?.owner?.login,
    },
    pullRequest: {
      id:        pull_request?.id,
      number:    pull_request?.number,
      title:     pull_request?.title,
      state:     pull_request?.state,
      html_url:  pull_request?.html_url,
      diff_url:  pull_request?.diff_url,
      patch_url: pull_request?.patch_url,
      head_sha:  pull_request?.head?.sha,
      base_sha:  pull_request?.base?.sha,
      base_ref:  pull_request?.base?.ref,
      head_ref:  pull_request?.head?.ref,
      author:    pull_request?.user?.login,
    },
    installation: installation?.id != null
      ? { id: installation.id }
      : null,
    sender: {
      login: sender?.login,
    },
  };
};

/**
 * Get detailed repository record from Supabase database.
 */
const getRepositoryDetails = async (githubRepoId) => {
  if (!githubRepoId) return null;

  const { data, error } = await supabaseAdmin
    .from('repositories')
    .select('id, user_id, is_active, owner, name, full_name, installation_id')
    .eq('github_repo_id', githubRepoId)
    .maybeSingle();

  if (error) {
    console.error(
      `[githubWebhookService] Database lookup failed for github_repo_id ${githubRepoId}:`,
      error.message
    );
    return null;
  }

  return data;
};

/**
 * Verify installation or account connection exists.
 */
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
