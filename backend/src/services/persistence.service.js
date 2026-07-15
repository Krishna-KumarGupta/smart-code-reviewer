import { supabaseAdmin } from '../config/supabase.js';
import { DatabasePersistenceError } from '../utils/errors.js';
import crypto from 'crypto';

export class PersistenceService {
  /**
   * Initializes a pending review entry in the database
   */
  static async createReview(params) {
    // Extract repository URL or format it appropriately
    let repoUrl = '';
    if (params.prUrl) {
      repoUrl = params.prUrl.split('/pull/')[0];
    }

    const reviewId = crypto.randomUUID();

    const { data, error } = await supabaseAdmin
      .from('reviews')
      .insert({
        id: reviewId,
        user_id: params.userId,
        user_email: params.userEmail || null,
        repo_url: repoUrl,
        pr_number: params.prNumber,
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      throw new DatabasePersistenceError('Failed to create review entry in database', error);
    }

    return data.id;
  }

  /**
   * Updates an existing review with analysis results or fails with error messages
   */
  static async updateReviewStatus(reviewId, status, result = null, errorMessage = null) {
    const updatePayload = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (result) {
      updatePayload.report_json = result;
    }
    if (errorMessage) {
      updatePayload.error = errorMessage;
    }

    const { error } = await supabaseAdmin
      .from('reviews')
      .update(updatePayload)
      .eq('id', reviewId);

    if (error) {
      throw new DatabasePersistenceError(`Failed to update review status to ${status}`, error);
    }
  }

  /**
   * Fetches all reviews for a specific user and maps repositories relationship in-memory
   */
  static async getUserReviews(userId) {
    // 1. Fetch reviews
    const { data: reviews, error: reviewsErr } = await supabaseAdmin
      .from('reviews')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (reviewsErr) {
      throw new DatabasePersistenceError(`Failed to fetch user reviews: ${reviewsErr.message}`, reviewsErr);
    }

    // 2. Fetch user repositories to reconstruct join in-memory
    const { data: repos, error: reposErr } = await supabaseAdmin
      .from('repositories')
      .select('owner, name, full_name')
      .eq('user_id', userId);

    const reposMap = {};
    if (!reposErr && repos) {
      for (const repo of repos) {
        const repoUrlKey = `https://github.com/${repo.owner}/${repo.name}`.toLowerCase();
        reposMap[repoUrlKey] = repo;
        reposMap[repo.full_name.toLowerCase()] = repo;
      }
    }

    // 3. Reconstruct properties for backwards compatibility
    return (reviews || []).map(review => {
      const cleanUrl = review.repo_url ? review.repo_url.toLowerCase().trim() : '';
      const mappedRepo = reposMap[cleanUrl] || null;

      return {
        id: review.id,
        user_id: review.user_id,
        user_email: review.user_email,
        repo_url: review.repo_url,
        pr_number: review.pr_number,
        pr_title: review.report_json?.pr_metadata?.pr_title || `PR #${review.pr_number}`,
        pr_url: review.report_json?.pr_metadata?.pr_url || `${review.repo_url}/pull/${review.pr_number}`,
        pr_author: review.report_json?.pr_metadata?.pr_author || 'unknown',
        status: review.status,
        report_json: review.report_json,
        result: review.report_json,
        error: review.error,
        error_message: review.error,
        created_at: review.created_at,
        updated_at: review.updated_at,
        repositories: mappedRepo,
      };
    });
  }

  /**
   * Fetches summary statistics for a user's reviews
   */
  static async getUserStats(userId) {
    const { data: reviews, error } = await supabaseAdmin
      .from('reviews')
      .select('status, report_json')
      .eq('user_id', userId);

    if (error) {
      throw new DatabasePersistenceError(`Failed to fetch user stats: ${error.message}`, error);
    }

    const totalReviews = reviews.length;
    const queuedReviews = reviews.filter(r => r.status === 'pending').length;
    const runningReviews = reviews.filter(r => r.status === 'processing').length;
    const completedReviews = reviews.filter(r => r.status === 'completed').length;
    const failedReviews = reviews.filter(r => r.status === 'failed').length;

    // Count issues found
    let issuesFound = 0;
    for (const r of reviews) {
      if (r.report_json?.findings) {
        issuesFound += r.report_json.findings.length;
      }
    }

    return {
      totalReviews,
      queuedReviews,
      runningReviews,
      completedReviews,
      failedReviews,
      issuesFound,
    };
  }
}
