import express from 'express';
import verifyJWT from '../../middleware/verifyJWT.js';
import {
  enableRepositoryWebhook,
  disableRepositoryWebhook,
} from '../controllers/githubWebhookManagementController.js';

const router = express.Router();

router.post('/repositories/:repositoryId/webhook', verifyJWT, enableRepositoryWebhook);
router.delete('/repositories/:repositoryId/webhook', verifyJWT, disableRepositoryWebhook);

export default router;
