/**
 * GitHub OAuth Routes
 *
 * Mounted at /api/github in server.js
 *
 * Protected (JWT required — user must already be authenticated):
 *   GET  /api/github/connect     → Return GitHub OAuth URL, browser redirects
 *   GET  /api/github/status      → Connection status for current user
 *   GET  /api/github/repos       → List repositories from GitHub
 *   POST /api/github/disconnect  → Remove GitHub account link
 *
 * Public (GitHub redirects here — no JWT available):
 *   GET  /api/github/callback    → Complete OAuth flow via signed state
 */

import express    from 'express';
import verifyJWT  from '../../middleware/verifyJWT.js';
import {
  connectWithGitHub,
  handleGitHubCallback,
  getGitHubStatus,
  disconnectGitHub,
  getRepositories,
  syncRepositories,
  getSyncedRepositories,
} from '../controllers/githubController.js';

const router = express.Router();

// ─── OAuth Initiation ─────────────────────────────────────────────────────────
// JWT required: we encode the authenticated user's ID into the signed state
router.get('/connect', verifyJWT, connectWithGitHub);

// ─── OAuth Callback ───────────────────────────────────────────────────────────
// No JWT: GitHub sends the browser here with code + signed state
// Identity is established by verifySignedState() inside the controller
router.get('/callback', handleGitHubCallback);

// ─── Account Management ───────────────────────────────────────────────────────
router.get('/status',      verifyJWT, getGitHubStatus);
router.get('/repos',       verifyJWT, getRepositories);
router.get('/repositories', verifyJWT, getSyncedRepositories);
router.post('/sync-repositories', verifyJWT, syncRepositories);
router.post('/disconnect', verifyJWT, disconnectGitHub);

export default router;
