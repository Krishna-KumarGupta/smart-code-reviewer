/**
 * ReviewReportPage — AI Code Review Report
 *
 * Displays the full AI-generated analysis for a single pull request review.
 * Fetches the review by ID from /api/reviews/:id and renders:
 *   - Header: repo, PR number/title, status badge, timestamp
 *   - Summary cards: severity counts
 *   - AI review summary
 *   - Filterable findings list
 *   - Improvements / recommendations
 *   - Review metadata
 *
 * When result is null (AI pipeline not yet run or pending), shows a
 * graceful "Analysis pending" state instead of an error.
 */

import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RiArrowLeftLine,
  RiGithubLine,
  RiShieldCheckLine,
  RiAlertLine,
  RiErrorWarningLine,
  RiInformationLine,
  RiCodeSSlashLine,
  RiTimeLine,
  RiFileCodeLine,
  RiCheckLine,
  RiLoader4Line,
  RiExternalLinkLine,
  RiFilterLine,
  RiBugLine,
  RiFlashlightLine,
  RiSpeedLine,
  RiArrowUpLine,
} from 'react-icons/ri';
import reviewService from '../services/reviewService.js';

// ─── Severity config ──────────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  critical: {
    label: 'Critical',
    icon: RiErrorWarningLine,
    badge: 'bg-red-500/15 text-red-400 border border-red-500/20',
    dot:   'bg-red-500',
    card:  'border-red-500/30 bg-red-500/5',
    count: 'bg-red-500/10 text-red-400',
  },
  high: {
    label: 'High',
    icon: RiAlertLine,
    badge: 'bg-orange-500/15 text-orange-400 border border-orange-500/20',
    dot:   'bg-orange-500',
    card:  'border-orange-500/30 bg-orange-500/5',
    count: 'bg-orange-500/10 text-orange-400',
  },
  medium: {
    label: 'Medium',
    icon: RiAlertLine,
    badge: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20',
    dot:   'bg-yellow-500',
    card:  'border-yellow-500/30 bg-yellow-500/5',
    count: 'bg-yellow-500/10 text-yellow-400',
  },
  low: {
    label: 'Low',
    icon: RiInformationLine,
    badge: 'bg-blue-500/15 text-blue-400 border border-blue-500/20',
    dot:   'bg-blue-500',
    card:  'border-blue-500/30 bg-blue-500/5',
    count: 'bg-blue-500/10 text-blue-400',
  },
};

const CATEGORY_CONFIG = {
  security:     { label: 'Security',     icon: RiShieldCheckLine,  color: 'text-red-400'    },
  bug:          { label: 'Bug',          icon: RiBugLine,           color: 'text-orange-400' },
  'code-quality': { label: 'Code Quality', icon: RiCodeSSlashLine,   color: 'text-blue-400'   },
  dependency:   { label: 'Dependency',  icon: RiArrowUpLine,       color: 'text-yellow-400' },
  performance:  { label: 'Performance', icon: RiSpeedLine,         color: 'text-purple-400' },
};

const STATUS_CONFIG = {
  completed:  { label: 'Completed',  cls: 'bg-green-500/15  text-green-400  border border-green-500/20'  },
  processing: { label: 'Processing', cls: 'bg-blue-500/15   text-blue-400   border border-blue-500/20'   },
  pending:    { label: 'Pending',    cls: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20' },
  failed:     { label: 'Failed',     cls: 'bg-red-500/15    text-red-400    border border-red-500/20'    },
};

// ─── Filter options ───────────────────────────────────────────────────────────

const SEVERITY_FILTERS = ['all', 'critical', 'high', 'medium', 'low'];
const CATEGORY_FILTERS = ['security', 'bug', 'code-quality', 'dependency', 'performance'];

// ─── Sub-components ───────────────────────────────────────────────────────────

const SeverityCard = ({ label, count, config, isActive, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-2xl border p-4 text-left transition hover:scale-[1.02] ${
      isActive ? config.card + ' ring-1 ring-offset-0' : 'border-border bg-surface-1 hover:border-primary/30'
    }`}
  >
    <p className={`text-2xl font-bold ${isActive ? '' : 'text-text-primary'}`}>{count}</p>
    <p className="text-xs text-text-muted mt-1">{label}</p>
  </button>
);

const FindingCard = ({ finding, index }) => {
  const [expanded, setExpanded] = useState(false);
  const sev = SEVERITY_CONFIG[finding.severity?.toLowerCase()] || SEVERITY_CONFIG.low;
  const cat = CATEGORY_CONFIG[finding.category?.toLowerCase()] || CATEGORY_CONFIG['code-quality'];
  const SevIcon = sev.icon;
  const CatIcon = cat.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className={`rounded-2xl border p-5 transition ${sev.card}`}
    >
      {/* ── Finding header ── */}
      <div
        className="cursor-pointer"
        onClick={() => setExpanded((p) => !p)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setExpanded((p) => !p)}
      >
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${sev.badge}`}>
            <SevIcon className="text-xs" />
            {sev.label.toUpperCase()}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-surface-2 ${cat.color}`}>
            <CatIcon className="text-xs" />
            {cat.label.toUpperCase()}
          </span>
        </div>

        <h4 className="text-sm font-semibold text-text-primary leading-snug">{finding.title}</h4>

        {finding.file && (
          <div className="flex items-center gap-1.5 mt-1.5 text-xs text-text-muted">
            <RiFileCodeLine className="text-xs shrink-0" />
            <span className="font-mono">{finding.file}{finding.lineRange ? `:${finding.lineRange}` : ''}</span>
          </div>
        )}
      </div>

      {/* ── Expandable detail ── */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pt-4 space-y-3 border-t border-border/40 mt-3">
              {finding.explanation && (
                <div>
                  <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Explanation</p>
                  <p className="text-sm text-text-secondary leading-relaxed">{finding.explanation}</p>
                </div>
              )}
              {finding.suggestedFix && (
                <div>
                  <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Suggested Fix</p>
                  <p className="text-sm text-text-secondary leading-relaxed">{finding.suggestedFix}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Click to expand hint */}
      <p className="text-xs text-text-muted mt-2 opacity-60">
        {expanded ? '▲ Collapse' : '▼ Click to expand'}
      </p>
    </motion.div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

const ReviewReportPage = () => {
  const { reviewId }  = useParams();
  const navigate      = useNavigate();
  const [review,  setReview]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // Active filters
  const [severityFilter, setSeverityFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');

  // ── Fetch review ──────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const { review: data } = await reviewService.getReview(reviewId);
        setReview(data);
      } catch (err) {
        setError(err?.response?.data?.error || 'Failed to load review');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [reviewId]);

  // ── Derived data from result JSONB ────────────────────────────────────────
  const result      = review?.result || null;
  const findings    = result?.findings    || [];
  const improvements= result?.improvements || [];
  const metadata    = result?.metadata    || {};
  const summary     = result?.summary     || null;
  const repo        = review?.repositories;
  const statusCfg   = STATUS_CONFIG[review?.status] || STATUS_CONFIG.pending;

  // Severity counts
  const counts = useMemo(() => ({
    critical: findings.filter((f) => f.severity?.toLowerCase() === 'critical').length,
    high:     findings.filter((f) => f.severity?.toLowerCase() === 'high').length,
    medium:   findings.filter((f) => f.severity?.toLowerCase() === 'medium').length,
    low:      findings.filter((f) => f.severity?.toLowerCase() === 'low').length,
    total:    findings.length,
  }), [findings]);

  // Filtered findings (client-side, no API call)
  const filteredFindings = useMemo(() => {
    return findings.filter((f) => {
      const sevMatch = severityFilter === 'all' || f.severity?.toLowerCase() === severityFilter;
      const catMatch = categoryFilter === 'all' || f.category?.toLowerCase() === categoryFilter;
      return sevMatch && catMatch;
    });
  }, [findings, severityFilter, categoryFilter]);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-text-muted">
          <RiLoader4Line className="text-4xl animate-spin text-primary" />
          <p className="text-sm">Loading review…</p>
        </div>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (error || !review) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="glass-card p-10 text-center max-w-sm">
          <RiErrorWarningLine className="text-4xl text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-text-primary mb-2">Review not found</h3>
          <p className="text-sm text-text-muted mb-6">{error || 'The review could not be loaded.'}</p>
          <button
            onClick={() => navigate('/history')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:opacity-90 transition"
          >
            <RiArrowLeftLine /> Back to History
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* ── Back navigation ───────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
          className="flex items-center gap-4"
        >
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition"
          >
            <RiArrowLeftLine /> Back
          </button>
          <span className="text-border">|</span>
          <Link to="/history" className="text-sm text-text-muted hover:text-text-primary transition">
            Review History
          </Link>
          <span className="text-border">|</span>
          <Link to="/repos" className="text-sm text-text-muted hover:text-text-primary transition">
            Repositories
          </Link>
        </motion.div>

        {/* ── Page header ───────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="glass-card p-6"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              {/* Repository */}
              <div className="flex items-center gap-2 text-text-muted text-sm">
                <RiGithubLine className="text-base" />
                <span className="font-mono">{repo?.full_name || repo?.name || 'Unknown Repository'}</span>
              </div>

              {/* PR title */}
              <h1 className="text-xl font-bold text-text-primary leading-snug">
                PR #{review.pr_number}
                {review.pr_title ? ` · ${review.pr_title}` : ''}
              </h1>

              {/* Status + timestamp */}
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${statusCfg.cls}`}>
                  {review.status === 'completed' && <RiCheckLine className="text-xs" />}
                  {review.status === 'processing' && <RiLoader4Line className="text-xs animate-spin" />}
                  {statusCfg.label}
                </span>
                <span className="text-xs text-text-muted flex items-center gap-1">
                  <RiTimeLine className="text-xs" />
                  {new Date(review.created_at).toLocaleString()}
                </span>
              </div>
            </div>

            {/* PR link */}
            {review.pr_url && (
              <a
                href={review.pr_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm text-text-muted hover:text-text-primary hover:border-primary/40 transition shrink-0"
              >
                <RiGithubLine />
                View PR
                <RiExternalLinkLine className="text-xs" />
              </a>
            )}
          </div>
        </motion.div>

        {/* ── Pending / no result state ─────────────────────────────────────── */}
        {!result && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="glass-card py-16 px-8 text-center"
          >
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-surface-2 border border-border mb-5">
              {review.status === 'processing' ? (
                <RiLoader4Line className="text-3xl text-primary animate-spin" />
              ) : (
                <RiCodeSSlashLine className="text-3xl text-text-muted" />
              )}
            </div>
            <h3 className="text-lg font-semibold text-text-primary mb-2">
              {review.status === 'processing' ? 'Analysis in progress…' : 'Analysis pending'}
            </h3>
            <p className="text-text-muted text-sm max-w-sm mx-auto">
              {review.status === 'processing'
                ? 'The AI is currently reviewing this pull request. Check back in a moment.'
                : 'The AI review result will appear here once the analysis pipeline runs for this pull request.'}
            </p>
          </motion.div>
        )}

        {/* ── Full report — only when result is available ────────────────────── */}
        {result && (
          <>
            {/* ── Severity summary cards ──────────────────────────────────── */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {[
                  { key: 'critical', label: 'Critical Issues',   count: counts.critical, cfg: SEVERITY_CONFIG.critical },
                  { key: 'high',     label: 'High Severity',     count: counts.high,     cfg: SEVERITY_CONFIG.high     },
                  { key: 'medium',   label: 'Medium Severity',   count: counts.medium,   cfg: SEVERITY_CONFIG.medium   },
                  { key: 'low',      label: 'Low Severity',      count: counts.low,      cfg: SEVERITY_CONFIG.low      },
                  { key: 'all',      label: 'Total Findings',    count: counts.total,
                    cfg: { card: 'border-primary/30 bg-primary/5', badge: '', dot: 'bg-primary', count: 'bg-primary/10 text-primary' } },
                ].map(({ key, label, count, cfg }) => (
                  <SeverityCard
                    key={key}
                    label={label}
                    count={count}
                    config={cfg}
                    isActive={severityFilter === key}
                    onClick={() => setSeverityFilter(key === severityFilter ? 'all' : key)}
                  />
                ))}
              </div>
            </motion.div>

            {/* ── AI Summary ────────────────────────────────────────────────── */}
            {summary && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="glass-card p-6"
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                    <RiFlashlightLine className="text-primary text-sm" />
                  </div>
                  <h2 className="text-base font-semibold text-text-primary">AI Review Summary</h2>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed">{summary}</p>
              </motion.div>
            )}

            {/* ── Findings section ─────────────────────────────────────────── */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="space-y-4"
            >
              {/* Findings header + filters */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                    <RiFilterLine className="text-primary text-sm" />
                  </div>
                  <h2 className="text-base font-semibold text-text-primary">
                    Findings
                    <span className="ml-2 text-xs font-normal text-text-muted">
                      ({filteredFindings.length} of {counts.total})
                    </span>
                  </h2>
                </div>

                {/* Filter pills */}
                <div className="flex flex-wrap gap-1.5">
                  {/* Severity filters */}
                  {SEVERITY_FILTERS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setSeverityFilter(f)}
                      className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                        severityFilter === f
                          ? 'bg-primary text-white'
                          : 'bg-surface-2 text-text-muted hover:text-text-primary border border-border'
                      }`}
                    >
                      {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                  <span className="w-px bg-border mx-0.5" />
                  {/* Category filters */}
                  {CATEGORY_FILTERS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setCategoryFilter(categoryFilter === f ? 'all' : f)}
                      className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                        categoryFilter === f
                          ? 'bg-primary text-white'
                          : 'bg-surface-2 text-text-muted hover:text-text-primary border border-border'
                      }`}
                    >
                      {CATEGORY_CONFIG[f]?.label || f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Scrollable findings list */}
              {filteredFindings.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-surface-1 px-6 py-10 text-center text-sm text-text-muted">
                  No findings match the selected filters.
                </div>
              ) : (
                <div className="scrollbar-styled space-y-3" style={{ maxHeight: '520px', overflowY: 'auto' }}>
                  {filteredFindings.map((finding, i) => (
                    <FindingCard key={i} finding={finding} index={i} />
                  ))}
                </div>
              )}
            </motion.div>

            {/* ── Improvements / Recommendations ───────────────────────────── */}
            {improvements.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
                className="glass-card p-6"
              >
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-7 h-7 rounded-lg bg-green-500/10 flex items-center justify-center">
                    <RiCheckLine className="text-green-500 text-sm" />
                  </div>
                  <h2 className="text-base font-semibold text-text-primary">Recommendations</h2>
                </div>
                <ul className="space-y-2">
                  {improvements.map((item, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm text-text-secondary">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </motion.div>
            )}

            {/* ── Review metadata ───────────────────────────────────────────── */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="glass-card p-6"
            >
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                  <RiCodeSSlashLine className="text-primary text-sm" />
                </div>
                <h2 className="text-base font-semibold text-text-primary">Review Metadata</h2>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Repository',      value: repo?.name || '—' },
                  { label: 'Pull Request',     value: `#${review.pr_number}` },
                  { label: 'Branch',           value: repo?.default_branch || '—' },
                  { label: 'Language',         value: metadata.language || '—' },
                  { label: 'Files Analyzed',   value: metadata.filesAnalyzed != null ? metadata.filesAnalyzed : '—' },
                  { label: 'Lines Analyzed',   value: metadata.linesAnalyzed != null ? metadata.linesAnalyzed.toLocaleString() : '—' },
                  { label: 'Review Duration',  value: metadata.durationMs != null ? `${(metadata.durationMs / 1000).toFixed(1)}s` : '—' },
                  { label: 'Reviewed At',      value: new Date(review.created_at).toLocaleDateString() },
                ].map(({ label, value }) => (
                  <div key={label} className="space-y-0.5">
                    <p className="text-xs text-text-muted">{label}</p>
                    <p className="text-sm font-medium text-text-primary">{value}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </main>
    </div>
  );
};

export default ReviewReportPage;
