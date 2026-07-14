/**
 * GitHub Token Service
 *
 * The ONLY module responsible for all GitHub token operations.
 * No controller, route, or other service may encrypt, decrypt,
 * or query tokens directly.
 *
 * Public API:
 *   storeTokens(userId, accessToken, refreshToken?, expiresAt?)
 *     → Encrypt and persist both tokens to github_accounts.
 *
 *   getValidAccessToken(userId)
 *     → Return a decrypted, valid access token (refreshes if expired).
 *
 *   refreshAccessToken(userId)
 *     → Stub. Pluggable refresh flow for future fine-grained tokens.
 *
 *   disconnectAccount(userId)
 *     → Delete github_accounts row + set profiles.github_connected = false.
 *
 *   encryptToken(token)           — used only by this service internally
 *   decryptToken(encryptedToken)  — used only by this service internally
 *   checkTokenExpiry(expiresAt)   — used only by this service internally
 *
 * Security rules:
 *   - Raw tokens are NEVER logged.
 *   - Raw tokens are NEVER returned to the frontend.
 *   - githubCrypto is imported ONLY here.
 *   - All token DB reads go through getValidAccessToken().
 */

import { encrypt, decrypt }  from '../utils/githubCrypto.js';
import { supabaseAdmin }      from '../../config/supabase.js';

// ─── Internal Crypto Wrappers ─────────────────────────────────────────────────
// Kept as named exports so the interface matches the spec,
// but callers outside this service must NOT import them.

/**
 * Encrypt a raw OAuth token for DB storage.
 * @param {string} token
 * @returns {string} iv:authTag:ciphertext (hex)
 */
export const encryptToken = (token) => encrypt(token);

/**
 * Decrypt a stored encrypted token.
 * Internal use only — result must never reach the frontend.
 * @param {string} encryptedToken
 * @returns {string} Raw token
 */
export const decryptToken = (encryptedToken) => decrypt(encryptedToken);

/**
 * Check whether a token expiry timestamp has passed.
 * @param {string|null} expiresAt - ISO timestamp or null
 * @returns {boolean} true if token is expired
 */
export const checkTokenExpiry = (expiresAt) => {
  if (!expiresAt) return false; // No expiry set → classic token, never expires
  return new Date(expiresAt) <= new Date();
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Encrypt and store GitHub tokens for a user.
 * Called by the OAuth callback after a successful code exchange.
 *
 * @param {string} userId           - Supabase user UUID
 * @param {object} githubUser       - GitHub user profile { id, login, avatar_url }
 * @param {string} accessToken      - Raw GitHub access token
 * @param {string|null} refreshToken - Raw refresh token (null for classic tokens)
 * @param {string|null} expiresAt   - ISO expiry timestamp (null if no expiry)
 * @returns {Promise<void>}
 */
export const storeTokens = async (userId, githubUser, accessToken, refreshToken = null, expiresAt = null) => {
  const encrypted_access_token  = encryptToken(accessToken);
  const encrypted_refresh_token = refreshToken ? encryptToken(refreshToken) : null;

  const { error } = await supabaseAdmin
    .from('github_accounts')
    .upsert(
      {
        user_id:                  userId,
        github_user_id:           githubUser.id,
        github_username:          githubUser.login,
        github_avatar:            githubUser.avatar_url,
        encrypted_access_token,
        encrypted_refresh_token,
        token_expires_at:         expiresAt,
        updated_at:               new Date().toISOString(),
      },
      {
        onConflict:       'user_id',
        ignoreDuplicates: false,
      }
    );

  if (error) {
    throw new Error(`[githubTokenService] storeTokens: ${error.message}`);
  }
};

/**
 * Retrieve and return a valid (decrypted) access token for a user.
 * Automatically attempts a refresh if the token is expired.
 *
 * @param {string} userId - Supabase user UUID
 * @returns {Promise<string|null>} Decrypted access token, or null if not connected
 */
export const getValidAccessToken = async (userId) => {
  try {
    const { data: account, error } = await supabaseAdmin
      .from('github_accounts')
      .select('encrypted_access_token, token_expires_at')
      .eq('user_id', userId)
      .single();

    if (error || !account?.encrypted_access_token) return null;

    // Check expiry — classic OAuth tokens have no expiry, fine-grained do
    if (checkTokenExpiry(account.token_expires_at)) {
      console.info('[githubTokenService] Token expired — attempting refresh');
      return await refreshAccessToken(userId);
    }

    return decryptToken(account.encrypted_access_token);
  } catch (err) {
    console.error('[githubTokenService] getValidAccessToken error:', err.message);
    return null;
  }
};

/**
 * Refresh Access Token — Architecture stub.
 *
 * GitHub classic OAuth tokens do not expire.
 * GitHub fine-grained tokens CAN expire and have refresh tokens.
 * Plug the real implementation here without changing any other module.
 *
 * @param {string} userId - Supabase user UUID
 * @returns {Promise<string|null>} New decrypted access token, or null on failure
 */
export const refreshAccessToken = async (userId) => {
  // TODO (Phase 3): Implement GitHub token refresh
  //
  // const { data: account } = await supabaseAdmin
  //   .from('github_accounts')
  //   .select('encrypted_refresh_token')
  //   .eq('user_id', userId)
  //   .single();
  //
  // const refreshToken = decryptToken(account.encrypted_refresh_token);
  //
  // const response = await fetch(githubConfig.tokenUrl, {
  //   method: 'POST',
  //   headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  //   body: JSON.stringify({
  //     client_id: githubConfig.clientId,
  //     client_secret: githubConfig.clientSecret,
  //     grant_type: 'refresh_token',
  //     refresh_token: refreshToken,
  //   }),
  // });
  // const tokenData = await response.json();
  // await storeTokens(userId, ..., tokenData.access_token, tokenData.refresh_token, ...);
  // return tokenData.access_token;

  console.warn('[githubTokenService] refreshAccessToken: not yet implemented (stub)');
  return null;
};

/**
 * Fully disconnect a user's GitHub account.
 *   1. Delete the github_accounts row.
 *   2. Set profiles.github_connected = false.
 *
 * This is the authoritative disconnect — no other module should do this
 * combination directly.
 *
 * @param {string} userId - Supabase user UUID
 * @returns {Promise<void>}
 */
export const disconnectAccount = async (userId) => {
  // Delete github_accounts row
  const { error: deleteError } = await supabaseAdmin
    .from('github_accounts')
    .delete()
    .eq('user_id', userId);

  if (deleteError) {
    throw new Error(`[githubTokenService] disconnectAccount (delete): ${deleteError.message}`);
  }

  // Reset profiles.github_connected
  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .update({ github_connected: false })
    .eq('id', userId);

  if (profileError) {
    throw new Error(`[githubTokenService] disconnectAccount (profile): ${profileError.message}`);
  }
};
