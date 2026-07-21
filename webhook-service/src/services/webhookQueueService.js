import { supabaseAdmin } from '../config/supabase.js';
import redis from '../config/redis.js';
import dotenv from 'dotenv';
dotenv.config();

import { REVIEW_AGENT_URL, makeReviewAgentHeaders } from '../utils/reviewAgent.js';

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

  // ── Step 6: Prevent duplicate processing (set Redis lock after DB verification)
  if (deliveryId) {
    await redis.set(`webhook_delivery:${deliveryId}`, 'true', 'EX', 86400); // 24 hours lock
  }

  // ── Step 7: Call review-agent's API instead of touching Supabase reviews table directly
  const repoUrl = `https://github.com/${cleanPayload.repository.owner}/${cleanPayload.repository.name}`;
  const userEmail = repository.profiles?.email || 'webhook@github.com';
  const userIdentity = {
    id: repository.user_id,
    email: userEmail,
  };

  try {
    const response = await fetch(`${REVIEW_AGENT_URL.replace(/\/$/, '')}/reviews`, {
      method: 'POST',
      headers: makeReviewAgentHeaders(userIdentity),
      body: JSON.stringify({
        repo_url: repoUrl,
        pr_number: cleanPayload.pullRequest.number,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.warn(`[Webhook Service] review-agent returned status ${response.status}: ${errText}`);
      return {
        handled: false,
        reason: 'queue_failure',
        message: `review-agent returned status ${response.status}: ${errText}`,
      };
    }

    const data = await response.json();
    console.log(`[Webhook Service] Enqueued review job for PR #${cleanPayload.pullRequest.number}. Review ID: ${data.review_id}`);

    return {
      handled: true,
      message: 'Review queued',
      reviewId: data.review_id,
    };
  } catch (err) {
    console.error(`[Webhook Service] Error calling review-agent:`, err.message);
    return {
      handled: false,
      reason: 'queue_failure',
      message: `Failed to connect to review-agent: ${err.message}`,
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
    .select('id, user_id, is_active, owner, name, full_name, installation_id, profiles(email)')
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

