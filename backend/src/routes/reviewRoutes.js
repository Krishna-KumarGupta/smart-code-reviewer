/**
 * Review Routes
 * Mounted at /api/reviews in server.js
 *
 *   GET /api/reviews      — list all reviews for the authenticated user
 *   GET /api/reviews/:id  — get a single review with full AI result detail
 */

import express   from 'express';
import verifyJWT from '../middleware/verifyJWT.js';
import { listReviews, getReview } from '../controllers/reviewController.js';

const router = express.Router();

router.get('/',    verifyJWT, listReviews);
router.get('/:id', verifyJWT, getReview);

export default router;
