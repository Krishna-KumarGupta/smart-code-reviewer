import express  from 'express';
import verifyJWT from '../middleware/verifyJWT.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { REVIEW_AGENT_URL, makeReviewAgentHeaders } from '../utils/reviewAgent.js';

const router = express.Router();

function parseOwnerRepo(repoUrl) {
  const parts = repoUrl.replace(/\/$/, '').replace(/\.git$/, '').split('/');
  const name = parts[parts.length - 1] || 'Unknown';
  const owner = parts[parts.length - 2] || 'Unknown';
  return { name, owner, full_name: `${owner}/${name}` };
}

// ─── POST /api/reviews — Trigger a review ────────────────────────────────────
router.post('/', verifyJWT, async (req, res, next) => {
  try {
    const { repo_url, pr_number } = req.body;

    if (!repo_url || !pr_number) {
      return sendError(res, 'Missing required fields: repo_url and pr_number', 400);
    }

    console.log(
      `[reviews] Proxy trigger review for ${repo_url} PR#${pr_number} by user ${req.user.id}`
    );

    const agentResponse = await fetch(`${REVIEW_AGENT_URL}/reviews`, {
      method:  'POST',
      headers: makeReviewAgentHeaders(req.user, req.userRole || null),
      body:    JSON.stringify({ repo_url, pr_number }),
    });

    if (!agentResponse.ok) {
      const errorData = await agentResponse.json().catch(() => ({}));
      console.error('[reviews] review-agent responded with error:', errorData);
      return sendError(
        res,
        errorData.detail?.error || 'review-agent returned an error',
        agentResponse.status,
      );
    }

    const data = await agentResponse.json();
    return sendSuccess(res, data, 202);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/reviews — List user's reviews ─────────────────────────────────
router.get('/', verifyJWT, async (req, res, next) => {
  try {
    const params = new URLSearchParams();
    if (req.query.repo) params.set('repo', req.query.repo);

    const agentResponse = await fetch(
      `${REVIEW_AGENT_URL}/reviews?${params.toString()}`,
      {
        method:  'GET',
        headers: makeReviewAgentHeaders(req.user, req.userRole || null),
      }
    );

    if (!agentResponse.ok) {
      const errorData = await agentResponse.json().catch(() => ({}));
      return sendError(
        res,
        errorData.detail?.error || 'review-agent returned an error',
        agentResponse.status,
      );
    }

    const data = await agentResponse.json(); // Array of ReviewListItem

    // Map each item to the structure expected by the frontend
    const reviews = data.map((item) => {
      const { name, owner, full_name } = parseOwnerRepo(item.repo_url);
      return {
        id: item.review_id,
        pr_number: item.pr_number,
        pr_title: `PR #${item.pr_number}`,
        pr_url: `${item.repo_url.replace(/\/$/, '')}/pull/${item.pr_number}`,
        status: item.status,
        score: item.score,
        finding_count: item.finding_count,
        created_at: item.created_at,
        repositories: {
          name,
          owner,
          full_name,
        },
      };
    });

    return sendSuccess(res, { reviews });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/reviews/:reviewId — Fetch full report ─────────────────────────
router.get('/:reviewId', verifyJWT, async (req, res, next) => {
  try {
    const { reviewId } = req.params;

    const agentResponse = await fetch(
      `${REVIEW_AGENT_URL}/reviews/${encodeURIComponent(reviewId)}`,
      {
        method:  'GET',
        headers: makeReviewAgentHeaders(req.user, req.userRole || null),
      }
    );

    if (!agentResponse.ok) {
      const errorData = await agentResponse.json().catch(() => ({}));
      return sendError(
        res,
        errorData.detail?.error || 'review-agent returned an error',
        agentResponse.status,
      );
    }

    const data = await agentResponse.json(); // ReviewStatusResponse
    const { name, owner, full_name } = parseOwnerRepo(data.repo_url);

    // Transform to the structure expected by the frontend
    const review = {
      id: data.review_id,
      pr_number: data.pr_number,
      pr_title: `PR #${data.pr_number}`,
      pr_url: `${data.repo_url.replace(/\/$/, '')}/pull/${data.pr_number}`,
      status: data.status,
      created_at: data.created_at,
      repositories: {
        name,
        owner,
        full_name,
        default_branch: 'main',
      },
      result: data.report ? {
        score: data.report.score,
        summary: data.report.review, // Map 'review' prose to 'summary'
        improvements: data.report.improvements,
        bugs: data.report.bugs,
        metadata: {
          language: 'JavaScript', // fallback stack info
          head_sha: null,
        },
      } : null,
      error: data.error,
    };

    return sendSuccess(res, { review });
  } catch (err) {
    next(err);
  }
});

export default router;
