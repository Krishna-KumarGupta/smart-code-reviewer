/**
 * GitHub Repository Sync Service
 *
 * Synchronises repositories fetched from the GitHub API into the
 * local Supabase `repositories` table.
 *
 * Responsibilities:
 *   - Fetch repositories via githubRepositoryService (no direct API calls)
 *   - Map GitHub fields to database columns
 *   - Upsert into `repositories` (insert new, update existing)
 *   - Return a summary of what was synced
 *
 * This service does NOT:
 *   - Call the GitHub API directly
 *   - Handle JWT or Express request/response
 *   - Expose or log access tokens
 */

import { fetchUserRepositories } from './githubRepositoryService.js';
import { supabaseAdmin }          from '../../config/supabase.js';

/**
 * Synchronise all GitHub repositories for a given user into Supabase.
 *
 * Flow:
 *   1. Fetch the mapped repository list from githubRepositoryService
 *   2. Build the database rows from the mapped fields
 *   3. Upsert into `repositories` (conflict on `id` — the GitHub repo integer ID)
 *   4. Return a summary { synced, repositories }
 *
 * @param {string} userId - Supabase user UUID (owner of the GitHub account)
 * @returns {Promise<{
 *   synced:       number,
 *   repositories: Array<{ id: number, repo_name: string, owner: string, is_active: boolean }>
 * }>}
 * @throws {Error} If the GitHub account is not connected or the DB upsert fails
 */
export const syncUserRepositories = async (userId) => {
  // ── Step 1: Fetch repositories from GitHub via the repository service ──────
  // githubRepositoryService handles token retrieval and API pagination.
  // We receive a clean, already-mapped array — no raw GitHub response here.
  const githubRepos = await fetchUserRepositories(userId);

  if (!githubRepos || githubRepos.length === 0) {
    // No repositories to sync — return early with an empty result
    return { synced: 0, repositories: [] };
  }

  // ── Step 2: Map GitHub fields to database columns ─────────────────────────
  // Only the fields required by the repositories table are included.
  // Extra GitHub fields are intentionally discarded.
  const rows = githubRepos.map((repo) => ({
    user_id: userId,
    github_repo_id: repo.id,
    full_name: repo.full_name,
    name: repo.name,
    owner: repo.owner,
    private: repo.private,
    default_branch: repo.default_branch,
    is_active: true,
  }));

  // ── Step 3: Upsert into the repositories table ────────────────────────────
  // ON CONFLICT on the composite key (user_id, github_repo_id):
  //   - If the row does not exist → INSERT
  //   - If the row already exists → UPDATE the repository details
  const { data: upserted, error } = await supabaseAdmin
    .from('repositories')
    .upsert(rows, {
      onConflict: 'user_id,github_repo_id',
      ignoreDuplicates: false,
    })
    .select();

  if (error) {
    throw new Error(`[githubRepositorySyncService] Upsert failed: ${error.message}`);
  }

  // ── Step 4: Return sync summary ───────────────────────────────────────────
  const repositories = upserted ?? [];

  return {
    synced:       repositories.length,
    repositories,
  };
};
