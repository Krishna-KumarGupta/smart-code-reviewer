import { getValidAccessToken } from './githubTokenService.js';
import { supabaseAdmin } from '../../config/supabase.js';

const createServiceError = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';

const getOwnedRepository = async (userId, repositoryId) => {
  const { data: repo, error } = await supabaseAdmin
    .from('repositories')
    .select('id, user_id, github_repo_id, full_name, name, owner, is_active, github_webhook_id')
    .eq('id', repositoryId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`[githubWebhookDeletionService] Database error fetching repository: ${error.message}`);
  }

  if (!repo) {
    throw createServiceError('[githubWebhookDeletionService] Repository not found or access denied', 404);
  }

  return repo;
};

const clearWebhookId = async (repositoryId) => {
  const { error } = await supabaseAdmin
    .from('repositories')
    .update({
      github_webhook_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', repositoryId);

  if (error) {
    throw new Error(`[githubWebhookDeletionService] Failed to clear webhook ID: ${error.message}`);
  }
};

const callGitHubDeleteWebhook = async (token, owner, repoName, webhookId) => {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repoName}/hooks/${webhookId}`;

  console.log(`[githubWebhookDeletionService] Deleting webhook ${webhookId} for ${owner}/${repoName}`);

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    },
  });

  if (!response.ok && response.status !== 404) {
    const body = await response.json().catch(() => ({}));
    const message = body?.message || response.statusText;
    throw createServiceError(`[githubWebhookDeletionService] GitHub API error ${response.status}: ${message}`, response.status === 401 ? 401 : response.status === 403 ? 403 : response.status === 404 ? 404 : 502);
  }
};

export const deleteRepositoryWebhook = async (userId, repositoryId) => {
  const repo = await getOwnedRepository(userId, repositoryId);

  if (repo.github_webhook_id == null) {
    return { message: 'Webhook deleted successfully.' };
  }

  if (repo.is_active === false) {
    throw createServiceError('Repository is inactive', 400);
  }

  const accessToken = await getValidAccessToken(userId);

  if (!accessToken) {
    throw createServiceError('[githubWebhookDeletionService] GitHub account is not connected or token is unavailable', 400);
  }

  await callGitHubDeleteWebhook(accessToken, repo.owner, repo.name, repo.github_webhook_id);
  await clearWebhookId(repositoryId);

  console.log(`[githubWebhookDeletionService] Webhook removed successfully for ${repo.full_name}`);

  return { message: 'Webhook deleted successfully.' };
};
