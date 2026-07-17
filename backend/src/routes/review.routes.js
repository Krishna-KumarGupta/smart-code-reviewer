/**
 * Review Routes
 *
 * Mounted at /api/reviews in server.js
 *
 * Protected (JWT required):
 *   POST /api/reviews/trigger     → Trigger manual PR review (returns reviewId)
 *   GET  /api/reviews             → List all reviews for the authenticated user
 *   GET  /api/reviews/stats       → Stats summary for the authenticated user
 *   GET  /api/reviews/:reviewId   → Get a single review by its Supabase UUID
 */

import express from 'express';
import verifyJWT from '../middleware/verifyJWT.js';
import { ReviewController } from '../controllers/review.controller.js';

const router = express.Router();

// Trigger a manual review → returns { reviewId, taskId, status }
router.post('/trigger', verifyJWT, ReviewController.triggerReview);

// Retry a failed review → returns { reviewId, taskId, status }
router.post('/:reviewId/retry', verifyJWT, ReviewController.retryReview);

// List user's reviews
router.get('/', verifyJWT, ReviewController.getUserReviews);

// User stats (must be before /:reviewId to prevent 'stats' being captured as an id)
router.get('/stats', verifyJWT, ReviewController.getUserStats);

// Get a single review by its Supabase UUID
// AIReviewReportPage calls GET /api/reviews/:reviewId
router.get('/:reviewId', verifyJWT, ReviewController.getReviewById);

export default router;
