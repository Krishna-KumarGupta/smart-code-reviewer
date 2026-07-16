import { createRepositoryWebhook } from '../services/githubWebhookCreationService.js';
import { deleteRepositoryWebhook } from '../services/githubWebhookDeletionService.js';

const sendJson = (res, payload, statusCode = 200) => res.status(statusCode).json(payload);

export const enableRepositoryWebhook = async (req, res, next) => {
  try {
    const { repositoryId } = req.params;

    if (!repositoryId) {
      return sendJson(res, { success: false, error: 'Repository ID is required' }, 400);
    }

    const result = await createRepositoryWebhook(req.user.id, repositoryId);

    return sendJson(res, {
      success: true,
      message: result.alreadyExisted ? 'Webhook already exists.' : 'Webhook created successfully.',
    });
  } catch (err) {
    if (err.message?.includes('Repository not found or access denied')) {
      return sendJson(res, { success: false, error: 'Repository not found' }, 404);
    }

    if (err.statusCode === 401) {
      return sendJson(res, { success: false, error: 'Unauthorized' }, 401);
    }

    if (err.statusCode === 403) {
      return sendJson(res, { success: false, error: 'Forbidden' }, 403);
    }

    if (err.statusCode === 404) {
      return sendJson(res, { success: false, error: 'Repository not found' }, 404);
    }

    if (err.message?.includes('GitHub account is not connected')) {
      return sendJson(res, { success: false, error: 'GitHub account not connected' }, 400);
    }

    next(err);
  }
};

export const disableRepositoryWebhook = async (req, res, next) => {
  try {
    const { repositoryId } = req.params;

    if (!repositoryId) {
      return sendJson(res, { success: false, error: 'Repository ID is required' }, 400);
    }

    const result = await deleteRepositoryWebhook(req.user.id, repositoryId);

    return sendJson(res, {
      success: true,
      message: result.message,
    });
  } catch (err) {
    if (err.message?.includes('Repository not found or access denied')) {
      return sendJson(res, { success: false, error: 'Repository not found' }, 404);
    }

    if (err.statusCode === 401) {
      return sendJson(res, { success: false, error: 'Unauthorized' }, 401);
    }

    if (err.statusCode === 403) {
      return sendJson(res, { success: false, error: 'Forbidden' }, 403);
    }

    if (err.statusCode === 404) {
      return sendJson(res, { success: false, error: 'Repository not found' }, 404);
    }

    next(err);
  }
};
