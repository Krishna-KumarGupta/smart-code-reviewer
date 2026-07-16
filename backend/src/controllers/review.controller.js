import { PersistenceService } from '../services/persistence.service.js';
import { analyzePrTask } from '../tasks/analyzePrTask.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { supabaseAdmin } from '../config/supabase.js';
import { getPullRequestMetadata } from '../github/client.js';
import { getValidAccessToken } from '../github/services/githubTokenService.js';
import crypto from 'crypto';

export class ReviewController {
  /**
   * Triggers the PR Code Review orchestration workflow.
   *
   * Flow:
   *  1. Validate inputs & fetch repo from Supabase
   *  2. Verify the PR exists on GitHub
   *  3. Create a `reviews` row in Supabase (synchronously) — this is the reviewId
   *  4. Dispatch a Celery task that carries the reviewId
   *  5. Return 202 with reviewId so the frontend can navigate immediately
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
      const metadata = await getPullRequestMetadata(owner, repo, parseInt(pullNumber, 10), token);

      if (!metadata) {
        return sendError(res, 'Pull request not found on GitHub', 404);
      }

      const prNumber = metadata.number;
      const repoUrl = `https://github.com/${owner}/${repo}`;
      const userEmail = req.user?.email || null;

      // 3. Synchronously create the reviews row in Supabase.
      //    This gives us the reviewId before the async worker starts.
      const reviewId = crypto.randomUUID();
      const { error: insertError } = await supabaseAdmin
        .from('reviews')
        .insert({
          id: reviewId,
          user_id: userId,
          user_email: userEmail,
          repo_url: repoUrl,
          pr_number: prNumber,
          status: 'pending',
          report_json: null,
          error: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (insertError) {
        console.error('[Review Controller] Failed to insert reviews row:', insertError);
        return sendError(res, 'Failed to create review record', 500);
      }

      // 4. Build the Celery job payload — include reviewId so the worker
      //    can update the exact row that was just created.
      const jobPayload = {
        reviewId,                                      // ← the Supabase reviews.id
        userId,
        userEmail,
        repositoryId,
        installation_id: repoRow.installation_id || null,
        repository_id: repoRow.github_repo_id,
        owner,
        repo,
        repository_full_name: repoRow.full_name,
        pullNumber: prNumber,
        pull_number: prNumber,
        pull_request_id: metadata.id,
        pull_request_url: metadata.html_url,
        head_sha: metadata.head.sha,
        base_sha: metadata.base.sha,
        sender: metadata.user?.login || 'unknown',
        event_type: 'manual',
        delivery_id: `manual-${repoRow.github_repo_id}-${prNumber}`,
        timestamp: new Date().toISOString(),
      };

      // 5. Dispatch the Celery task asynchronously
      const taskResult = analyzePrTask.delay(jobPayload);

      console.log(
        `[Review Controller] Celery task dispatched. reviewId: ${reviewId}, taskId: ${taskResult.taskId}`
      );

      // 6. Return 202 with the reviewId — frontend navigates immediately
      return sendSuccess(res, {
        message: 'AI Review workflow successfully enqueued',
        reviewId,
        taskId: taskResult.taskId,
        status: 'pending',
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
   *   id, repo_url, pr_number, status, report_json, error, created_at, updated_at, pr_url
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
      return sendSuccess(res, { reviews });
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
