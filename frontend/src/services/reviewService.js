/**
 * Review Service — Frontend
 *
 * Calls backend endpoints for review triggers, history, and stats.
 * Uses the centralized Axios `api` instance which auto-attaches JWT.
 */

import api from './api.js';

const reviewService = {
  /**
   * Triggers a manual PR review
   * POST /api/reviews/trigger
   */
  triggerReview: async (owner, repo, pullNumber, userId, repositoryId) => {
    const response = await api.post('/api/reviews/trigger', {
      owner,
      repo,
      pullNumber,
      userId,
      repositoryId,
    });
    return response.data;
  },

  /**
   * Get user's review history
   * GET /api/reviews
   */
  getUserReviews: async () => {
    const response = await api.get('/api/reviews');
    return response.data.data.reviews;
  },

  /**
   * Get a single review by ID, including the full AI `result` object.
   *
   * @param {string} reviewId - Supabase UUID of the review row
   * @returns {Promise<object>}
   */
  getReview: async (reviewId) => {
    const response = await api.get(`/api/reviews/${reviewId}`);
    return response.data;
  },

  /**
   * Create / retry a review for a given repo + PR number.
   *
   * @param {{ repo_url: string, pr_number: number }} payload
   * @returns {Promise<{ review: object }>}
   */
  createReview: async ({ repo_url, pr_number }) => {
    const response = await api.post('/api/reviews', { repo_url, pr_number });
    return response.data.data;
  },
  getUserStats: async () => {
    const response = await api.get('/api/reviews/stats');
    return response.data.data.stats;
  },
};

export default reviewService;
