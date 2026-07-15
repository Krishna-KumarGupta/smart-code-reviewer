/**
 * GitHub Token Service
 *
 * The ONLY module responsible for all GitHub token operations.
 * No controller, route, or other service may encrypt, decrypt,
 * or query tokens directly.
 *
 * Public API:
 *   storeTokens(userId, githubUser, accessToken, refreshToken?, expiresAt?)
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
 * Algorithm (atomic, race-safe):
 *   1. Pre-flight: fetch any existing row for this user AND any existing row
 *      that already owns the incoming github_user_id (different SELECT).
 *   2. If another Supabase user already owns this github_user_id → throw a
 *      clear conflict error (do NOT violate the unique constraint).
 *   3. Upsert on user_id (UNIQUE constraint) — this is a single atomic DB
 *      operation and eliminates the UPDATE-then-INSERT TOCTOU race condition.
 *   4. .select() is appended to the upsert to confirm the row was actually
 *      written. Without .select(), Supabase JS returns { data: null, error: null }
 *      even when the write did nothing — a silent failure mode.
 *
 * Diagnostic logging (safe):
 *   - Supabase user_id
 *   - GitHub numeric user_id and username
 *   - Whether an existing row was found for this user
 *   - Existing row's github_user_id (if any)
 *   - Intended operation (insert vs update)
 *   - Confirmed written row (id, github_user_id, github_username)
 *   NEVER logs: tokens, JWTs, secrets, OAuth codes, Authorization headers.
 *
 * @param {string} userId            - Supabase user UUID
 * @param {object} githubUser        - GitHub user profile { id, login, avatar_url }
 * @param {string} accessToken       - Raw GitHub access token
 * @param {string|null} refreshToken - Raw refresh token (null for classic tokens)
 * @param {string|null} expiresAt    - ISO expiry timestamp (null if no expiry)
 * @returns {Promise<void>}
 */
export const storeTokens = async (userId, githubUser, accessToken, refreshToken = null, expiresAt = null) => {
  const encrypted_access_token  = encryptToken(accessToken);
  const encrypted_refresh_token = refreshToken ? encryptToken(refreshToken) : null;

  const payload = {
    github_user_id:          githubUser.id,
    github_username:         githubUser.login,
    github_avatar:           githubUser.avatar_url,
    encrypted_access_token,
    encrypted_refresh_token,
    token_expires_at:        expiresAt,
    updated_at:              new Date().toISOString(),
  };

  try {
    // ── Pre-flight diagnostic queries ──────────────────────────────────────
    // Run both lookups in parallel: existing row for this user, and any row
    // that already claims the incoming github_user_id.
    const [existingUserRow, existingGitHubIdRow] = await Promise.all([
      supabaseAdmin
        .from('github_accounts')
        .select('id, github_user_id')
        .eq('user_id', userId)
        .maybeSingle(),
      supabaseAdmin
        .from('github_accounts')
        .select('id, user_id')
        .eq('github_user_id', githubUser.id)
        .maybeSingle(),
    ]);

    // ── Check pre-flight query errors ──────────────────────────────────────
    // maybeSingle() returns { data: null, error: null } for "no rows" —
    // that is fine and expected. It only returns error for actual DB failures.
    // If either query errors, surface it — don't silently treat a failed
    // query as "no row exists" and blindly proceed to an upsert.
    if (existingUserRow.error) {
      console.error('[githubTokenService] storeTokens: pre-flight user lookup failed:', {
        supabaseUserId: userId,
        error: existingUserRow.error.message,
        code:  existingUserRow.error.code,
      });
      throw existingUserRow.error;
    }
    if (existingGitHubIdRow.error) {
      console.error('[githubTokenService] storeTokens: pre-flight github_user_id lookup failed:', {
        incomingGitHubUserId: githubUser.id,
        error: existingGitHubIdRow.error.message,
        code:  existingGitHubIdRow.error.code,
      });
      throw existingGitHubIdRow.error;
    }

    const currentRow       = existingUserRow.data;
    const ownerOfGitHubId  = existingGitHubIdRow.data;
    const rowExistsForUser = currentRow !== null;
    const operation        = rowExistsForUser ? 'update' : 'insert';

    // ── Safe diagnostic log (no tokens, no secrets) ───────────────────────
    console.info('[githubTokenService] storeTokens diagnostic:', {
      supabaseUserId:          userId,
      incomingGitHubUserId:    githubUser.id,
      incomingGitHubUsername:  githubUser.login,
      rowExistsForThisUser:    rowExistsForUser,
      existingRowGitHubUserId: currentRow?.github_user_id ?? null,
      intendedOperation:       operation,
      gitHubIdAlreadyOwnedBy:  ownerOfGitHubId?.user_id ?? null,
      gitHubIdOwnerIsThisUser: ownerOfGitHubId?.user_id === userId,
    });

    // ── Cross-user github_user_id conflict guard ───────────────────────────
    // If the incoming github_user_id is already claimed by a DIFFERENT
    // Supabase user, do NOT proceed — this would violate UNIQUE(github_user_id)
    // and silently link the wrong GitHub account to this Supabase user.
    if (ownerOfGitHubId !== null && ownerOfGitHubId.user_id !== userId) {
      console.error('[githubTokenService] storeTokens: cross-user github_user_id conflict', {
        incomingGitHubUserId: githubUser.id,
        existingOwnerUserId:  ownerOfGitHubId.user_id,
        requestingUserId:     userId,
      });
      throw new Error(
        'This GitHub account is already connected to another user. ' +
        'Please disconnect it from that account first.'
      );
    }

    // ── Atomic upsert on user_id ───────────────────────────────────────────
    // Single operation: INSERT if no row for this user, UPDATE if one exists.
    // onConflict: 'user_id' targets the UNIQUE(user_id) named constraint.
    //
    // IMPORTANT: .select() is intentionally appended.
    // Without .select(), the Supabase JS client returns { data: null, error: null }
    // regardless of whether the row was actually written — a silent failure mode
    // that previously made storeTokens appear to succeed when no row was stored.
    // With .select(), PostgREST returns the written row, confirming the write.
    const { data: upsertedRows, error: upsertError } = await supabaseAdmin
      .from('github_accounts')
      .upsert(
        { user_id: userId, ...payload },
        {
          onConflict:       'user_id',
          ignoreDuplicates: false,
        }
      )
      .select('id, github_user_id, github_username');

    if (upsertError) {
      console.error('[githubTokenService] storeTokens: upsert failed:', {
        supabaseUserId:       userId,
        incomingGitHubUserId: githubUser.id,
        error:   upsertError.message,
        code:    upsertError.code,
        details: upsertError.details,
        hint:    upsertError.hint,
      });
      throw upsertError;
    }

    const writtenRow = upsertedRows?.[0];

    // ── Confirm the row was written ────────────────────────────────────────
    if (!writtenRow) {
      // Upsert returned no rows even though upsertError is null.
      // This indicates either an RLS policy is blocking the write, or the
      // onConflict constraint name doesn't match what PostgREST expects.
      console.error('[githubTokenService] storeTokens: upsert returned 0 rows — row NOT written', {
        supabaseUserId:       userId,
        incomingGitHubUserId: githubUser.id,
        operation,
      });
      throw new Error(
        'GitHub account upsert returned no rows — the row was NOT written. ' +
        'Check RLS policies on github_accounts and the onConflict constraint name.'
      );
    }

    // ── Confirmed ─────────────────────────────────────────────────────────
    console.info('[githubTokenService] storeTokens: row confirmed written', {
      supabaseUserId:        userId,
      operation,
      writtenRowId:          writtenRow.id,
      writtenGitHubUserId:   writtenRow.github_user_id,
      writtenGitHubUsername: writtenRow.github_username,
    });

  } catch (error) {
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
