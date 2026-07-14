/**
 * GitHub OAuth Routes
 *
 * Mounted at /api/github in server.js
 *
 * Public (no JWT — GitHub controls the redirect):
 *   GET /api/github/login     → Redirect to GitHub OAuth screen
 *   GET /api/github/callback  → Handle GitHub OAuth callback
 *
 * Protected (requires valid Supabase JWT):
 *   GET  /api/github/status     → Get connection status
 *   POST /api/github/disconnect → Remove GitHub account link
 */

import express from 'express';
import verifyJWT from '../middleware/verifyJWT.js';
import {
  loginWithGitHub,
  handleGitHubCallback,
  getGitHubStatus,
  disconnectGitHub,
} from './githubController.js';

const router = express.Router();

// ─── OAuth Flow ───────────────────────────────────────────────────────────────

// Requires JWT — we need the user ID to encode into state
router.get('/login', verifyJWT, loginWithGitHub);

// No JWT — GitHub sends this redirect with code + state
// State carries the encoded user ID for CSRF protection
router.get('/callback', handleGitHubCallback);

// ─── Account Management ───────────────────────────────────────────────────────

// Returns { connected, username, avatar }
router.get('/status', verifyJWT, getGitHubStatus);

// Removes github_accounts row + resets profiles.github_connected
router.post('/disconnect', verifyJWT, disconnectGitHub);

export default router;
