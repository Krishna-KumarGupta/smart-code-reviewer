import { octokit, getPullRequestDiff, createPullRequestReview } from '../github/client.js';
import { GitHubAPIError } from '../utils/errors.js';
import { Octokit } from '@octokit/rest';

export class GitHubService {
  /**
   * List all open Pull Requests for a selected repository
   */
  static async listOpenPullRequests(owner, repo, token = null, extraInfo = {}) {
    const client = token ? new Octokit({ auth: token }) : octokit;
    try {
      const response = await client.pulls.list({
        owner,
        repo,
        state: 'open',
        per_page: 50,
      });
      return response.data.map((pr) => ({
        id: pr.id,
        number: pr.number,
        title: pr.title,
        state: pr.state,
        user: pr.user?.login || 'unknown',
        created_at: pr.created_at,
        html_url: pr.html_url,
      }));
    } catch (error) {
      console.error(`[GitHub REST API] Failed request details:`, {
        endpoint: `GET /repos/${owner}/${repo}/pulls`,
        status: error.status,
        responseBody: error.response?.data || error.message,
        installationId: extraInfo.installationId || null,
        owner,
        repo,
        authenticatedGitHubUser: extraInfo.authenticatedGitHubUser || null,
      });

      if (error.status === 404) {
        throw new GitHubAPIError(`Repository '${owner}/${repo}' not found or invalid repository access.`, { status: 404 });
      }
      if (error.status === 403 && error.headers?.['x-ratelimit-remaining'] === '0') {
        throw new GitHubAPIError('GitHub API rate limit exceeded.', { status: 403 });
      }
      throw new GitHubAPIError(error.message || 'Failed to list open pull requests', { status: error.status });
    }
  }

  /**
   * Fetch full PR diff/patch content from GitHub for a specific PR
   */
  static async getPullRequestDiffContent(owner, repo, pullNumber) {
    try {
      return await getPullRequestDiff(owner, repo, parseInt(pullNumber, 10));
    } catch (error) {
      throw new GitHubAPIError(`Failed to fetch diff for PR #${pullNumber}: ${error.message}`, { status: error.status });
    }
  }

  /**
   * Format fetched diff into a structured JSON payload for the AI Agent
   */
  static cleanPayload(diffContent, prDetails) {
    const MAX_DIFF_CHARS = 30000;
    let sanitizedDiff = diffContent || '';
    
    if (sanitizedDiff.length > MAX_DIFF_CHARS) {
      sanitizedDiff = sanitizedDiff.substring(0, MAX_DIFF_CHARS) +
        `\n\n... [Diff truncated to first ${MAX_DIFF_CHARS} characters for token safety] ...`;
    }

    return {
      pr_metadata: {
        pr_id: prDetails.id,
        pr_number: prDetails.number,
        pr_title: prDetails.title,
        pr_url: prDetails.html_url || prDetails.url,
        pr_author: prDetails.user || prDetails.author,
        repo_name: prDetails.repo_name || `${prDetails.owner}/${prDetails.repo}`,
      },
      diff_content: sanitizedDiff,
      file_context: `PR Outline: ${prDetails.title} (PR #${prDetails.number})`,
      retry_count: 0,
    };
  }

  /**
   * Post AI review comments directly to the pull request using GitHub Reviews API
   */
  static async postPullRequestReview(owner, repo, pullNumber, body, event = 'COMMENT', token = null) {
    try {
      return await createPullRequestReview(owner, repo, pullNumber, body, event, token);
    } catch (error) {
      throw new GitHubAPIError(`Failed to post pull request review: ${error.message}`, { status: error.status });
    }
  }
}
