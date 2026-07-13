/**
 * GitHub OAuth Service — Database Operations
 *
 * Responsible for non-token GitHub account DB operations:
 *   - Fetching public account info (username, avatar — NO tokens)
 *   - Updating profiles.github_connected
 *
 * Token storage and retrieval is handled exclusively by githubTokenService.
 * This service NEVER reads or writes encrypted_access_token or encrypted_refresh_token.
 *
 * Uses supabaseAdmin (service role) to bypass RLS for server-side operations.
 */

import { supabaseAdmin } from '../../config/supabase.js';

/**
 * Fetch the public GitHub account record for a user.
 * Intentionally excludes token columns — use githubTokenService for tokens.
 *
 * @param {string} userId - Supabase user UUID
 * @returns {Promise<object|null>} Public account data, or null if not connected
 */
export const getGitHubAccount = async (userId) => {
  const { data, error } = await supabaseAdmin
    .from('github_accounts')
    .select('id, github_user_id, github_username, github_avatar, token_expires_at, created_at, updated_at')
    .eq('user_id', userId)
    .single();

  if (error?.code === 'PGRST116') return null; // No rows — not connected
  if (error) throw new Error(`[githubOAuthService] getGitHubAccount: ${error.message}`);

  return data;
};

/**
 * Update the github_connected flag on the profiles table.
 *
 * Per the database ownership rule, profiles only stores github_connected.
 * Username and avatar live exclusively in github_accounts.
 *
 * @param {string}  userId    - Supabase user UUID
 * @param {boolean} connected - true = connected, false = disconnected
 * @returns {Promise<void>}
 */
export const setGitHubConnected = async (userId, connected) => {
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ github_connected: connected })
    .eq('id', userId);

  if (error) throw new Error(`[githubOAuthService] setGitHubConnected: ${error.message}`);
};
