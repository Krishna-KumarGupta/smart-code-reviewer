/**
 * Review Controller
 *
 * Handles fetching review records from the Supabase `reviews` table.
 * The AI review pipeline (Phase 3) populates the `result` JSONB field.
 * These endpoints read that data for display — they do NOT trigger AI analysis.
 *
 * Endpoints:
 *   GET /api/reviews         — list all reviews for the authenticated user
 *   GET /api/reviews/:id     — get a single review with full result detail
 */

import { supabaseAdmin } from '../config/supabase.js';

// ─── GET /api/reviews ─────────────────────────────────────────────────────────

/**
 * List all reviews for the current user, joined with repository name.
 * Returns newest-first. Excludes the full `result` blob for performance.
 */
export const listReviews = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { data, error } = await supabaseAdmin
      .from('reviews')
      .select('id, pr_number, status, created_at, updated_at, repo_url')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[reviewController] listReviews DB error:', error.message);
      return res.status(500).json({ success: false, error: 'Failed to fetch reviews' });
    }

    // Map repositories in-memory
    const { data: repos } = await supabaseAdmin
      .from('repositories')
      .select('id, name, full_name, owner')
      .eq('user_id', userId);

    const reposMap = {};
    if (repos) {
      repos.forEach(r => {
        if (r.full_name) {
          reposMap[r.full_name.toLowerCase()] = r;
        }
      });
    }

    const reviewsWithRepos = (data || []).map(r => {
      let matchedRepo = null;
      if (r.repo_url) {
        const parts = r.repo_url.replace(/\/$/, '').split('/');
        if (parts.length >= 2) {
          const fullName = `${parts[parts.length - 2]}/${parts[parts.length - 1]}`.toLowerCase();
          matchedRepo = reposMap[fullName];
        }
      }
      return {
        ...r,
        pr_url: r.repo_url && r.pr_number ? `${r.repo_url}/pull/${r.pr_number}` : null,
        repositories: matchedRepo
      };
    });

    return res.status(200).json({ success: true, data: { reviews: reviewsWithRepos } });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/reviews/:id ──────────────────────────────────────────────────────

/**
 * Get a single review by ID, including the full AI `result` JSONB.
 * Only the review's owner can access it.
 */
export const getReview = async (req, res, next) => {
  try {
    const userId   = req.user?.id;
    const reviewId = req.params.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { data, error } = await supabaseAdmin
      .from('reviews')
      .select('id, pr_number, status, report_json, created_at, updated_at, repo_url')
      .eq('id', reviewId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('[reviewController] getReview DB error:', error.message);
      return res.status(500).json({ success: false, error: 'Failed to fetch review' });
    }

    if (!data) {
      return res.status(404).json({ success: false, error: 'Review not found' });
    }

    // Query matched repository
    let matchedRepo = null;
    if (data.repo_url) {
      const parts = data.repo_url.replace(/\/$/, '').split('/');
      if (parts.length >= 2) {
        const fullName = `${parts[parts.length - 2]}/${parts[parts.length - 1]}`.toLowerCase();
        const { data: repos } = await supabaseAdmin
          .from('repositories')
          .select('id, name, full_name, owner, default_branch')
          .eq('user_id', userId);
        
        if (repos) {
          matchedRepo = repos.find(r => r.full_name && r.full_name.toLowerCase() === fullName) || null;
        }
      }
    }

    const reviewData = {
      ...data,
      pr_url: data.repo_url && data.pr_number ? `${data.repo_url}/pull/${data.pr_number}` : null,
      repositories: matchedRepo
    };

    return res.status(200).json({ success: true, data: reviewData });
  } catch (err) {
    next(err);
  }
};
