const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

/**
 * Extracts the Supabase JWT token from localStorage.
 * It searches both Supabase session keys and custom token keys.
 */
function getJWTToken() {
  // Find any keys matching Supabase auth token storage
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || '{}');
        if (parsed.access_token) return parsed.access_token;
      } catch (e) {
        console.error('Failed to parse Supabase token from localStorage', e);
      }
    }
  }
  // Fallback to standard token storage key
  return localStorage.getItem('token') || '';
}

/**
 * GitHub API Service using native fetch
 */
export const githubApi = {
  /**
   * Fetches open pull requests for a given repository from the backend
   * GET /api/github/repos/:owner/:repo/pulls
   */
  fetchOpenPullRequests: async (owner, repo) => {
    const token = getJWTToken();

    const response = await fetch(`${API_BASE_URL}/api/github/repos/${owner}/${repo}/pulls`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to fetch PRs: Status ${response.status}`);
    }

    const data = await response.json();
    return data.data.pullRequests;
  },

  /**
   * Triggers a manual PR review
   * POST /api/reviews/trigger
   */
  triggerReview: async (owner, repo, pullNumber, userId, repositoryId) => {
    const token = getJWTToken();

    const response = await fetch(`${API_BASE_URL}/api/reviews/trigger`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({ owner, repo, pullNumber, userId, repositoryId }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to trigger review: Status ${response.status}`);
    }

    return response.json();
  },
};

export default githubApi;
