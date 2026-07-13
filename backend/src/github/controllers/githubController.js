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
import { storeTokens, disconnectAccount }        from '../services/githubTokenService.js';
import { getGitHubAccount, setGitHubConnected }  from '../services/githubOAuthService.js';
import { fetchUserRepositories }                  from '../services/githubRepositoryService.js';
import { syncUserRepositories }                   from '../services/githubRepositorySyncService.js';
import { getUserSyncedRepositories }              from '../services/githubSyncedRepositoryService.js';
import { sendSuccess, sendError }                from '../../utils/response.js';

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

    const params = new URLSearchParams({
      client_id:    githubConfig.clientId,
      redirect_uri: githubConfig.callbackUrl,
      scope:        githubConfig.scopes,
      state,
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
    const account = await getGitHubAccount(req.user.id);

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
