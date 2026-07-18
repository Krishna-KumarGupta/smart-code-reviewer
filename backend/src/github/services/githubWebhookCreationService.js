/**
 * GitHub Webhook Creation Service — Phase 3B
 *
 * Responsible for automatically registering a GitHub webhook on a repository
 * via the GitHub REST API, and storing the resulting webhook ID in the local
 * `repositories` table.
 *
 * This is the ONLY module that calls the GitHub Hooks API.
 * No other controller, service, or route may duplicate this behaviour.
 *
 * Responsibilities:
 *   - Verify the repository belongs to the requesting user (ownership check)
 *   - Detect existing webhooks (idempotency — no duplicate webhook creation)
 *   - Retrieve a valid, decrypted access token via githubTokenService
 *   - Call POST /repos/{owner}/{repo}/hooks on the GitHub REST API
 *   - Persist the returned webhook ID into the repositories table
 *   - Return a clean, typed result to the controller
 *
 * This service does NOT:
 *   - Handle Express request / response objects
 *   - Log access tokens, webhook secrets, or raw signatures
 *   - Call OpenAI, Gemini, or any AI service
 *   - Parse webhook payloads (that is githubWebhookService)
 *   - Verify incoming webhook signatures (that is githubWebhookVerifier)
 *
 * Architecture:
 *   Controller → githubWebhookCreationService (this) → GitHub API + Database
 *
 * Security:
 *   - Access token is obtained through githubTokenService and NEVER logged
 *   - GITHUB_WEBHOOK_SECRET is read from env and NEVER included in any log
 *   - Repository ownership is verified by user_id match before any external call
 *
 * @module githubWebhookCreationService
 */

import { getValidAccessToken }  from './githubTokenService.js';
import { supabaseAdmin }         from '../../config/supabase.js';

const createServiceError = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const GITHUB_API_BASE    = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';

/**
 * The single URL that GitHub will call for all webhook events.
 * Read from the environment so it works in development (ngrok) and production.
 *
 * Example:
 *   WEBHOOK_ENDPOINT_URL=https://your-ngrok-url.io/api/github/webhook
 *
 * Falls back to the local dev address if not explicitly set.
 */
const WEBHOOK_ENDPOINT_URL =
  process.env.WEBHOOK_ENDPOINT_URL ||
  `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/github/webhook`;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a GitHub webhook for a repository and store its ID in the database.
 *
 * This function is idempotent: if a webhook ID is already recorded for the
 * repository, it returns immediately without making another GitHub API call.
 *
 * Flow:
 *   1. Fetch the repository row from the database — verify user ownership.
 *   2. If github_webhook_id is already set → return early (idempotent).
 *   3. Obtain a valid decrypted access token via githubTokenService.
 *   4. Call the GitHub API to create the webhook.
 *   5. Persist the returned webhook ID into the repositories table.
 *   6. Return a clean result object.
 *
 * @param {string} userId       - Supabase user UUID (from JWT, verified by verifyJWT)
 * @param {string} repositoryId - Local Supabase UUID of the repository row
 * @returns {Promise<{
 *   webhookId:     number,
 *   alreadyExisted: boolean,
 *   repository:   { id: string, full_name: string, owner: string, name: string }
 * }>}
 * @throws {Error} If the repository is not found, the user does not own it,
 *                 the access token is unavailable, or the GitHub API call fails.
 */
export const createRepositoryWebhook = async (userId, repositoryId) => {
  // ── Step 1: Fetch repository — verify existence and ownership ─────────────
  // We use the local Supabase UUID as the identifier, not the GitHub repo ID.
  // This prevents cross-user enumeration via GitHub integer IDs.
  const repo = await getOwnedRepository(userId, repositoryId);

  if (repo.is_active === false) {
    throw createServiceError('Repository is inactive', 400);
  }

  // ── Step 2: Idempotency check ─────────────────────────────────────────────
  // If github_webhook_id is already recorded, a webhook exists on GitHub.
  // We do NOT create another one — return the stored ID immediately.
  if (repo.github_webhook_id != null) {
    console.log(
      `[githubWebhookCreationService] Webhook already exists for "${repo.full_name}" ` +
      `(webhook_id: ${repo.github_webhook_id}) — skipping creation`
    );
    return {
      webhookId:      repo.github_webhook_id,
      alreadyExisted: true,
      repository: {
        id:        repo.id,
        full_name: repo.full_name,
        owner:     repo.owner,
        name:      repo.name,
      },
    };
  }

  // ── Step 3: Obtain a valid access token ───────────────────────────────────
  // getValidAccessToken handles decryption, expiry checks, and refresh stubs.
  // The raw token is NEVER logged — it is only passed in an Authorization header.
  const accessToken = await getValidAccessToken(userId);

  if (!accessToken) {
    throw createServiceError(
      '[githubWebhookCreationService] GitHub account is not connected or token is unavailable',
      400
    );
  }

  // ── Step 4: Call the GitHub API to create the webhook ─────────────────────
  // Uses the repo's owner and name — both stored in our local DB.
  const githubWebhookId = await callGitHubCreateWebhook(
    accessToken,
    repo.owner,
    repo.name
  );

  // ── Step 5: Persist the webhook ID in our database ────────────────────────
  // This is what enables idempotency on future calls.
  await saveWebhookId(repositoryId, githubWebhookId);

  // ── Step 6: Log and return result ─────────────────────────────────────────
  // Log only safe, non-sensitive fields.
  console.log(
    `[githubWebhookCreationService] Webhook created for "${repo.full_name}" ` +
    `— webhook_id: ${githubWebhookId}`
  );

  return {
    webhookId:      githubWebhookId,
    alreadyExisted: false,
    repository: {
      id:        repo.id,
      full_name: repo.full_name,
      owner:     repo.owner,
      name:      repo.name,
    },
  };
};

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Fetch a repository row from the database and verify the requesting user owns it.
 *
 * We always filter by BOTH `id` AND `user_id` so that one user cannot access
 * another user's repository even if they know the UUID.
 *
 * @param {string} userId       - Supabase user UUID
 * @param {string} repositoryId - Local Supabase UUID (primary key of repositories)
 * @returns {Promise<{
 *   id: string,
 *   user_id: string,
 *   github_repo_id: number,
 *   full_name: string,
 *   name: string,
 *   owner: string,
 *   github_webhook_id: number|null,
 * }>} The repository row
 * @throws {Error} If not found or ownership does not match
 */
const getOwnedRepository = async (userId, repositoryId) => {
  const { data: repo, error } = await supabaseAdmin
    .from('repositories')
    .select('id, user_id, github_repo_id, full_name, name, owner, is_active, github_webhook_id')
    .eq('id', repositoryId)          // match by local UUID
    .eq('user_id', userId)           // enforce ownership — ALWAYS filter by user_id
    .maybeSingle();                  // Returns null (not error) when not found

  if (error) {
    throw new Error(
      `[githubWebhookCreationService] Database error fetching repository: ${error.message}`
    );
  }

  if (!repo) {
    // Either the repo doesn't exist or belongs to a different user.
    // We return the same generic error to avoid revealing whether the repo exists.
    throw createServiceError(
      '[githubWebhookCreationService] Repository not found or access denied',
      404
    );
  }

  return repo;
};

/**
 * Call the GitHub REST API to create a webhook on a repository.
 *
 * GitHub API reference:
 *   POST /repos/{owner}/{repo}/hooks
 *   https://docs.github.com/en/rest/webhooks/repos#create-a-repository-webhook
 *
 * Configuration applied:
 *   - url          : WEBHOOK_ENDPOINT_URL (our /api/github/webhook endpoint)
 *   - content_type : json   (GitHub sends application/json bodies)
 *   - secret       : GITHUB_WEBHOOK_SECRET (used for HMAC-SHA256 signing)
 *   - insecure_ssl : "0"    (require valid TLS — never 0 in production)
 *   - active       : true
 *   - events       : ["pull_request"] (only subscribe to what we handle)
 *
 * Security:
 *   - The access token is NEVER logged (passed only in Authorization header)
 *   - GITHUB_WEBHOOK_SECRET is NEVER logged (passed only in the request body config)
 *
 * @param {string} token    - Decrypted GitHub OAuth access token
 * @param {string} owner    - Repository owner login (e.g. "octocat")
 * @param {string} repoName - Repository name (e.g. "hello-world")
 * @returns {Promise<number>} The numeric webhook ID assigned by GitHub
 * @throws {Error} If the GitHub API returns a non-201 status
 */
const callGitHubCreateWebhook = async (token, owner, repoName) => {
  // Read the shared webhook secret from the environment.
  // This is the same secret used by githubWebhookVerifier to validate
  // incoming X-Hub-Signature-256 headers. NEVER log this value.
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!webhookSecret) {
    throw createServiceError(
      '[githubWebhookCreationService] GITHUB_WEBHOOK_SECRET is not configured',
      500
    );
  }

  // Build the GitHub Hooks API URL
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repoName}/hooks`;

  console.log(
    `[githubWebhookCreationService] Calling GitHub API to create webhook for ${owner}/${repoName}`
  );

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      // Token passed in header only — never stored in a variable that gets logged
      'Authorization':        `Bearer ${token}`,
      'Accept':               'application/vnd.github+json',
      'Content-Type':         'application/json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    },
    body: JSON.stringify({
      // Webhook name must be "web" for HTTP webhooks (GitHub requirement)
      name:   'web',
      active: true,

      // Events to subscribe to — only pull_request for Phase 3B
      events: ['pull_request'],

      config: {
        // The URL GitHub will POST events to
        url:          WEBHOOK_ENDPOINT_URL,

        // GitHub sends application/json — matches our express.raw() middleware
        content_type: 'json',

        // The shared secret GitHub uses to sign payloads (HMAC-SHA256)
        // NEVER log this field or the 'secret' property below
        secret:       webhookSecret,

        // Require valid TLS certificate (0 = verify, 1 = skip — never skip in prod)
        insecure_ssl: '0',
      },
    }),
  });

  // ── Handle GitHub API response ─────────────────────────────────────────────
  // GitHub returns 201 Created on success.
  // Common errors:
  //   422 — Hook already exists (we check our DB first, but defensive check here)
  //   403 — Token lacks admin:repo_hook scope or admin access to the repo
  //   404 — Repository not found (unlikely since we fetched it from our DB)
  if (response.status === 422) {
    // Parse the GitHub error to check for "hook already exists" specifically
    const body = await response.json().catch(() => ({}));
    const message = body?.errors?.[0]?.message || body?.message || '';

    if (message.toLowerCase().includes('already exist')) {
      // GitHub already has a webhook pointing to this URL.
      // This can happen if our DB lost the webhook_id (e.g., after data loss).
      // We cannot retrieve the existing webhook ID without listing all hooks,
      // so we throw a descriptive error that the controller can surface.
      throw createServiceError(
        '[githubWebhookCreationService] A webhook already exists on GitHub for this repository. ' +
        'Check the GitHub repository webhook settings to retrieve the existing webhook ID.',
        409
      );
    }
    throw createServiceError(
      `[githubWebhookCreationService] GitHub API validation error (422): ${message}`,
      422
    );
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw createServiceError(
      `[githubWebhookCreationService] GitHub API error ${response.status}: ` +
      `${body.message || response.statusText}`,
      response.status === 401 ? 401 : response.status === 403 ? 403 : response.status === 404 ? 404 : 502
    );
  }

  const webhookData = await response.json();

  // GitHub returns the created hook object. We only need its numeric ID.
  const webhookId = webhookData.id;

  if (!webhookId || typeof webhookId !== 'number') {
    throw createServiceError(
      '[githubWebhookCreationService] GitHub API returned an unexpected response — no webhook ID',
      502
    );
  }

  return webhookId;
};

/**
 * Persist the GitHub webhook ID into the repositories table.
 *
 * Called after a successful POST /repos/{owner}/{repo}/hooks response.
 * This enables idempotency: on the next call, createRepositoryWebhook()
 * will see a non-null github_webhook_id and skip the API call.
 *
 * @param {string} repositoryId   - Local Supabase UUID of the repository row
 * @param {number} githubWebhookId - Numeric webhook ID returned by GitHub
 * @returns {Promise<void>}
 * @throws {Error} If the database update fails
 */
const saveWebhookId = async (repositoryId, githubWebhookId) => {
  const { error } = await supabaseAdmin
    .from('repositories')
    .update({
      github_webhook_id: githubWebhookId,
      updated_at:        new Date().toISOString(),
    })
    .eq('id', repositoryId);

  if (error) {
    throw new Error(
      `[githubWebhookCreationService] Failed to save webhook ID to database: ${error.message}`
    );
  }
};
