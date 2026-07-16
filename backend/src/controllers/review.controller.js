import { PRService } from '../services/pr.service.js';
import { PersistenceService } from '../services/persistence.service.js';
import { analyzePrTask } from '../tasks/analyzePrTask.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { supabaseAdmin } from '../config/supabase.js';
import { getPullRequestMetadata } from '../github/client.js';
import { getValidAccessToken } from '../github/services/githubTokenService.js';

export class ReviewController {
  /**
   * Triggers the PR Code Review orchestration workflow using Celery/Redis
   * POST /api/reviews/trigger
   */
  static async triggerReview(req, res, next) {
    try {
      const { owner, repo, pullNumber, repositoryId } = req.body;
      const userId = req.user.id; // Enforce JWT-authenticated user ID

      if (!owner || !repo || !pullNumber || !userId || !repositoryId) {
        sendError(res, 'Missing required parameters: owner, repo, pullNumber, repositoryId', 400);
        return;
      }

      // 1. Fetch Repository Details
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

      // 2. Fetch Pull Request details from GitHub to verify and get shas using OAuth token
      const token = await getValidAccessToken(userId);
      const metadata = await getPullRequestMetadata(owner, repo, parseInt(pullNumber, 10), token);

      if (!metadata) {
        return sendError(res, 'Pull request not found on GitHub', 404);
      }

      // 3. Construct unified job payload to enqueue in Redis
      const jobPayload = {
        userId,
        userEmail: req.user?.email || null,
        repositoryId,
        installation_id: repoRow.installation_id || null,
        repository_id: repoRow.github_repo_id,
        owner,
        repo,
        repository_full_name: repoRow.full_name,
        pullNumber: metadata.number,
        pull_number: metadata.number,
        pull_request_id: metadata.id,
        pull_request_url: metadata.html_url,
        head_sha: metadata.head.sha,
        base_sha: metadata.base.sha,
        sender: metadata.user?.login || 'unknown',
        event_type: 'manual',
        delivery_id: `manual-${repoRow.github_repo_id}-${metadata.number}`,
        timestamp: new Date().toISOString(),
      };

      // 4. Dispatch the Celery task asynchronously using .delay()
      const taskResult = analyzePrTask.delay(jobPayload);

      console.log(`[Review Controller] Celery task dispatched with ID: ${taskResult.taskId}`);

      // 5. Return immediately with 202 Accepted status code
      sendSuccess(res, {
        message: 'AI Review workflow successfully enqueued via Celery',
        taskId: taskResult.taskId,
        status: 'pending',
      }, 202);
    } catch (error) {
      console.error('[Review Controller Error] Failed to enqueue review task:', error);
      sendError(res, error.message || 'Internal Server Error', error.statusCode || 500);
    }
  }

  /**
   * Fetches all reviews for the current user
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
   * Fetches statistics for the current user
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
