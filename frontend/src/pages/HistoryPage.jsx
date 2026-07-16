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
  running:    { label: 'Running',    cls: 'bg-blue-500/15   text-blue-400',   icon: RiLoader4Line      },
  processing: { label: 'Processing', cls: 'bg-blue-500/15   text-blue-400',   icon: RiLoader4Line      },
  queued:     { label: 'Queued',     cls: 'bg-yellow-500/15 text-yellow-400', icon: RiTimeLine         },
  pending:    { label: 'Pending',    cls: 'bg-yellow-500/15 text-yellow-400', icon: RiTimeLine         },
  failed:     { label: 'Failed',     cls: 'bg-red-500/15    text-red-400',    icon: RiErrorWarningLine },
};

// ─── Relative time helper ──────────────────────────────────────────────────────
function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

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

  // Compute status flag for active loading spinner
  const isActive = ['running', 'processing', 'queued', 'pending'].includes(review.status);

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
            <span className="text-xs text-text-muted font-mono flex items-center gap-1">
              <RiGithubLine className="text-xs" />
              {repo?.full_name || repo?.name || 'Unknown Repo'}
            </span>
            {/* Status badge */}
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusCfg.cls}`}>
              <StatusIcon className={`text-xs ${isActive ? 'animate-spin' : ''}`} />
              {statusCfg.label}
            </span>
          </div>

          {/* PR title */}
          <p className="text-sm font-semibold text-text-primary truncate">
            PR #{review.pr_number}{review.pr_title ? ` · ${review.pr_title}` : ''}
          </p>

          {/* Metadata footer */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-text-muted">
            <span>{relativeTime(review.created_at)}</span>
            {review.status === 'completed' && review.score !== undefined && review.score !== null && (
              <span className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${
                  review.score >= 80 ? 'bg-green-500' : (review.score >= 50 ? 'bg-amber-500' : 'bg-red-500')
                }`} />
                Score: <strong className="text-text-secondary">{review.score}</strong>/100
              </span>
            )}
            {review.status === 'completed' && review.finding_count !== undefined && review.finding_count !== null && (
              <span className="text-text-secondary">
                Findings: <strong>{review.finding_count}</strong>
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {/* AI Report button */}
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
  const [reviews,   setReviews]   = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error,     setError]     = useState(null);

  const [selectedRepo, setSelectedRepo] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');

  const fetchReviews = async (showSkeleton = false) => {
    try {
      if (showSkeleton) setIsLoading(true);
      const { reviews: data } = await reviewService.listReviews();
      setReviews(data || []);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load reviews');
    } finally {
      if (showSkeleton) setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReviews(true);
  }, []);

  // Live polling logic for pending/running states
  useEffect(() => {
    const hasInProgress = reviews.some(r =>
      ['running', 'processing', 'queued', 'pending'].includes(r.status)
    );
    if (!hasInProgress) return;

    const interval = setInterval(async () => {
      await fetchReviews(false);
    }, 3000);

    return () => clearInterval(interval);
  }, [reviews]);

  // Compute unique repo names for filtering
  const repos = Array.from(
    new Set(reviews.map(r => r.repositories?.full_name).filter(Boolean))
  );

  // Filter reviews
  const filteredReviews = reviews.filter(r => {
    const matchesRepo = selectedRepo === 'all' || r.repositories?.full_name === selectedRepo;
    let matchesStatus = selectedStatus === 'all' || r.status === selectedStatus;
    if (selectedStatus === 'processing') {
      matchesStatus = ['running', 'processing', 'queued', 'pending'].includes(r.status);
    }
    return matchesRepo && matchesStatus;
  });

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

        {/* Filter Bar */}
        {!isLoading && !error && reviews.length > 0 && (
          <div className="flex flex-wrap gap-4 mb-6 bg-surface-1/30 p-4 rounded-2xl border border-border/30">
            <div className="flex flex-col gap-1.5 min-w-[220px]">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Filter by Repository</label>
              <select
                value={selectedRepo}
                onChange={(e) => setSelectedRepo(e.target.value)}
                className="bg-surface-2 border border-border/40 text-text-primary text-sm rounded-xl px-3 py-2 outline-none focus:border-primary/50 transition-colors"
              >
                <option value="all">All Repositories</option>
                {repos.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5 min-w-[160px]">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Filter by Status</label>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="bg-surface-2 border border-border/40 text-text-primary text-sm rounded-xl px-3 py-2 outline-none focus:border-primary/50 transition-colors"
              >
                <option value="all">All Statuses</option>
                <option value="completed">Completed</option>
                <option value="processing">Processing / In Progress</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>
        )}

        {/* Content */}
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
              Once you trigger a review or a pull request is analyzed, the history details will appear here automatically.
            </p>
          </motion.div>
        ) : filteredReviews.length === 0 ? (
          /* Filtered Empty State */
          <div className="glass-card py-14 px-8 text-center">
            <RiCodeSSlashLine className="text-3xl text-text-muted mx-auto mb-3" />
            <h4 className="text-md font-semibold text-text-primary mb-1">No Matching Reviews</h4>
            <p className="text-text-muted text-sm max-w-xs mx-auto">
              Try adjusting your repo or status filters to see other records.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredReviews.map((review, i) => (
              <ReviewRow key={review.id} review={review} index={i} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default HistoryPage;
