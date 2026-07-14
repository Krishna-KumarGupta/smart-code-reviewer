/**
 * GitHub Token Service
 *
 * Centralised service for all token operations.
 * Controllers MUST NOT decrypt tokens directly — use this service.
 *
 * Responsibilities:
 *   - encryptToken(token)        : encrypt before DB storage
 *   - decryptToken(encrypted)    : decrypt for API calls
 *   - getValidToken(userId)      : fetch from DB, decrypt, check expiry
 *   - refreshToken(userId)       : stub — architecture ready for future use
 *                                  (GitHub OAuth tokens don't expire by default)
 *
 * Security:
 *   - Raw tokens are NEVER logged
 *   - Raw tokens are NEVER returned to the frontend
 *   - Only this service may call githubCrypto.decrypt()
 */

import { encrypt, decrypt } from './githubCrypto.js';
import { supabaseAdmin }    from '../config/supabase.js';

/**
 * Encrypt a raw OAuth token for DB storage.
 *
 * @param {string} token - Raw access/refresh token from GitHub
 * @returns {string} Encrypted token string (iv:authTag:ciphertext)
 */
export const encryptToken = (token) => encrypt(token);

/**
 * Decrypt a stored encrypted token.
 * Used internally only — result must never reach the frontend.
 *
 * @param {string} encryptedToken - The stored encrypted string
 * @returns {string} Decrypted raw token
 */
export const decryptToken = (encryptedToken) => decrypt(encryptedToken);

/**
 * Fetch the valid (decrypted) access token for a user.
 * Checks expiry if token_expires_at is set.
 *
 * @param {string} userId - The Supabase user UUID
 * @returns {Promise<string|null>} Decrypted access token, or null if not connected / expired
 */
export const getValidToken = async (userId) => {
  try {
    const { data: account, error } = await supabaseAdmin
      .from('github_accounts')
      .select('encrypted_access_token, token_expires_at')
      .eq('user_id', userId)
      .single();

    if (error || !account?.encrypted_access_token) return null;

    // Check expiry if token_expires_at is set (GitHub classic tokens don't expire)
    if (account.token_expires_at) {
      const expiresAt = new Date(account.token_expires_at);
      if (expiresAt <= new Date()) {
        // Token is expired — attempt refresh (stub for now)
        return await refreshToken(userId);
      }
    }

    return decryptToken(account.encrypted_access_token);
  } catch (err) {
    console.error('[githubTokenService] getValidToken error:', err.message);
    return null;
  }
};

/**
 * Refresh Token — Architecture stub.
 *
 * GitHub classic OAuth tokens do not expire.
 * GitHub fine-grained tokens CAN expire and support refresh tokens.
 * This stub is ready for when refresh token support is needed.
 *
 * @param {string} userId - The Supabase user UUID
 * @returns {Promise<string|null>} New decrypted access token, or null on failure
 */
export const refreshToken = async (userId) => {
  // TODO (Phase 3): Implement GitHub token refresh flow
  // 1. Fetch encrypted_refresh_token from github_accounts
  // 2. Decrypt it
  // 3. POST to https://github.com/login/oauth/access_token with grant_type=refresh_token
  // 4. Encrypt new tokens and update github_accounts
  // 5. Return new access token

  console.warn('[githubTokenService] refreshToken: not yet implemented (stub)');
  return null;
};
