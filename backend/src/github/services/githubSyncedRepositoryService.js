/**
 * GitHub Synced Repository Service
 *
 * Reads repositories already synced into the local Supabase repositories table
 * for the authenticated user.
 *
 * This service does NOT call the GitHub API.
 */

import { supabaseAdmin } from '../../config/supabase.js';

export const getUserSyncedRepositories = async (userId) => {
  const { data, error } = await supabaseAdmin
    .from('repositories')
    .select('id, user_id, github_repo_id, full_name, name, owner, private, default_branch, is_active, updated_at')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(`[githubSyncedRepositoryService] Query failed: ${error.message}`);
  }

  return data ?? [];
};
