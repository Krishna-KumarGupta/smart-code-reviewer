import express from 'express';
import { handleWebhook } from '../controllers/webhookController.js';

const router = express.Router();

/**
 * Route definition for GitHub webhook receiver.
 * Captures request body as raw Buffer to ensure crypto.createHmac produces exact matches.
 */
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  (req, _res, next) => {
    req.rawBody = req.body;
    next();
  },
  handleWebhook
);

export default router;
