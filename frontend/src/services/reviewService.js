/**
 * Review Service — Frontend
 *
 * API calls for AI code review results.
 * Uses the centralized Axios `api` instance which auto-attaches the Supabase JWT.
 */

import api from './api.js';

const reviewService = {
  /**
   * List all reviews for the authenticated user (newest first).
   * Does not include the full `result` blob.
   *
   * @returns {Promise<{ reviews: Array }>}
   */
  listReviews: async () => {
    const response = await api.get('/api/reviews');
    return response.data.data;
  },

  /**
   * Get a single review by ID, including the full AI `result` object.
   *
   * @param {string} reviewId - Supabase UUID of the review row
   * @returns {Promise<{ review: object }>}
   */
  getReview: async (reviewId) => {
    const response = await api.get(`/api/reviews/${reviewId}`);
    return response.data.data;
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
};

export default reviewService;
