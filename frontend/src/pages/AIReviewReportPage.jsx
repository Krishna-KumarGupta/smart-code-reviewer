/**
 * AIReviewReportPage — Two-panel AI Code Review Detail
 *
 * Route:  /history/report?reviewId=<uuid>
 *
 * Desktop (≥768px): sidebar (240px sticky) + main content panel
 * Mobile (<768px):  single column stack
 *
 * Spec compliance:
 *  - Score card with tier colouring (green/amber/red)
 *  - Severity breakdown — only non-zero rows shown
 *  - Details: relative time, language, GitHub PR link
 *  - Improvements checklist (omit if empty)
 *  - Full review narrative, never truncated
 *  - Findings: sorted Critical→High→Medium→Low, filtered by source tab
 *  - First 5 shown, "Show N more" reveal (client-side only)
 *  - Null line_start → "— no direct line" (never 0 or blank)
 *  - Circular deps rendered as chain
 *  - Polling every 4s for queued/running; stops on completed/failed
 *  - Failed state: full monospace error + Retry button
 */

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate, Link, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RiArrowLeftLine,
  RiGithubLine,
  RiCheckLine,
  RiLoader4Line,
  RiErrorWarningLine,
  RiTimeLine,
  RiShieldCheckLine,
  RiCodeSSlashLine,
  RiExternalLinkLine,
  RiFlashlightLine,
  RiFilterLine,
  RiRefreshLine,
  RiArrowDownLine,
} from 'react-icons/ri';
import reviewService from '../services/reviewService.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

const SEVERITY_CFG = {
  critical: {
    label: 'Critical',
    badge: 'bg-red-500/15 text-red-400 border border-red-500/25',
    bar:   'bg-red-500',
    row:   'border-red-500/30 bg-red-500/5',
  },
  high: {
    label: 'High',
    badge: 'bg-orange-500/15 text-orange-400 border border-orange-500/25',
    bar:   'bg-orange-500',
    row:   'border-orange-500/30 bg-orange-500/5',
  },
  medium: {
    label: 'Medium',
    badge: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/25',
    bar:   'bg-yellow-500',
    row:   'border-yellow-500/30 bg-yellow-500/5',
  },
  low: {
    label: 'Low',
    badge: 'bg-blue-500/15 text-blue-400 border border-blue-500/25',
    bar:   'bg-blue-500',
    row:   'border-blue-500/30 bg-blue-500/5',
  },
};

const STATUS_CFG = {
  completed:  { label: 'Completed',  cls: 'bg-green-500/15  text-green-400  border border-green-500/25'  },
  processing: { label: 'Processing', cls: 'bg-blue-500/15   text-blue-400   border border-blue-500/25'   },
  pending:    { label: 'Pending',    cls: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/25' },
  queued:     { label: 'Queued',     cls: 'bg-zinc-500/15   text-zinc-400   border border-zinc-500/25'   },
  running:    { label: 'Running',    cls: 'bg-blue-500/15   text-blue-400   border border-blue-500/25'   },
  failed:     { label: 'Failed',     cls: 'bg-red-500/15    text-red-400    border border-red-500/25'    },
};

function scoreTier(score) {
  if (score == null) return null;
  if (score >= 80) return { color: 'text-green-400', bg: 'bg-green-500/10', ring: 'stroke-green-500', label: 'Looking good'         };
  if (score >= 50) return { color: 'text-amber-400',  bg: 'bg-amber-500/10',  ring: 'stroke-amber-500', label: 'Needs attention'       };
  return              { color: 'text-red-400',   bg: 'bg-red-500/10',   ring: 'stroke-red-500',   label: 'Critical issues found' };
}

const POLL_INTERVAL = 4000;
const PAGE_SIZE     = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function normaliseSev(s) {
  return (s || 'low').toLowerCase();
}

function formatLineInfo(bug) {
  const file  = bug.file || bug.filename || null;
  const start = bug.line_start ?? bug.lineStart ?? null;
  const end   = bug.line_end   ?? bug.lineEnd   ?? null;
  if (!file) return null;
  if (!start || start === 0) return `${file} — no direct line`;
  if (end && end !== start)  return `${file}:${start}-${end}`;
  return `${file}:${start}`;
}

function buildFileLink(repoUrl, headSha, bug) {
  const file  = bug.file || bug.filename || null;
  const start = bug.line_start ?? bug.lineStart ?? null;
  if (!file || !repoUrl || !headSha) return null;
  const lineFragment = (start && start !== 0) ? `#L${start}` : '';
  return `${repoUrl.replace(/\/$/, '')}/blob/${headSha}/${file}${lineFragment}`;
}

// ─── Sub-components (defined outside the page so they aren't recreated) ───────

const ScoreRing = ({ score, tier }) => {
  const r    = 44;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, score ?? 0)) / 100) * circ;
  return (
    <div className={`relative flex items-center justify-center w-28 h-28 rounded-full ${tier.bg} mx-auto`}>
      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
        <circle
          cx="50" cy="50" r={r}
          fill="none"
          className={tier.ring}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: 'stroke-dasharray 0.8s ease' }}
        />
      </svg>
      <div className="relative text-center">
        <p className={`text-2xl font-bold leading-none ${tier.color}`}>{score}</p>
        <p className="text-xs text-text-muted mt-0.5">/ 100</p>
      </div>
    </div>
  );
};

const SkeletonBlock = ({ h = 'h-4', w = 'w-full', className = '' }) => (
  <div className={`${h} ${w} rounded bg-surface-2 animate-pulse ${className}`} />
);

const SeverityBar = ({ label, count, total, cfg }) => {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-muted">{label}</span>
        <span className={`font-semibold ${cfg.badge.split(' ')[1]}`}>{count}</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
        <div className={`h-full rounded-full ${cfg.bar} transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

const FindingCard = ({ bug, index, repoUrl, headSha }) => {
  const [fixOpen, setFixOpen] = useState(false);
  const sev       = normaliseSev(bug.severity);
  const cfg       = SEVERITY_CFG[sev] || SEVERITY_CFG.low;
  const source    = bug.source || bug.type || '—';
  const lineInfo  = formatLineInfo(bug);
  const fileLink  = buildFileLink(repoUrl, headSha, bug);
  const desc      = bug.description || bug.explanation || bug.message || '';
  const fix       = bug.fix || bug.suggestedFix || bug.suggested_fix || '';
  const fixLong   = fix.length > 200;
  const isCirc    = source === 'circular_dependency';
  const cyclePath = bug.cycle_path || bug.cyclePath || null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className={`rounded-2xl border p-4 space-y-3 ${cfg.row}`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${cfg.badge}`}>
          {cfg.label}
        </span>
        {source !== '—' && (
          <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-surface-2 text-text-muted border border-border">
            {source.replace(/_/g, ' ')}
          </span>
        )}
        {lineInfo && (
          <span className="ml-auto text-xs text-text-muted font-mono">
            {fileLink ? (
              <a href={fileLink} target="_blank" rel="noopener noreferrer"
                className="hover:text-primary transition-colors inline-flex items-center gap-1">
                {lineInfo} <RiExternalLinkLine className="text-[10px]" />
              </a>
            ) : lineInfo}
          </span>
        )}
      </div>

      {/* Description */}
      {desc && <p className="text-sm text-text-secondary leading-relaxed">{desc}</p>}

      {/* Circular dependency chain */}
      {isCirc && cyclePath && Array.isArray(cyclePath) && cyclePath.length > 0 && (
        <div className="bg-surface-2 rounded-xl p-3 space-y-0.5">
          {cyclePath.map((step, i) => (
            <div key={i}>
              <span className="text-xs font-mono text-text-primary">{step}</span>
              {i < cyclePath.length - 1 && (
                <div className="pl-3 my-0.5">
                  <RiArrowDownLine className="text-text-muted text-xs" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Suggested fix */}
      {fix && (
        <div>
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Suggested Fix</p>
          {fixLong && !fixOpen ? (
            <button
              onClick={() => setFixOpen(true)}
              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
            >
              <RiArrowDownLine className="text-[10px]" /> Show fix
            </button>
          ) : (
            <p className="text-sm text-text-secondary leading-relaxed">{fix}</p>
          )}
        </div>
      )}
    </motion.div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

const AIReviewReportPage = () => {
  const { reviewId: routeReviewId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();
  const reviewId       = routeReviewId || searchParams.get('reviewId');

  const [review,   setReview]   = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [srcFilter, setSrcFilter] = useState('all');
  const [shown,    setShown]    = useState(PAGE_SIZE);

  const intervalRef = useRef(null);

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetchReview = useCallback(async () => {
    if (!reviewId) return;
    try {
      const response = await reviewService.getReview(reviewId);
      const review = response.data;
      setReview(review);
      setError(null);
      if (review.status === 'completed' || review.status === 'failed') {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load review');
    } finally {
      setLoading(false);
    }
  }, [reviewId]);

  useEffect(() => {
    if (!reviewId) { setLoading(false); return; }
    fetchReview();
  }, [fetchReview, reviewId]);

  // Start/stop polling
  useEffect(() => {
    if (!review) return;
    const active = ['queued', 'running', 'pending', 'processing'].includes(review.status);
    if (active && !intervalRef.current) {
      intervalRef.current = setInterval(fetchReview, POLL_INTERVAL);
    }
    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
  }, [review?.status, fetchReview]);

  // Cleanup on unmount
  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  // Reset page when filter changes
  useEffect(() => { setShown(PAGE_SIZE); }, [srcFilter]);

  // ── Derived data ──────────────────────────────────────────────────────────
  const repo         = review?.repositories;
  const repoUrl      = review?.repo_url || (repo ? `https://github.com/${repo.full_name}` : null);

  const isReportNull = review?.report_json === null || review?.report_json === undefined;

  // Parsing and normalizing report_json defensively
  let report = review?.report_json;

  if (report === null || report === undefined) {
    report = {};
  }

  if (typeof report === "string") {
    try {
      report = JSON.parse(report);
    } catch {
      report = {};
    }
  }

  const bugs = Array.isArray(report.bugs) ? report.bugs : [];
  const improvements = Array.isArray(report.improvements) ? report.improvements : [];
  const score = report.score ?? null;
  const narrative = report.review || report.summary || "";

  // Temporary development logging
  console.log("[AI Report] reviewId:", reviewId);
  console.log("[AI Report] API response:", review);
  console.log("[AI Report] report_json:", review?.report_json);

  const result       = report; // to keep result fallback variables working if referenced elsewhere
  const allBugs      = bugs;
  const summary      = narrative;
  const metadata     = report.metadata || {};
  const headSha      = metadata.head_sha || metadata.headSha || report.head_sha || report.headSha || null;
  const tier         = scoreTier(score);

  const sevCounts = useMemo(() => {
    const c = { critical: 0, high: 0, medium: 0, low: 0 };
    allBugs.forEach((b) => { const s = normaliseSev(b.severity); if (s in c) c[s]++; });
    return c;
  }, [allBugs]);

  const totalBugs = allBugs.length;

  const sourceTabs = useMemo(() => {
    const seen = new Set();
    allBugs.forEach((b) => { if (b.source) seen.add(b.source); });
    return ['all', ...Array.from(seen)];
  }, [allBugs]);

  const filteredBugs = useMemo(() => {
    const f = srcFilter === 'all' ? [...allBugs] : allBugs.filter((b) => b.source === srcFilter);
    return f.sort((a, b) =>
      SEVERITY_ORDER.indexOf(normaliseSev(a.severity)) - SEVERITY_ORDER.indexOf(normaliseSev(b.severity))
    );
  }, [allBugs, srcFilter]);

  const visibleBugs = filteredBugs.slice(0, shown);
  const remaining   = filteredBugs.length - shown;

  const status    = review?.status || 'pending';
  const statusCfg = STATUS_CFG[status] || STATUS_CFG.pending;
  const isActive  = ['queued', 'running', 'pending', 'processing'].includes(status);
  const isFailed  = status === 'failed';

  const prLink = review?.pr_url
    || (repoUrl && review?.pr_number ? `${repoUrl}/pull/${review.pr_number}` : null);

  const lang = metadata?.language || metadata?.stack || metadata?.language_detected || null;

  const handleRetry = async () => {
    if (!repoUrl || !review?.pr_number) return;
    try {
      setRetrying(true);
      await reviewService.createReview({ repo_url: repoUrl, pr_number: review.pr_number });
      await fetchReview();
    } catch (err) {
      console.error('[AIReviewReportPage] retry failed:', err);
    } finally {
      setRetrying(false);
    }
  };

  // ── Guard states ──────────────────────────────────────────────────────────
  if (!reviewId) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="glass-card p-10 text-center max-w-sm">
          <RiErrorWarningLine className="text-4xl text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-text-primary mb-2">No review selected</h3>
          <p className="text-sm text-text-muted mb-6">Please select a review from your history.</p>
          <button onClick={() => navigate('/history')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:opacity-90 transition">
            <RiArrowLeftLine /> Back to History
          </button>
        </div>
      </div>
    );
  }

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

  if (error || !review) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="glass-card p-10 text-center max-w-sm">
          <RiErrorWarningLine className="text-4xl text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-text-primary mb-2">Review not found</h3>
          <p className="text-sm text-text-muted mb-6">{error || 'The review could not be loaded.'}</p>
          <button onClick={() => navigate('/history')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:opacity-90 transition">
            <RiArrowLeftLine /> Back to History
          </button>
        </div>
      </div>
    );
  }

  // ── Page ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-full">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Back breadcrumb */}
        <motion.div
          initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3 }}
          className="flex items-center gap-4 mb-6"
        >
          <button onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition">
            <RiArrowLeftLine /> Back
          </button>
          <span className="text-border">|</span>
          <Link to="/history" className="text-sm text-text-muted hover:text-text-primary transition">
            Review History
          </Link>
        </motion.div>

        {/* Header card: Repo · PR #N · status */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
          className="glass-card p-5 mb-6"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h1 className="text-xl font-bold text-text-primary leading-snug">
                <span className="font-mono text-text-secondary">
                  {repo?.full_name || repo?.name || 'Unknown Repo'}
                </span>
                <span className="text-text-muted mx-2">·</span>
                PR #{review.pr_number}
                {review.pr_title && (
                  <span className="text-base font-medium text-text-muted ml-2">{review.pr_title}</span>
                )}
              </h1>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${statusCfg.cls}`}>
                  {isActive  && <RiLoader4Line className="text-xs animate-spin" />}
                  {status === 'completed' && <RiCheckLine className="text-xs" />}
                  {isFailed  && <RiErrorWarningLine className="text-xs" />}
                  {statusCfg.label}
                </span>
                <span className="text-xs text-text-muted">{new Date(review.created_at).toLocaleString()}</span>
              </div>
            </div>
            {prLink && (
              <a href={prLink} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm text-text-muted hover:text-text-primary hover:border-primary/40 transition shrink-0">
                <RiGithubLine /> View PR <RiExternalLinkLine className="text-xs" />
              </a>
            )}
          </div>
        </motion.div>

        {/*
          Two-panel grid:
            Desktop ≥768px: sidebar (240px) + main (1fr)
            Mobile:         single column
          CSS media query injected via <style> to keep the existing Tailwind-only setup.
        */}
        <style>{`
          @media (min-width: 768px) {
            .air-grid {
              grid-template-columns: minmax(0, 240px) minmax(0, 1fr);
            }
          }
        `}</style>
        <div className="grid grid-cols-1 gap-3 items-start air-grid">

          {/* ── SIDEBAR (sticky on desktop) ── */}
          <div style={{ position: 'sticky', top: '1rem', alignSelf: 'start' }}>
            <aside className="space-y-4">

              {/* Score card */}
              <div className="glass-card p-5">
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">Review Score</p>
                {isActive ? (
                  <div className="space-y-3">
                    <div className="w-28 h-28 rounded-full bg-surface-2 animate-pulse mx-auto" />
                    <SkeletonBlock h="h-3" w="w-3/4" className="mx-auto" />
                    <SkeletonBlock h="h-3" w="w-1/2" className="mx-auto" />
                  </div>
                ) : isFailed ? (
                  <div className="text-center py-2">
                    <RiErrorWarningLine className="text-3xl text-red-400 mx-auto mb-2" />
                    <p className="text-xs text-red-400 font-medium">Review failed</p>
                  </div>
                ) : tier ? (
                  <div className="space-y-3 text-center">
                    <ScoreRing score={score} tier={tier} />
                    <div>
                      <p className={`text-sm font-semibold ${tier.color}`}>{tier.label}</p>
                      <p className="text-xs text-text-muted mt-0.5">
                        {totalBugs} finding{totalBugs !== 1 ? 's' : ''} total
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-2">
                    <p className="text-xs text-text-muted">Score not available</p>
                  </div>
                )}
              </div>

              {/* Severity breakdown — only non-zero rows */}
              {!isFailed && totalBugs > 0 && (
                <div className="glass-card p-5 space-y-3">
                  <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Severity Breakdown</p>
                  {SEVERITY_ORDER.map((sev) => {
                    const cnt = sevCounts[sev];
                    if (cnt === 0) return null;
                    return (
                      <SeverityBar key={sev} label={SEVERITY_CFG[sev].label}
                        count={cnt} total={totalBugs} cfg={SEVERITY_CFG[sev]} />
                    );
                  })}
                </div>
              )}

              {/* Details */}
              <div className="glass-card p-5 space-y-3">
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Details</p>
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <RiTimeLine className="text-text-muted shrink-0" />
                  <span>{relativeTime(review.created_at)}</span>
                </div>
                {lang && (
                  <div className="flex items-center gap-2 text-sm text-text-secondary">
                    <RiCodeSSlashLine className="text-text-muted shrink-0" />
                    <span>{lang}</span>
                  </div>
                )}
                {prLink && (
                  <a href={prLink} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-primary hover:underline">
                    <RiGithubLine className="shrink-0" />
                    <span>View PR on GitHub</span>
                    <RiExternalLinkLine className="text-xs shrink-0" />
                  </a>
                )}
              </div>

              {/* Improvements — omit card if empty */}
              {improvements.length > 0 && (
                <div className="glass-card p-5">
                  <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Improvements</p>
                  <ul className="space-y-2">
                    {improvements.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                        <RiCheckLine className="text-green-400 shrink-0 mt-0.5" />
                        {typeof item === 'string' ? item : item.description || JSON.stringify(item)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            </aside>
          </div>
          {/* end sidebar */}

          {/* ── MAIN CONTENT ── */}
          <div className="space-y-6 min-w-0">

            {/* Active polling message */}
            {isActive && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="glass-card p-6 text-center">
                <RiLoader4Line className="text-3xl text-primary animate-spin mx-auto mb-3" />
                <p className="text-base font-semibold text-text-primary">
                  {['queued', 'pending'].includes(status) ? 'Waiting to start…' : 'Review in progress…'}
                </p>
                <p className="text-sm text-text-muted mt-1">This page refreshes automatically every few seconds.</p>
              </motion.div>
            )}

            {/* Failed state */}
            {isFailed && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="glass-card p-6 border-red-500/25 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center">
                    <RiErrorWarningLine className="text-red-400 text-lg" />
                  </div>
                  <h3 className="text-base font-semibold text-text-primary">Review could not be completed</h3>
                </div>
                {(result?.error || review?.error) && (
                  <pre className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed">
                    {result?.error || review?.error}
                  </pre>
                )}
                {repoUrl && review?.pr_number && (
                  <button onClick={handleRetry} disabled={retrying}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:opacity-90 transition disabled:opacity-60">
                    <RiRefreshLine className={retrying ? 'animate-spin' : ''} />
                    {retrying ? 'Retrying…' : 'Retry'}
                  </button>
                )}
              </motion.div>
            )}

            {/* AI Review narrative — full, never truncated */}
            {summary && !isFailed && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                className="glass-card p-6">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                    <RiFlashlightLine className="text-primary text-sm" />
                  </div>
                  <h2 className="text-base font-semibold text-text-primary">AI Review Summary</h2>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">{summary}</p>
              </motion.div>
            )}

            {/* Findings */}
            {!isFailed && totalBugs > 0 && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
                className="space-y-4">

                {/* Header + source filter tabs */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                      <RiFilterLine className="text-primary text-sm" />
                    </div>
                    <h2 className="text-base font-semibold text-text-primary">
                      Findings
                      <span className="ml-2 text-xs font-normal text-text-muted">
                        ({filteredBugs.length}{filteredBugs.length !== totalBugs ? ` of ${totalBugs}` : ''})
                      </span>
                    </h2>
                  </div>
                  {/* Only show tabs for sources present in data */}
                  <div className="flex flex-wrap gap-1.5">
                    {sourceTabs.map((src) => (
                      <button key={src} onClick={() => setSrcFilter(src)}
                        className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                          srcFilter === src
                            ? 'bg-primary text-white'
                            : 'bg-surface-2 text-text-muted hover:text-text-primary border border-border'
                        }`}>
                        {src === 'all' ? 'All' : src.replace(/_/g, ' ')}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Finding cards — sorted Critical→High→Medium→Low */}
                <div className="space-y-3">
                  {visibleBugs.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-sm text-text-muted">
                      No findings match the selected filter.
                    </div>
                  ) : (
                    <AnimatePresence mode="popLayout">
                      {visibleBugs.map((bug, i) => (
                        <FindingCard
                          key={`${bug.file || bug.filename || ''}-${i}`}
                          bug={bug} index={i} repoUrl={repoUrl} headSha={headSha}
                        />
                      ))}
                    </AnimatePresence>
                  )}
                </div>

                {/* Client-side "show more" — no extra API call */}
                {remaining > 0 && (
                  <div className="text-center pt-2">
                    <button onClick={() => setShown((p) => p + PAGE_SIZE)}
                      className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-surface-2 border border-border text-sm text-text-muted hover:text-text-primary hover:border-primary/40 transition">
                      <RiArrowDownLine className="text-xs" />
                      Show {remaining} more finding{remaining !== 1 ? 's' : ''}
                    </button>
                  </div>
                )}
              </motion.div>
            )}

            {/* AI report is not available yet */}
            {!isFailed && !isActive && isReportNull && (
              <div className="glass-card py-14 px-8 text-center">
                <RiErrorWarningLine className="text-4xl text-yellow-500 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-text-primary mb-1">AI report is not available yet.</h3>
                <p className="text-sm text-text-muted">This review is either pending execution or the report payload is empty.</p>
              </div>
            )}

            {/* Clean bill of health */}
            {!isFailed && !isActive && totalBugs === 0 && !isReportNull && (
              <div className="glass-card py-14 px-8 text-center">
                <RiShieldCheckLine className="text-4xl text-green-400 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-text-primary mb-1">No issues found</h3>
                <p className="text-sm text-text-muted">This pull request looks clean!</p>
              </div>
            )}

          </div>
          {/* end main content */}

        </div>
        {/* end two-panel grid */}

      </div>
    </div>
  );
};

export default AIReviewReportPage;
