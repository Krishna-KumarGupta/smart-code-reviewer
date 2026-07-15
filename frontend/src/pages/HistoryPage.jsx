/**
 * HistoryPage — Review History
 *
 * Protected user page showing past AI code reviews from the database.
 * Lists reviews, displays their live status, and refreshes automatically.
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { RiHistoryLine, RiCodeSSlashLine, RiGithubLine } from 'react-icons/ri';
import reviewService from '../services/reviewService.js';

// ─── Review Item Skeleton ─────────────────────────────────────────────────────
const ReviewSkeleton = () => (
  <div className="glass-card p-5 animate-pulse">
    <div className="flex items-start gap-4">
      <div className="w-10 h-10 rounded-xl bg-surface-2 shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-surface-2 rounded w-3/4" />
        <div className="h-3 bg-surface-2 rounded w-1/2" />
        <div className="h-3 bg-surface-2 rounded w-1/4" />
      </div>
    </div>
  </div>
);

const HistoryPage = () => {
  const [reviews, setReviews] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchHistory = async (showLoader = true) => {
    if (showLoader) setIsLoading(true);
    try {
      const data = await reviewService.getUserReviews();
      setReviews(data || []);
    } catch (e) {
      console.error('[HistoryPage] Failed to fetch reviews:', e);
    } finally {
      if (showLoader) setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory(true);

    // Listen to review triggered events for auto refresh
    const handleRefresh = () => fetchHistory(false);
    window.addEventListener('reviewTriggered', handleRefresh);

    return () => {
      window.removeEventListener('reviewTriggered', handleRefresh);
    };
  }, []);

  // Dynamic Polling Effect: only poll when there are pending or processing reviews
  useEffect(() => {
    const hasActiveReviews = reviews.some(r => r.status === 'pending' || r.status === 'processing');
    if (!hasActiveReviews) return;

    const interval = setInterval(() => fetchHistory(false), 7000);
    return () => clearInterval(interval);
  }, [reviews]);

  return (
    <div className="min-h-full">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8"
        >
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <RiHistoryLine className="text-primary text-sm" />
            </div>
            <h1 className="text-2xl font-bold text-text-primary">Review History</h1>
          </div>
          <p className="text-text-muted text-sm ml-11">
            All AI-generated pull request reviews across your repositories.
          </p>
        </motion.div>

        {/* Filter Bar (placeholder) */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="glass-card p-4 mb-6 flex items-center gap-3 opacity-70"
        >
          <span className="text-sm text-text-muted">Filters:</span>
          {['All Repos', 'This Week', 'High Severity'].map((filter) => (
            <span
              key={filter}
              className="px-3 py-1 rounded-lg bg-surface-2 text-xs text-text-muted border border-border cursor-not-allowed"
            >
              {filter}
            </span>
          ))}
          <span className="ml-auto text-xs text-text-muted">Filtered by active repositories</span>
        </motion.div>

        {/* Review List or Loading */}
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => <ReviewSkeleton key={i} />)}
          </div>
        ) : reviews.length === 0 ? (
          /* Empty State */
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.4 }}
            className="glass-card py-20 px-8 text-center"
          >
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-surface-2 border border-border mb-6">
              <RiCodeSSlashLine className="text-4xl text-text-muted" />
            </div>
            <h3 className="text-xl font-semibold text-text-primary mb-3">
              No Reviews Yet
            </h3>
            <p className="text-text-muted text-sm max-w-sm mx-auto leading-relaxed mb-8">
              Once you connect your GitHub account and trigger a review on your repository,
              AI reviews will appear here automatically.
            </p>
            <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-surface-2 border border-border-light text-sm text-text-muted">
              <RiGithubLine className="text-base" />
              Trigger a review on any repo to start
            </div>
          </motion.div>
        ) : (
          <div className="space-y-4">
            {reviews.map((review) => {
              const repoLabel = review.repositories
                ? `${review.repositories.owner}/${review.repositories.name}`
                : 'Repository';
                
              const statusColors = {
                pending: 'bg-warning/10 text-warning border-warning/20',
                processing: 'bg-primary/10 text-primary border-primary/20',
                completed: 'bg-success/10 text-success border-success/20',
                failed: 'bg-red-500/10 text-red-500 border-red-500/20',
              };

              const statusLabels = {
                pending: '🟡 Queued',
                processing: '⚙️ AI Reviewing',
                completed: '✅ Completed',
                failed: '❌ Failed',
              };

              return (
                <motion.div
                  key={review.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="glass-card p-5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary text-xl shrink-0">
                        <RiCodeSSlashLine />
                      </div>
                      <div>
                        <h4 className="font-semibold text-text-primary">
                          {review.pr_title || `Review PR #${review.pr_number}`}
                        </h4>
                        <p className="text-xs text-text-muted mt-1 flex flex-wrap items-center gap-2">
                          <span className="font-medium text-text-primary">{repoLabel}</span>
                          <span>•</span>
                          <a
                            href={review.pr_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline text-primary"
                          >
                            PR #{review.pr_number}
                          </a>
                          <span>•</span>
                          <span>{new Date(review.created_at).toLocaleString()}</span>
                        </p>
                      </div>
                    </div>
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border shrink-0 ${statusColors[review.status] || 'bg-surface-2 text-text-muted border-border'}`}>
                      {statusLabels[review.status] || review.status}
                    </span>
                  </div>
                  {review.status === 'failed' && review.error_message && (
                    <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-500">
                      Error: {review.error_message}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default HistoryPage;
