/**
 * GitHub Service — Database Operations
 *
 * All direct Supabase queries for github_accounts and related profile updates.
 * Controllers call these functions — no raw DB queries in controllers.
 *
 * Uses supabaseAdmin (service role) to bypass RLS for server-side writes.
 */

import { supabaseAdmin } from '../config/supabase.js';

/**
 * Fetch the GitHub account record for a user.
 *
 * @param {string} userId - Supabase user UUID
 * @returns {Promise<object|null>} The github_accounts row, or null if not found
 */
export const getGitHubAccount = async (userId) => {
  const { data, error } = await supabaseAdmin
    .from('github_accounts')
    .select('id, github_user_id, github_username, github_avatar, token_expires_at, created_at, updated_at')
    .eq('user_id', userId)
    .single();

  if (error?.code === 'PGRST116') return null; // No rows — not connected
  if (error) throw new Error(`[githubService] getGitHubAccount: ${error.message}`);

  return data;
};

/**
 * Insert or update the GitHub account for a user.
 * Uses ON CONFLICT (user_id) DO UPDATE to enforce the one-account-per-user rule.
 *
 * @param {string} userId - Supabase user UUID
 * @param {object} accountData - Fields to upsert
 * @param {number} accountData.github_user_id
 * @param {string} accountData.github_username
 * @param {string} accountData.github_avatar
 * @param {string} accountData.encrypted_access_token
 * @param {string} [accountData.encrypted_refresh_token]
 * @param {string} [accountData.token_expires_at]
 * @returns {Promise<object>} The upserted row
 */
export const upsertGitHubAccount = async (userId, accountData) => {
  const { data, error } = await supabaseAdmin
    .from('github_accounts')
    .upsert(
      {
        user_id: userId,
        ...accountData,
        updated_at: new Date().toISOString(),
      },
      {
        // Reference the named constraint explicitly so Postgres resolves
        // the conflict on user_id only — never on github_user_id.
        onConflict: 'user_id',
        ignoreDuplicates: false, // always UPDATE existing row, never skip
      }
    )
    .select('id, github_user_id, github_username, github_avatar, created_at, updated_at')
    .single();

  if (error) throw new Error(`[githubService] upsertGitHubAccount: ${error.message}`);

  return data;
};


/**
 * Delete a user's GitHub account record (disconnect).
 *
 * @param {string} userId - Supabase user UUID
 * @returns {Promise<void>}
 */
export const deleteGitHubAccount = async (userId) => {
  const { error } = await supabaseAdmin
    .from('github_accounts')
    .delete()
    .eq('user_id', userId);

  if (error) throw new Error(`[githubService] deleteGitHubAccount: ${error.message}`);
};

/**
 * Update the github_connected flag and github_username on the profiles table.
 *
 * @param {string} userId    - Supabase user UUID
 * @param {boolean} connected - true = connected, false = disconnected
 * @param {string|null} [username] - GitHub username to sync (optional)
 * @returns {Promise<void>}
 */
export const setGitHubConnected = async (userId, connected, username = null) => {
  const updates = { github_connected: connected };
  if (username !== null) updates.github_username = connected ? username : null;

  const { error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', userId);

  if (error) throw new Error(`[githubService] setGitHubConnected: ${error.message}`);
};
