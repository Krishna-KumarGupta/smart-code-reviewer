import celery from 'celery-node';
import { PRService } from '../services/pr.service.js';
import { AIService } from '../services/ai.service.js';
import { PersistenceService } from '../services/persistence.service.js';
import { GitHubService } from '../services/github.service.js';
import { getValidAccessToken } from '../github/services/githubTokenService.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const celeryClient = celery.createClient(
  REDIS_URL,
  REDIS_URL
);

export const analyzePrTask = celeryClient.createTask('tasks.analyzePr');

/**
 * Executes the asynchronous pull-request review workflow.
 */
export async function analyzePrHandler(payload) {
  const { reviewId, owner, repo, pullNumber, userId, repositoryId } = payload;

  try {
    await PersistenceService.updateReviewStatus(reviewId, 'processing');

    const token = await getValidAccessToken(userId);
    const prDetails = await PRService.getPRForReview(owner, repo, parseInt(pullNumber, 10), token);

    const aiPayload = AIService.preparePayload(prDetails, `${owner}/${repo}`);

    const reviewResult = await AIService.analyzeDiff(aiPayload);

    const reviewBody = `### 🤖 Smart Code Review Report

**Decision:** ${reviewResult.decision === 'Approved' ? '✅ Approved' : '⚠️ Changes Requested'}

**Summary:**
${reviewResult.summary}

${
  reviewResult.findings && reviewResult.findings.length > 0
    ? `#### Findings:\n` +
      reviewResult.findings
        .map(
          (f) =>
            `- **[${f.category.toUpperCase()} | ${f.severity}]** \`${f.file_path}\` (Line ${f.line_number}): ${f.description}\n  *Suggested Fix:*\n  \`\`\`\n  ${f.suggested_fix}\n  \`\`\``
        )
        .join('\n\n')
    : 'No critical issues found.'
}
`;
    await GitHubService.postPullRequestReview(owner, repo, parseInt(pullNumber, 10), reviewBody, 'COMMENT', token);

    await PersistenceService.updateReviewStatus(reviewId, 'completed', reviewResult);
    return { success: true, reviewId };
  } catch (error) {
    console.error(`[Celery Task] Error processing Review ID ${reviewId}:`, error);
    await PersistenceService.updateReviewStatus(reviewId, 'failed', null, error.message || 'Processing failed');
    throw error;
  }
}
