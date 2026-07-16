/**
 * GitHub Webhook Service — Phase 3A
 *
 * Pure business logic layer for GitHub webhook event processing.
 * This service is the only place where webhook payload data is extracted,
 * validated against the local database, and logged.
 *
 * Responsibilities:
 *   - Extract and map clean pull_request payloads from raw GitHub event bodies
 *   - Verify that the receiving repository is managed by Smart Code Reviewer
 *     (match by github_repo_id in the local `repositories` table)
 *   - Log structured event information (repository, PR, action, sender)
 *   - Return clean, typed result objects to the controller
 *
 * This service does NOT:
 *   - Perform signature verification (that belongs to githubWebhookVerifier)
 *   - Handle Express request / response objects
 *   - Call the GitHub API
 *   - Invoke AI / OpenAI / Gemini
 *   - Clone repositories or parse diffs
 *   - Log OAuth tokens, JWTs, webhook secrets, or raw signatures
 *
 * Architecture note:
 *   Controller → Service (this file) → Database
 *   The controller validates the request and delegates here.
 *   The service does not know about HTTP.
 *
 * @module githubWebhookService
 */

import { supabaseAdmin } from '../../config/supabase.js';

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
 * Flow:
 *   1. Check whether the PR action is one we care about — skip if not.
 *   2. Extract a clean, structured payload from the raw GitHub event body.
 *   3. Look up the repository in our local `repositories` table by github_repo_id.
 *   4. If not found → log and return gracefully (not our repository).
 *   5. Log the event details (repo, PR number, action, sender).
 *   6. Return the structured result.
 *
 * @param {object} payload - The parsed JSON body of the GitHub webhook event.
 * @returns {Promise<{
 *   handled:    boolean,
 *   reason?:    string,
 *   repository?: object,
 *   pullRequest?: object,
 *   installation?: object,
 *   sender?: object,
 * }>} A clean result describing what was processed and why.
 */
export const handlePullRequestEvent = async (payload) => {
  // ── Step 1: Check the pull request action ────────────────────────────────
  // We only process opened, reopened, and synchronize.
  // Every other action (closed, labeled, assigned, …) is explicitly ignored.
  const action = payload?.action;

  if (!SUPPORTED_PR_ACTIONS.has(action)) {
    console.log(
      `[githubWebhookService] pull_request action "${action}" is not supported — ignoring`
    );
    return { handled: false, reason: `unsupported_action:${action}` };
  }

  // ── Step 2: Extract a clean, structured payload ───────────────────────────
  // Only the fields required by this phase are extracted.
  // Extra GitHub fields are intentionally discarded to keep the data surface small.
  const cleanPayload = extractPullRequestPayload(payload);

  // ── Step 3: Verify repository exists in our database ─────────────────────
  // We match by `github_repo_id` — the integer repository ID assigned by GitHub.
  // This is stable even if the repo is renamed or transferred.
  const repoRecord = await checkRepositoryExists(cleanPayload.repository.id);

  // ── Step 4: Repository not managed by Smart Code Reviewer ────────────────
  if (!repoRecord) {
    console.log(
      `[githubWebhookService] Repository "${cleanPayload.repository.full_name}" ` +
      `(github_repo_id: ${cleanPayload.repository.id}) is not managed by Smart Code Reviewer`
    );
    return { handled: false, reason: 'repository_not_managed' };
  }

  // ── Step 5: Log the event details ────────────────────────────────────────
  // Log only safe fields — never log tokens, secrets, or signatures.
  console.log('[githubWebhookService] pull_request event received:');
  console.log(`  Repository : ${cleanPayload.repository.full_name}`);
  console.log(`  PR Number  : #${cleanPayload.pullRequest.number}`);
  console.log(`  Action     : ${action}`);
  console.log(`  Sender     : ${cleanPayload.sender.login}`);

  // ── Step 6: Return the structured result ─────────────────────────────────
  return {
    handled:      true,
    repository:   cleanPayload.repository,
    pullRequest:  cleanPayload.pullRequest,
    installation: cleanPayload.installation,
    sender:       cleanPayload.sender,
    ownerEmail:   repoRecord.profiles?.email || null,
  };
};

/**
 * Handle a `ping` webhook event from GitHub.
 *
 * GitHub sends a ping immediately after a webhook is created to verify
 * that the endpoint is reachable and responding correctly.
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
 *
 * Fields extracted per the Phase 3A specification:
 *
 *   Repository   : id, full_name, name, owner.login
 *   Pull Request : id, number, title, state, html_url, diff_url, patch_url,
 *                  head.sha, base.ref, user.login
 *   Installation : id  (present when delivered via GitHub App)
 *   Sender       : login
 *
 * @param {object} payload - Raw GitHub pull_request event body
 * @returns {{
 *   repository:   { id, full_name, name, owner },
 *   pullRequest:  { id, number, title, state, html_url, diff_url,
 *                   patch_url, head_sha, base_ref, author },
 *   installation: { id } | null,
 *   sender:       { login },
 * }}
 */
const extractPullRequestPayload = (payload) => {
  const { repository, pull_request, installation, sender } = payload;

  return {
    // ── Repository fields ─────────────────────────────────────────────────
    repository: {
      id:        repository?.id,
      full_name: repository?.full_name,
      name:      repository?.name,
      owner:     repository?.owner?.login,
      html_url:  repository?.html_url,
    },

    // ── Pull request fields ───────────────────────────────────────────────
    pullRequest: {
      id:        pull_request?.id,
      number:    pull_request?.number,
      title:     pull_request?.title,
      state:     pull_request?.state,
      html_url:  pull_request?.html_url,
      diff_url:  pull_request?.diff_url,
      patch_url: pull_request?.patch_url,
      head_sha:  pull_request?.head?.sha,
      base_ref:  pull_request?.base?.ref,
      author:    pull_request?.user?.login,
    },

    // ── Installation fields (GitHub App only) ────────────────────────────
    // Present when the webhook is delivered via a GitHub App installation.
    // May be null for OAuth App webhooks.
    installation: installation?.id != null
      ? { id: installation.id }
      : null,

    // ── Sender fields ─────────────────────────────────────────────────────
    sender: {
      login: sender?.login,
    },
  };
};

/**
 * Check whether a repository identified by its GitHub integer ID is registered
 * and managed in the local Smart Code Reviewer `repositories` table.
 *
 * We query by `github_repo_id` (not by name) so that the lookup remains valid
 * even if the repository is renamed or transferred on GitHub.
 *
 * @param {number} githubRepoId - The `repository.id` field from the GitHub event
 * @returns {Promise<boolean>} true if the repository is found in our database
 */
const checkRepositoryExists = async (githubRepoId) => {
  if (!githubRepoId) return null;

  const { data, error } = await supabaseAdmin
    .from('repositories')
    .select('id, profiles(email)')
    .eq('github_repo_id', githubRepoId)
    .maybeSingle();

  if (error) {
    console.error(
      `[githubWebhookService] Database lookup failed for github_repo_id ${githubRepoId}:`,
      error.message
    );
    // On DB error we treat the repository as unmanaged to avoid side effects
    return null;
  }

  return data;
};
