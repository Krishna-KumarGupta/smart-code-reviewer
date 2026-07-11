/**
 * HistoryPage — Review History
 *
 * Protected user page showing past AI code reviews.
 * Currently displays empty state — will be populated when
 * GitHub App integration is implemented.
 */

import { motion } from 'framer-motion';
import { RiHistoryLine, RiCodeSSlashLine, RiGithubLine } from 'react-icons/ri';
import Card from '../components/ui/Card.jsx';

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
  // In the future, this will be fetched from /api/reviews
  const reviews = [];
  const isLoading = false;

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
          className="glass-card p-4 mb-6 flex items-center gap-3 opacity-50"
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
          <span className="ml-auto text-xs text-text-muted">Available after GitHub integration</span>
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
              Once you connect your GitHub account and install the SmartReview App
              on your repositories, AI reviews will appear here automatically.
            </p>
            <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-surface-2 border border-border-light text-sm text-text-muted">
              <RiGithubLine className="text-base" />
              GitHub integration coming soon
            </div>
          </motion.div>
        ) : null}

      </main>
    </div>
  );
};

export default HistoryPage;
