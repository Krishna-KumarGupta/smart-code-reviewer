import { getPullRequestMetadata, getPullRequestFiles, getPullRequestDiff } from '../github/client.js';

const EXCLUDED_PATTERNS = [
  /\.lock$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.png$/,
  /\.jpg$/,
  /\.jpeg$/,
  /\.gif$/,
  /\.svg$/,
  /\.ico$/,
  /\.pdf$/,
  /\.zip$/,
  /\.tar\.gz$/,
  /\.woff2?$/,
  /\.eot$/,
  /\.ttf$/,
];

/**
 * Retrieves pull request metadata and a review-safe file set.
 */
export class PRService {
  /**
   * Fetches full PR metadata, filters out non-code/unneeded file alterations, and retrieves full diff
   */
  static async getPRForReview(owner, repo, pullNumber, token = null) {
    const [metadata, rawFiles, diff] = await Promise.all([
      getPullRequestMetadata(owner, repo, pullNumber, token),
      getPullRequestFiles(owner, repo, pullNumber, token),
      getPullRequestDiff(owner, repo, pullNumber, token),
    ]);

    const filteredFiles = rawFiles
      .filter((file) => !EXCLUDED_PATTERNS.some((pattern) => pattern.test(file.filename)))
      .map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch,
      }));

    return {
      id: metadata.id,
      number: metadata.number,
      title: metadata.title,
      url: metadata.html_url,
      author: metadata.user?.login || 'unknown',
      baseBranch: metadata.base.ref,
      headBranch: metadata.head.ref,
      diff,
      files: filteredFiles,
    };
  }
}
