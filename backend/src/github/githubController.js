/**
 * GitHub Controller
 *
 * Handles all GitHub OAuth flow endpoints.
 * Business logic is delegated to githubService and githubTokenService.
 *
 * Endpoints:
 *   GET  /api/github/login      — Redirect user to GitHub OAuth screen
 *   GET  /api/github/callback   — Handle OAuth callback, exchange code for token
 *   GET  /api/github/status     — Return connection status for authenticated user
 *   POST /api/github/disconnect — Remove GitHub account link
 *
 * Security notes:
 *   - login requires JWT (verifyJWT) to capture user.id into OAuth state
 *   - callback validates state to prevent CSRF
 *   - Access tokens are NEVER returned to the frontend
 */

import fetch from 'node:fetch'; // Node 18+ has native fetch

import githubConfig from './githubConfig.js';
import { encryptToken }      from './githubTokenService.js';
import {
  getGitHubAccount,
  upsertGitHubAccount,
  deleteGitHubAccount,
  setGitHubConnected,
} from './githubService.js';
import { sendSuccess, sendError } from '../utils/response.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Encode the user ID into a base64 state string.
 * In production, use HMAC-signed state for stronger CSRF protection.
 */
const encodeState = (userId) => Buffer.from(userId).toString('base64url');

/**
 * Decode the state string back to the user ID.
 * Returns null if the string is not valid base64url.
 */
const decodeState = (state) => {
  try {
    return Buffer.from(state, 'base64url').toString('utf8');
  } catch {
    return null;
  }
};

// ─── Controllers ─────────────────────────────────────────────────────────────

/**
 * GET /api/github/login
 * Requires: verifyJWT (so req.user.id is available)
 *
 * Returns the GitHub OAuth authorization URL as JSON.
 * The frontend receives this URL and does window.location.href to navigate.
 * This pattern keeps the JWT in the Authorization header (not the URL).
 *
 * Response: { url: "https://github.com/login/oauth/authorize?..." }
 */
export const loginWithGitHub = (req, res) => {
  const state = encodeState(req.user.id);

  const params = new URLSearchParams({
    client_id:    githubConfig.clientId,
    redirect_uri: githubConfig.callbackUrl,
    scope:        githubConfig.scopes,
    state,
  });

  const url = `${githubConfig.authorizeUrl}?${params.toString()}`;
  return sendSuccess(res, { url });
};

/**
 * GET /api/github/callback
 * Called by GitHub after user approves (or denies) the OAuth request.
 *
 * Flow:
 *   1. Validate state → extract user ID
 *   2. Exchange `code` for access token
 *   3. Fetch GitHub user profile
 *   4. Encrypt access token
 *   5. Upsert github_accounts record
 *   6. Set profiles.github_connected = true
 *   7. Redirect frontend to /home?github=connected
 */
export const handleGitHubCallback = async (req, res, next) => {
  try {
    const { code, state, error: oauthError } = req.query;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    // ── User denied access on GitHub ──────────────────────────────────────
    if (oauthError) {
      console.warn('[githubController] OAuth denied by user:', oauthError);
      return res.redirect(`${frontendUrl}/home?github=denied`);
    }

    // ── Validate state (CSRF protection) ──────────────────────────────────
    if (!state) {
      return res.redirect(`${frontendUrl}/home?github=error&reason=invalid_state`);
    }

    const userId = decodeState(state);
    if (!userId) {
      return res.redirect(`${frontendUrl}/home?github=error&reason=invalid_state`);
    }

    // ── Exchange authorization code for access token ───────────────────────
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

    const { access_token, refresh_token = null } = tokenData;

    // ── Fetch GitHub user profile ──────────────────────────────────────────
    const userResponse = await fetch(githubConfig.userApiUrl, {
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Accept':        'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!userResponse.ok) {
      console.error('[githubController] GitHub user fetch failed:', userResponse.status);
      return res.redirect(`${frontendUrl}/home?github=error&reason=user_fetch`);
    }

    const githubUser = await userResponse.json();

    // ── Encrypt tokens before storing ─────────────────────────────────────
    const encrypted_access_token  = encryptToken(access_token);
    const encrypted_refresh_token = refresh_token ? encryptToken(refresh_token) : null;

    // ── Upsert github_accounts ─────────────────────────────────────────────
    await upsertGitHubAccount(userId, {
      github_user_id:          githubUser.id,
      github_username:         githubUser.login,
      github_avatar:           githubUser.avatar_url,
      encrypted_access_token,
      encrypted_refresh_token,
      token_expires_at:        null, // Classic OAuth tokens don't expire
    });

    // ── Update profiles.github_connected = true ────────────────────────────
    await setGitHubConnected(userId, true, githubUser.login);

    // ── Redirect to frontend success page ─────────────────────────────────
    return res.redirect(`${frontendUrl}/home?github=connected`);

  } catch (err) {
    console.error('[githubController] Callback error:', err.message);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    return res.redirect(`${frontendUrl}/home?github=error&reason=server_error`);
  }
};

/**
 * GET /api/github/status
 * Requires: verifyJWT
 *
 * Returns the GitHub connection status for the authenticated user.
 * Access token is NEVER included in the response.
 *
 * Response:
 *   { connected: boolean, username: string|null, avatar: string|null }
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

/**
 * POST /api/github/disconnect
 * Requires: verifyJWT
 *
 * Removes the GitHub account link:
 *   1. Deletes the github_accounts row
 *   2. Sets profiles.github_connected = false
 */
export const disconnectGitHub = async (req, res, next) => {
  try {
    await deleteGitHubAccount(req.user.id);
    await setGitHubConnected(req.user.id, false, null);

    return sendSuccess(res, { message: 'GitHub account disconnected successfully' });
  } catch (err) {
    next(err);
  }
};
