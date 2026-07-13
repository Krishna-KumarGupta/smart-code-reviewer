/**
 * GitHub Service — Frontend
 *
 * All GitHub-related API calls. Uses the centralized Axios `api` instance
 * which auto-attaches the Supabase JWT to every request.
 */

import api from './api.js';

const githubService = {
  /**
   * Initiate GitHub OAuth connection.
   */
  connect: async () => {
    const response = await api.get('/api/github/connect');
    const { url } = response.data.data;

    if (url) {
      window.location.href = url;
    }
  },

  /**
   * Get GitHub connection status.
   */
  status: async () => {
    const response = await api.get('/api/github/status');
    return response.data.data;
  },

  /**
   * Fetch all repositories of the connected GitHub account.
   *
   * @returns {Promise<Array>}
   */
  getRepositories: async () => {
    const response = await api.get('/api/github/repositories');
    return response.data.data;
  },

  /**
   * Sync GitHub repositories to the backend.
   */
  syncRepositories: async () => {
    const response = await api.post('/api/github/sync-repositories');
    return response.data.data;
  },

  /**
   * Disconnect GitHub account.
   */
  disconnect: async () => {
    const response = await api.post('/api/github/disconnect');
    return response.data.data;
  },
};

export default githubService;