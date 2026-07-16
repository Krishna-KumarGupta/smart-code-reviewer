/**
 * Review Service — Frontend
 *
 * Calls backend endpoints for review triggers, history, and stats.
 * Uses the centralized Axios `api` instance which auto-attaches JWT.
 * API calls for AI code review results.
 * Uses the centralized Axios `api` instance which auto-attaches the Supabase JWT.
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
   * Get user's review statistics
   * GET /api/reviews/stats
   */
  getUserStats: async () => {
    const response = await api.get('/api/reviews/stats');
    return response.data.data.stats;
  },
};

export default reviewService;
