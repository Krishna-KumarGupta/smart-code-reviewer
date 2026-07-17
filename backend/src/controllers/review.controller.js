import { PersistenceService } from '../services/persistence.service.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { supabaseAdmin } from '../config/supabase.js';
import { getPullRequestMetadata } from '../github/client.js';
import { getValidAccessToken } from '../github/services/githubTokenService.js';
import { REVIEW_AGENT_URL, makeReviewAgentHeaders } from '../utils/reviewAgent.js';

// Parses "https://github.com/owner/repo" into { name, owner, full_name }.
// Used to build the `repositories` object the frontend reads for display
// (repo name/owner badges on History and Detail pages).
function parseOwnerRepo(repoUrl) {
  const parts = repoUrl.replace(/\/$/, '').replace(/\.git$/, '').split('/');
  const name = parts[parts.length - 1] || 'Unknown';
  const owner = parts[parts.length - 2] || 'Unknown';
  return { name, owner, full_name: `${owner}/${name}` };
}

export class ReviewController {
  /**
   * Triggers the PR Code Review orchestration workflow.
   *
   * Flow:
   *  1. Validate inputs & fetch repo from Supabase
   *  2. Verify the PR exists on GitHub
   *  3. Call review-agent's POST /reviews (review-agent owns the reviews table
   *     and generates the reviewId itself)
   *  4. Return 202 with reviewId so the frontend can navigate immediately
   *
   * POST /api/reviews/trigger
   */
  static async triggerReview(req, res, next) {
    try {
      const { owner, repo, pullNumber, repositoryId } = req.body;
      const userId = req.user.id; // Enforce JWT-authenticated user ID

      if (!owner || !repo || !pullNumber || !userId || !repositoryId) {
        return sendError(res, 'Missing required parameters: owner, repo, pullNumber, repositoryId', 400);
      }

      // 1. Fetch Repository Details from Supabase
      const { data: repoRow, error: repoError } = await supabaseAdmin
        .from('repositories')
        .select('*')
        .eq('id', repositoryId)
        .maybeSingle();

      if (repoError || !repoRow) {
        return sendError(res, 'Repository not found or access denied', 404);
      }

      if (!repoRow.is_active) {
        return sendError(res, 'Repository is disabled', 400);
      }

      // 2. Fetch Pull Request details from GitHub to verify and get SHAs
      const token = await getValidAccessToken(userId);
      console.log('[Review Controller] GitHub token available:', !!token);
      const metadata = await getPullRequestMetadata(owner, repo, parseInt(pullNumber, 10), token);

      if (!metadata) {
        return sendError(res, 'Pull request not found on GitHub', 404);
      }

      const prNumber = metadata.number;
      const repoUrl = `https://github.com/${owner}/${repo}`;
      console.log(`[Review Controller] Calling review-agent to trigger manual review for ${repoUrl} PR#${prNumber}`);

      let agentResponse;
      try {
        agentResponse = await fetch(`${REVIEW_AGENT_URL}/reviews`, {
          method: 'POST',
          headers: makeReviewAgentHeaders(req.user, req.userRole || null),
          body: JSON.stringify({ repo_url: repoUrl, pr_number: prNumber }),
        });
      } catch (fetchError) {
        console.error('[Review Controller] Failed to connect to review-agent:', fetchError);
        return sendError(res, `Failed to connect to review-agent: ${fetchError.message}`, 502);
      }

      if (!agentResponse.ok) {
        const errorData = await agentResponse.json().catch(() => ({}));
        console.error('[Review Controller] review-agent returned an error:', errorData);
        return sendError(
          res,
          errorData.detail?.error || 'review-agent returned an error',
          agentResponse.status
        );
      }

      const agentData = await agentResponse.json();
      console.log(`[Review Controller] review-agent successfully enqueued review. review_id: ${agentData.review_id}`);

      return sendSuccess(res, {
        message: 'AI Review workflow successfully enqueued',
        reviewId: agentData.review_id,
        status: agentData.status || 'queued',
      }, 202);

    } catch (error) {
      console.error('[Review Controller Error] triggerReview failed:', error);
      next(error);
    }
  }

  /**
   * Fetches a single review by its Supabase UUID.
   * Only the review's owner can access it.
   *
   * Returns the complete review object:
   *   id, repo_url, pr_number, status, report_json, error, created_at, updated_at,
   *   pr_url, repositories: { name, owner, full_name }
   *
   * GET /api/reviews/:reviewId
   */
  static async getReviewById(req, res, next) {
    try {
      const userId = req.user?.id;
      const { reviewId } = req.params;

      if (!userId) {
        return sendError(res, 'Unauthorized', 401);
      }

      if (!reviewId) {
        return sendError(res, 'Missing reviewId parameter', 400);
      }

      const { data, error } = await supabaseAdmin
        .from('reviews')
        .select('id, repo_url, pr_number, status, report_json, error, created_at, updated_at')
        .eq('id', reviewId)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('[Review Controller] getReviewById DB error:', error.message);
        return sendError(res, 'Failed to fetch review', 500);
      }

      if (!data) {
        return sendError(res, 'Review not found', 404);
      }

      // Safely parse report_json — the agent may store it as a JSON string
      let reportJson = data.report_json;
      if (typeof reportJson === 'string') {
        try {
          reportJson = JSON.parse(reportJson);
        } catch {
          reportJson = null;
        }
      }

      // Build the repositories object the frontend reads for the repo name/owner badge.
      const { name, owner, full_name } = parseOwnerRepo(data.repo_url);

      return sendSuccess(res, {
        id: data.id,
        repo_url: data.repo_url,
        pr_number: data.pr_number,
        status: data.status,
        report_json: reportJson,
        error: data.error,
        created_at: data.created_at,
        updated_at: data.updated_at,
        pr_url: data.repo_url && data.pr_number
          ? `${data.repo_url}/pull/${data.pr_number}`
          : null,
        repositories: { name, owner, full_name },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Fetches all reviews for the current user.
   * GET /api/reviews
   */
  static async getUserReviews(req, res, next) {
    try {
      const reviews = await PersistenceService.getUserReviews(req.user.id);

      // Ensure every review has a `repositories` object for the History page badge,
      // in case PersistenceService doesn't already attach one.
      const reviewsWithRepos = (reviews || []).map((r) => {
        if (r.repositories) return r; // already populated, don't override
        if (!r.repo_url) return r;
        const { name, owner, full_name } = parseOwnerRepo(r.repo_url);
        return { ...r, repositories: { name, owner, full_name } };
      });

      return sendSuccess(res, { reviews: reviewsWithRepos });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Fetches statistics for the current user.
   * GET /api/reviews/stats
   */
  static async getUserStats(req, res, next) {
    try {
      const stats = await PersistenceService.getUserStats(req.user.id);
      return sendSuccess(res, { stats });
    } catch (error) {
      next(error);
    }
  }
}

export default ReviewController;