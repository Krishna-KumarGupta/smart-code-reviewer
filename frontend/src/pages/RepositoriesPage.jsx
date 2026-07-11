/**
 * RepositoriesPage — GitHub Repositories
 *
 * Protected user page — placeholder for Phase 2.
 * Will display repositories connected via GitHub App installation.
 */

import { motion } from 'framer-motion';
import { RiGithubLine, RiAddLine } from 'react-icons/ri';
import EmptyState from '../components/ui/EmptyState.jsx';

const RepositoriesPage = () => {
  return (
    <div className="min-h-full">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Page Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex items-start justify-between mb-8"
        >
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <RiGithubLine className="text-primary text-sm" />
              </div>
              <h1 className="text-2xl font-bold text-text-primary">Repositories</h1>
            </div>
            <p className="text-text-muted text-sm ml-11">
              Manage GitHub repositories enabled for AI code review.
            </p>
          </div>

          {/* Add Repo Button — disabled until GitHub integration */}
          <button
            disabled
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/10 border border-primary/20 text-sm text-primary font-medium opacity-50 cursor-not-allowed"
          >
            <RiAddLine />
            Add Repository
          </button>
        </motion.div>

        {/* Empty State */}
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.15, duration: 0.4 }}
        >
          <EmptyState
            icon={<RiGithubLine />}
            title="No Repositories Connected"
            description="Connect your GitHub account and install the SmartReview GitHub App to start monitoring repositories for pull request reviews."
            action={
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface-2 border border-border text-xs text-text-muted">
                <span className="w-2 h-2 rounded-full bg-warning animate-pulse-slow" />
                GitHub App integration — Phase 2
              </div>
            }
          />
        </motion.div>

      </main>
    </div>
  );
};

export default RepositoriesPage;
