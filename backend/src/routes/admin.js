/**
 * Admin Routes
 * Thin route definitions — all business logic lives in adminController.js
 * All routes protected by verifyJWT → isAdmin middleware chain.
 */

import express from 'express';
import verifyJWT from '../middleware/verifyJWT.js';
import isAdmin from '../middleware/isAdmin.js';
import { getDashboard, getUsers } from '../controllers/adminController.js';

const router = express.Router();

// Apply auth guards to all admin routes
router.use(verifyJWT, isAdmin);

// GET /api/admin/dashboard — system-wide stats
router.get('/dashboard', getDashboard);

// GET /api/admin/users — paginated user list
router.get('/users', getUsers);

export default router;
