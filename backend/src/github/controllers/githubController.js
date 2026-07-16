/**
 * GitHub Controller
 *
 * Thin request handlers for all GitHub OAuth endpoints.
 * All business logic is delegated to services and utils — no inline crypto,
 * no raw state encoding, no direct DB access.
 *
 * Endpoints:
 *   GET  /api/github/connect     — Return GitHub OAuth URL (JWT required)
 *   GET  /api/github/callback    — Handle OAuth callback from GitHub (public)
 *   GET  /api/github/status      — Return connection status (JWT required)
 *   POST /api/github/disconnect  — Remove GitHub account link (JWT required)
 *   GET  /api/github/repos       — List user repositories from GitHub (JWT required)
 *
 * Security:
 *   - connect  requires verifyJWT — user must be authenticated first
 *   - callback validates signed state via stateManager (no JWT available)
 *   - Access/refresh tokens NEVER reach this layer in plaintext
 *   - Token storage is exclusively handled by githubTokenService.storeTokens()
 */

import githubConfig           from '../utils/githubConfig.js';
import { createSignedState, verifySignedState } from '../utils/stateManager.js';
import { storeTokens, disconnectAccount, getValidAccessToken }        from '../services/githubTokenService.js';
import { supabaseAdmin }                         from '../../config/supabase.js';
import { getGitHubAccount, setGitHubConnected }  from '../services/githubOAuthService.js';
import { fetchUserRepositories }                  from '../services/githubRepositoryService.js';
import { syncUserRepositories }                   from '../services/githubRepositorySyncService.js';
import { getUserSyncedRepositories }              from '../services/githubSyncedRepositoryService.js';
import { createRepositoryWebhook }               from '../services/githubWebhookCreationService.js';
import { sendSuccess, sendError }                from '../../utils/response.js';
import { GitHubService }                         from '../../services/github.service.js';


// ─── GET /api/github/connect ──────────────────────────────────────────────────

/**
 * Requires: verifyJWT
 *
 * Builds and returns the GitHub OAuth authorization URL as JSON.
 * The frontend receives the URL and does window.location.href.
 * This keeps the JWT in the Authorization header — not the URL.
 *
 * State payload is HMAC-signed by stateManager (userId + nonce + timestamp).
 *
 * Response: { url: "https://github.com/login/oauth/authorize?..." }
 */
export const connectWithGitHub = (req, res) => {
  try {
    const state = createSignedState(req.user.id);

    // ── Log the initiating user before redirecting ──────────────────────
    console.info('[githubController] connectWithGitHub: OAuth flow initiated', {
      supabaseUserId: req.user.id,
    });

    const params = new URLSearchParams({
      client_id:    githubConfig.clientId,
      redirect_uri: githubConfig.callbackUrl,
      scope:        githubConfig.scopes,
      state,
      // ── Force GitHub account selection on every OAuth attempt ──────────
      // GitHub silently reuses the browser's active GitHub session by default.
      // This causes "wrong account" bugs when multiple Supabase users share
      // a browser (e.g. QA, staging, or multi-account scenarios): user B
      // clicks "Connect GitHub" and gets redirected as user A's GitHub account
      // because that is still logged in the browser.
      //
      // prompt=select_account is the GitHub-documented parameter that forces
      // the account chooser / login screen on every authorization attempt,
      // regardless of any existing GitHub browser session.
      //
      // Reference: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
      prompt: 'select_account',
    });

    const url = `${githubConfig.authorizeUrl}?${params.toString()}`;
    return sendSuccess(res, { url });
  } catch (err) {
    // createSignedState throws only if userId is missing — shouldn't happen with verifyJWT
    return sendError(res, 'Failed to create OAuth state', 500);
  }
};

// ─── GET /api/github/callback ─────────────────────────────────────────────────

/**
 * Called by GitHub after the user approves (or denies) the OAuth request.
 * No JWT available here — identity is established via the signed state.
 *
 * Flow:
 *   1. verifySignedState() → validate HMAC + timestamp + nonce → extract userId
 *   2. Exchange authorization code for access token
 *   3. Fetch GitHub user profile
 *   4. githubTokenService.storeTokens() → encrypt + persist
 *   5. setGitHubConnected(userId, true)
 *   6. Redirect frontend to /home?github=connected
 */
export const handleGitHubCallback = async (req, res, next) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  try {
    const { code, state, error: oauthError } = req.query;

    // ── User denied access on GitHub ────────────────────────────────────────
    if (oauthError) {
      console.warn('[githubController] OAuth denied by user:', oauthError);
      return res.redirect(`${frontendUrl}/home?github=denied`);
    }

    // ── Verify signed state (HMAC + timestamp + nonce) ──────────────────────
    let userId;
    try {
      const payload = verifySignedState(state);
      userId = payload.userId;
    } catch (stateErr) {
      console.warn('[githubController] State verification failed:', stateErr.message);
      return res.redirect(`${frontendUrl}/home?github=error&reason=invalid_state`);
    }

    // ── Exchange authorization code for access token ─────────────────────────
    const tokenResponse = await fetch(githubConfig.tokenUrl, {
      method: 'POST',
      headers: {
        'Accept':       'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id:     githubConfig.clientId,
        client_secret: githubConfig.clientSecret,
        code,
        redirect_uri:  githubConfig.callbackUrl,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error || !tokenData.access_token) {
      console.error('[githubController] Token exchange failed:', tokenData.error_description);
      return res.redirect(`${frontendUrl}/home?github=error&reason=token_exchange`);
    }

    const { access_token, refresh_token = null, expires_in = null } = tokenData;

    // Compute expiry timestamp for fine-grained tokens that include expires_in
    const expiresAt = expires_in
      ? new Date(Date.now() + expires_in * 1000).toISOString()
      : null;

    // ── Fetch GitHub user profile ────────────────────────────────────────────
    const userResponse = await fetch(githubConfig.userApiUrl, {
      headers: {
        'Authorization':        `Bearer ${access_token}`,
        'Accept':               'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!userResponse.ok) {
      console.error('[githubController] GitHub user fetch failed:', userResponse.status);
      return res.redirect(`${frontendUrl}/home?github=error&reason=user_fetch`);
    }

    const githubUser = await userResponse.json();

    // ── Diagnostic: log state-verified user vs returned GitHub identity ───
    // This makes cross-user OAuth bugs immediately visible in server logs.
    // Never logs tokens, JWTs, secrets, OAuth codes, or Authorization headers.
    console.info('[githubController] handleGitHubCallback: identity check', {
      initiatingSupabaseUserId: userId,          // from HMAC-verified state
      returnedGitHubUserId:     githubUser.id,   // numeric GitHub account ID
      returnedGitHubUsername:   githubUser.login, // human-readable GitHub login
    });

    // ── Verify that the newly issued token includes the repo scope needed for
    // private repositories. GitHub exposes granted scopes via response headers.
    const grantedScopesHeader = userResponse.headers.get('x-oauth-scopes');
    const grantedScopes = (grantedScopesHeader || '')
      .split(',')
      .map((scope) => scope.trim().toLowerCase())
      .filter(Boolean);

    const hasRepoScope = grantedScopes.includes('repo');

    if (!hasRepoScope) {
      console.error('[githubController] Missing repo scope for private repository access');
      return res.redirect(`${frontendUrl}/home?github=error&reason=missing_repo_scope`);
    }

    // ── Store tokens (encrypt + persist) — only githubTokenService does this ─
    await storeTokens(userId, githubUser, access_token, refresh_token, expiresAt);

    // ── Update profiles.github_connected = true ──────────────────────────────
    await setGitHubConnected(userId, true);

    // ── Redirect to frontend success page ────────────────────────────────────
    return res.redirect(`${frontendUrl}/home?github=connected`);

  } catch (err) {
    console.error('[githubController] Callback error:', err.message);
    return res.redirect(`${frontendUrl}/home?github=error&reason=server_error`);
  }
};

// ─── GET /api/github/status ───────────────────────────────────────────────────

/**
 * Requires: verifyJWT
 *
 * Returns the public GitHub connection info for the authenticated user.
 * Tokens are NEVER included in this response.
 *
 * Response: { connected: boolean, username: string|null, avatar: string|null }
 */
export const getGitHubStatus = async (req, res, next) => {
  try {
    const supabaseUserId = req.user.id;

    // ── DIAGNOSTIC: scan all github_accounts rows ─────────────────────────
    // Temporary — lets us see exactly what user_ids are stored vs what the
    // JWT is presenting, to identify any format mismatch causing the miss.
    // Never logs tokens, JWTs, secrets, or Authorization headers.
    const { data: allRows, error: scanError } = await supabaseAdmin
      .from('github_accounts')
      .select('id, user_id, github_user_id, github_username');

    console.info('[GitHub Status Debug] Authenticated userId from JWT:', supabaseUserId);
    console.info('[GitHub Status Debug] All github_accounts rows:', JSON.stringify(
      (allRows || []).map(r => ({
        id:              r.id,
        user_id:         r.user_id,
        github_user_id:  r.github_user_id,
        github_username: r.github_username,
        userIdMatch:     r.user_id === supabaseUserId,
      })),
      null, 2
    ));
    if (scanError) {
      console.error('[GitHub Status Debug] Scan error:', scanError.message);
    }

    const account = await getGitHubAccount(supabaseUserId);

    console.info('[GitHub Status Debug] getGitHubAccount result:', {
      authenticatedUserId: supabaseUserId,
      accountFound:        Boolean(account),
      githubUserId:        account?.github_user_id ?? null,
      username:            account?.github_username ?? null,
    });

    if (!account) {
      return sendSuccess(res, { connected: false, username: null, avatar: null });
    }

    return sendSuccess(res, {
      connected: true,
      username:  account.github_username,
      avatar:    account.github_avatar,
    });
  } catch (err) {
    next(err);
  }
};


// ─── POST /api/github/disconnect ─────────────────────────────────────────────

/**
 * Requires: verifyJWT
 *
 * Delegates full disconnect to githubTokenService.disconnectAccount().
 * That method handles both DB row deletion and profile flag reset atomically.
 */
export const disconnectGitHub = async (req, res, next) => {
  try {
    await disconnectAccount(req.user.id);
    return sendSuccess(res, { message: 'GitHub account disconnected successfully' });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/github/repos ────────────────────────────────────────────────────────

/**
 * Requires: verifyJWT
 *
 * Returns all GitHub repositories accessible to the authenticated user.
 * Delegates entirely to githubRepositoryService — no API calls or DB
 * access happen here.
 *
 * Response: { repositories: Array<{ id, name, full_name, owner, private,
 *              default_branch, html_url, language, updated_at }> }
 */
export const getRepositories = async (req, res, next) => {
  try {
    const repositories = await fetchUserRepositories(req.user.id);
    return sendSuccess(res, { repositories });
  } catch (err) {
    next(err);
  }
};

export const syncRepositories = async (req, res, next) => {
  try {
    const result = await syncUserRepositories(req.user.id);
    return sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

export const getSyncedRepositories = async (req, res, next) => {
  try {
    const repositories = await getUserSyncedRepositories(req.user.id);
    return sendSuccess(res, { repositories });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/github/repositories/:repoId/enable ────────────────────────────

/**
 * Requires: verifyJWT
 *
 * Enables code review for a specific synced repository by automatically
 * creating a GitHub webhook via the REST API.
 *
 * The repository is identified by its local Supabase UUID (:repoId),
 * not by the GitHub integer ID — this prevents cross-user enumeration.
 *
 * Delegates entirely to githubWebhookCreationService — no business logic here.
 *
 * Response:
 *   {
 *     webhookId:      number,    — The GitHub webhook ID (new or pre-existing)
 *     alreadyExisted: boolean,   — true if the webhook was already registered
 *     repository:     object,    — { id, full_name, owner, name }
 *   }
 */
export const enableRepository = async (req, res, next) => {
  try {
    const { repoId } = req.params;

    if (!repoId) {
      return sendError(res, 'Repository ID is required', 400);
    }

    const result = await createRepositoryWebhook(req.user.id, repoId);

    return sendSuccess(res, result);
  } catch (err) {
    // Distinguish between "not found / access denied" (404) and other errors (500)
    if (err.message?.includes('not found or access denied')) {
      return sendError(res, err.message, 404);
    }
    next(err);
  }
};

/**
 * GET /api/github/repos/:owner/:repo/pulls
 * Requires: verifyJWT
 *
 * Retrieves all open pull requests for a given repository.
 */
export const getOpenPullRequests = async (req, res, next) => {
  try {
    const { owner, repo } = req.params;

    if (!owner || !repo) {
      return sendError(res, 'Owner and Repository parameters are required', 400);
    }

    // Retrieve user's valid access token (if connected)
    const token = req.user?.id ? await getValidAccessToken(req.user.id) : null;

    // Fetch repository details to get installation_id (optional, for logging)
    const { data: repoRow } = await supabaseAdmin
      .from('repositories')
      .select('installation_id')
      .eq('owner', owner)
      .eq('name', repo)
      .maybeSingle();

    // Fetch user github account details to get username (for logging)
    const { data: accountRow } = await supabaseAdmin
      .from('github_accounts')
      .select('github_username')
      .eq('user_id', req.user?.id)
      .maybeSingle();

    const extraInfo = {
      installationId: repoRow?.installation_id || null,
      authenticatedGitHubUser: accountRow?.github_username || null,
    };

    const pullRequests = await GitHubService.listOpenPullRequests(owner, repo, token, extraInfo);
    return sendSuccess(res, { pullRequests });
  } catch (err) {
    next(err);
  }
};

