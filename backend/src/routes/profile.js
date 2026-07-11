/**
 * Profile Routes
 * Thin route definitions — all business logic lives in profileController.js
 */

import express from 'express';
import verifyJWT from '../middleware/verifyJWT.js';
import { getProfile, updateProfile } from '../controllers/profileController.js';

const router = express.Router();

// GET /api/profile — fetch authenticated user's profile
router.get('/profile', verifyJWT, getProfile);

// PUT /api/profile — update allowed profile fields
router.put('/profile', verifyJWT, updateProfile);

export default router;
