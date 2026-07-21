/**
 * HistoryPage — Review History
 *
 * Protected user page showing past AI code reviews.
 * Fetches reviews from /api/reviews and links each to its full ReviewReportPage.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  RiHistoryLine,
  RiCodeSSlashLine,
  RiGithubLine,
  RiArrowRightLine,
  RiLoader4Line,
  RiCheckLine,
  RiTimeLine,
  RiErrorWarningLine,
  RiSparklingLine,
} from 'react-icons/ri';
import reviewService from '../services/reviewService.js';

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  completed:  { label: 'Completed',  cls: 'bg-green-500/15  text-green-400',  icon: RiCheckLine        },
  processing: { label: 'Processing', cls: 'bg-blue-500/15   text-blue-400',   icon: RiLoader4Line      },
  pending:    { label: 'Pending',    cls: 'bg-yellow-500/15 text-yellow-400', icon: RiTimeLine         },
  failed:     { label: 'Failed',     cls: 'bg-red-500/15    text-red-400',    icon: RiErrorWarningLine },
};

// ─── Skeleton ────────────────────────────────────────────────────────────────
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

// ─── Review Row ───────────────────────────────────────────────────────────────
const ReviewRow = ({ review, index }) => {
  const statusCfg  = STATUS_CONFIG[review.status] || STATUS_CONFIG.pending;
  const StatusIcon = statusCfg.icon;
  const repo       = review.repositories;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.35 }}
    >
      <div className="glass-card p-5 flex items-start gap-4 hover:border-primary/40 transition-colors group">
        {/* Icon */}
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <RiCodeSSlashLine className="text-primary text-base" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            {/* Repo name */}
            <span className="text-xs text-text-muted font-mono flex items-center gap-1 break-all">
              <RiGithubLine className="text-xs" />
              {repo?.full_name || repo?.name || 'Unknown Repo'}
            </span>
            {/* Status badge */}
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusCfg.cls}`}>
              <StatusIcon className={`text-xs ${review.status === 'processing' ? 'animate-spin' : ''}`} />
              {statusCfg.label}
            </span>
          </div>

          <p className="text-sm font-semibold text-text-primary truncate">
            PR #{review.pr_number}
            {review.pr_title && 
             review.pr_title !== `PR #${review.pr_number}` && 
             review.pr_title !== `${review.pr_number}` 
              ? ` · ${review.pr_title}` 
              : ''}
          </p>

          {/* Timestamp */}
          <p className="text-xs text-text-muted mt-0.5">
            {new Date(review.created_at).toLocaleString()}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {/* AI Report button — every review (page handles all statuses) */}
          <Link
            id={`view-ai-report-${review.id}`}
            to={`/history/report?reviewId=${review.id}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/10 text-primary border border-primary/20 text-xs font-semibold hover:bg-primary hover:text-white transition-all duration-200 whitespace-nowrap"
          >
            <RiSparklingLine className="text-xs" />
            AI Report
          </Link>
          {/* Arrow */}
          <Link
            to={`/history/report?reviewId=${review.id}`}
            className="text-text-muted group-hover:text-primary transition-colors"
            tabIndex={-1}
            aria-hidden="true"
          >
            <RiArrowRightLine />
          </Link>
        </div>
      </div>
    </motion.div>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────
const HistoryPage = () => {
  const [reviews, setReviews] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchHistory = async (showLoader = true) => {
    if (showLoader) setIsLoading(true);
    try {
      const data = await reviewService.getUserReviews();
      setReviews(data || []);
      setError(null);
    } catch (e) {
      console.error('[HistoryPage] Failed to fetch reviews:', e);
      setError(e.response?.data?.error || e.message || 'Failed to load reviews');
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
        ) : error ? (
          <div className="glass-card py-10 px-8 text-center">
            <RiErrorWarningLine className="text-3xl text-red-400 mx-auto mb-3" />
            <p className="text-sm text-text-muted">{error}</p>
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
            <h3 className="text-xl font-semibold text-text-primary mb-3">No Reviews Yet</h3>
            <p className="text-text-muted text-sm max-w-sm mx-auto leading-relaxed mb-8">
              Once you connect your GitHub account and enable code review on a repository,
              AI reviews will appear here automatically when pull requests are opened.
            </p>
            <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-surface-2 border border-border-light text-sm text-text-muted">
              <RiGithubLine className="text-base" />
              Trigger a review on any repo to start
            </div>
          </motion.div>
        ) : (
          <div className="space-y-4">
            {reviews.map((review, index) => (
              <ReviewRow key={review.id} review={review} index={index} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default HistoryPage;
