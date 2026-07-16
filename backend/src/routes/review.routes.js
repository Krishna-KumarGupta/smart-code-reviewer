/**
 * Review Routes
 *
 * Mounted at /api/reviews in server.js
 *
 * Protected (JWT required):
 *   POST /api/reviews/trigger → Trigger manual PR review
 */

import express from 'express';
import verifyJWT from '../middleware/verifyJWT.js';
import { ReviewController } from '../controllers/review.controller.js';

const router = express.Router();

// Trigger a manual review
router.post('/trigger', verifyJWT, ReviewController.triggerReview);

// Get user's reviews
router.get('/', verifyJWT, ReviewController.getUserReviews);

// Get user's stats
router.get('/stats', verifyJWT, ReviewController.getUserStats);

export default router;
