import { Octokit } from '@octokit/rest';
import { GitHubAPIError } from '../utils/errors.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

export const octokit = new Octokit({
  auth: GITHUB_TOKEN || undefined,
});

/**
 * Exponential backoff helper for network retries and rate limit recovery
 */
async function retryWithBackoff(fn, retries = 3, delayMs = 1000) {
  try {
    return await fn();
  } catch (error) {
    const isRateLimit = error.status === 403 && error.headers?.['x-ratelimit-remaining'] === '0';
    const isRetryable = error.status >= 500 || error.status === 429 || isRateLimit;

    if (retries > 0 && isRetryable) {
      let backoffDelay = delayMs;
      
      if (isRateLimit && error.headers?.['x-ratelimit-reset']) {
        const resetTime = parseInt(error.headers['x-ratelimit-reset'], 10) * 1000;
        backoffDelay = Math.max(resetTime - Date.now(), delayMs);
      }

      console.warn(`[GitHub API] Request failed. Retrying in ${backoffDelay}ms... (${retries} attempts left)`);
      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
      return retryWithBackoff(fn, retries - 1, delayMs * 2);
    }
    
    throw new GitHubAPIError(
      error.message || 'GitHub API Request Failed',
      { status: error.status, details: error.response?.data }
    );
  }
}

/**
 * Robust wrapper to fetch pull request metadata
 */
export async function getPullRequestMetadata(owner, repo, pullNumber, token = null) {
  const client = token ? new Octokit({ auth: token }) : octokit;
  return retryWithBackoff(() =>
    client.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    })
  ).then(res => res.data);
}

/**
 * Robust wrapper to fetch list of changed files in a pull request
 */
export async function getPullRequestFiles(owner, repo, pullNumber, token = null) {
  const client = token ? new Octokit({ auth: token }) : octokit;
  return retryWithBackoff(() =>
    client.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    })
  ).then(res => res.data);
}

/**
 * Robust wrapper to fetch complete pull request diff content
 */
export async function getPullRequestDiff(owner, repo, pullNumber, token = null) {
  const client = token ? new Octokit({ auth: token }) : octokit;
  return retryWithBackoff(async () => {
    const userResponse = await client.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
      headers: {
        accept: 'application/vnd.github.v3.diff',
      },
    });
    return userResponse.data;
  });
}

/**
 * Robust wrapper to create a pull request review comment
 */
export async function createPullRequestReview(owner, repo, pullNumber, body, event = 'COMMENT', token = null) {
  const client = token ? new Octokit({ auth: token }) : octokit;
  return retryWithBackoff(() =>
    client.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      body,
      event,
    })
  ).then(res => res.data);
}
