/**
 * GitHub Repository Service
 *
 * Responsible ONLY for fetching repositories from the GitHub REST API.
 *
 * This service:
 *   - Retrieves a valid access token via githubTokenService
 *   - Calls the GitHub API
 *   - Returns a mapped, minimal repository array
 *
 * This service does NOT:
 *   - Save anything to the database
 *   - Expose or log access tokens
 *   - Contain Express request/response logic
 *
 * Database synchronisation will be implemented in a later phase.
 */

import { getValidAccessToken } from './githubTokenService.js';

const GITHUB_API_BASE    = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';

/**
 * Fetch the authenticated user's repositories from GitHub.
 *
 * Retrieves all repositories the token owner has access to, sorted by
 * most recently updated. Pages through the GitHub API automatically to
 * collect every repository (GitHub returns at most 100 per page).
 *
 * @param {string} userId - Supabase user UUID
 * @returns {Promise<Array<{
 *   id:             number,
 *   name:           string,
 *   full_name:      string,
 *   owner:          string,
 *   private:        boolean,
 *   default_branch: string,
 *   html_url:       string,
 *   language:       string|null,
 *   updated_at:     string,
 * }>>} Mapped repository list
 * @throws {Error} If the GitHub account is not connected or the API call fails
 */
export const fetchUserRepositories = async (userId) => {
  // ── Step 1: Obtain a valid access token ──────────────────────────────────
  // getValidAccessToken handles decryption and expiry checks internally.
  // We never handle or log the raw token beyond passing it in the header.
  const token = await getValidAccessToken(userId);

  if (!token) {
    throw new Error('GitHub account not connected');
  }

  // ── Step 2: Page through GitHub's /user/repos endpoint ───────────────────
  // GitHub returns at most 100 repos per page. We collect all pages before
  // mapping to avoid returning partial results.
  const allRepos = [];
  let   page     = 1;
  const perPage  = 100; // Maximum allowed by GitHub

  while (true) {
    const url = new URL(`${GITHUB_API_BASE}/user/repos`);
    url.searchParams.set('per_page', String(perPage));
    url.searchParams.set('page',     String(page));
    url.searchParams.set('sort',     'updated');      // Most recently updated first
    url.searchParams.set('affiliation', 'owner,collaborator,organization_member');

    const response = await fetch(url.toString(), {
      method:  'GET',
      headers: {
        // Token passed in header — never logged, never returned to client
        'Authorization':        `Bearer ${token}`,
        'Accept':               'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
    });

    // ── Step 3: Handle GitHub API errors ─────────────────────────────────
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        `GitHub API error ${response.status}: ${body.message || response.statusText}`
      );
    }

    const page_repos = await response.json();

    if (!Array.isArray(page_repos) || page_repos.length === 0) {
      break; // No more pages
    }

    allRepos.push(...page_repos);

    // Stop if we received fewer repos than requested — last page reached
    if (page_repos.length < perPage) break;

    page += 1;
  }

  // ── Step 4: Map to a minimal, safe shape ─────────────────────────────────
  // Return only the fields this application needs.
  // The raw GitHub response contains 100+ fields — we intentionally discard them.
  return allRepos.map((repo) => ({
    id:             repo.id,
    name:           repo.name,
    full_name:      repo.full_name,
    owner:          repo.owner?.login ?? null,
    private:        repo.private,
    default_branch: repo.default_branch,
    html_url:       repo.html_url,
    language:       repo.language ?? null,
    updated_at:     repo.updated_at,
  }));
};
