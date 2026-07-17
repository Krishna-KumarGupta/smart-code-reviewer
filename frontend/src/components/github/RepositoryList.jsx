import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { RiGithubLine, RiRefreshLine, RiCheckLine, RiToggleLine, RiLoader4Line, RiSortAsc, RiTimeLine } from 'react-icons/ri';
import githubService from '../../services/githubService.js';
import githubApi from '../../services/github.api.js';
import reviewService from '../../services/reviewService.js';
import useAuth from '../../hooks/useAuth.js';

const RepositoryList = ({ className = '' }) => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [repositories, setRepositories] = useState([]);
  const [selectedRepoId, setSelectedRepoId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('recent'); // 'recent' | 'alpha'

  const [pullRequests, setPullRequests] = useState([]);
  const [prsLoading, setPrsLoading] = useState(false);
  const [prsError, setPrsError] = useState(null);
  const [activeRepoForPRs, setActiveRepoForPRs] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [triggeringPrs, setTriggeringPrs] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [togglingRepos, setTogglingRepos] = useState({});
  const [showLoadingModal, setShowLoadingModal] = useState(false);
  const [modalStep, setModalStep] = useState(0);
  const [modalPrNumber, setModalPrNumber] = useState(null);

  const loadRepositories = async () => {
    try {
      setLoading(true);
      const response = await githubService.getRepositories();
      setRepositories(response?.repositories || []);
    } catch (error) {
      console.error('Failed to load repositories:', error);
      toast.error(error?.response?.data?.error || 'Unable to load repositories');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRepositories();
  }, []);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await githubService.syncRepositories();
      toast.success('Repositories updated successfully');
      await loadRepositories();
    } catch (error) {
      console.error('Failed to refresh repositories:', error);
      toast.error(error?.response?.data?.error || 'Unable to refresh repositories');
    } finally {
      setRefreshing(false);
    }
  };

  const handleSelectRepo = (repo) => {
    setSelectedRepoId(repo.id);
  };

  const handleToggleAIReview = async (repo, event) => {
    event.stopPropagation();
    if (togglingRepos[repo.id]) return;
    setTogglingRepos(prev => ({ ...prev, [repo.id]: true }));

    try {
      if (repo.github_webhook_id) {
        await githubService.disableAIReview(repo.id);
        toast.success('AI Review disabled');
      } else {
        await githubService.enableAIReview(repo.id);
        toast.success('AI Review enabled');
      }
      await loadRepositories();
    } catch (error) {
      console.error('Failed to toggle AI review:', error);
      toast.error(error?.response?.data?.error || 'Unable to update AI Review');
    } finally {
      setTogglingRepos(prev => ({ ...prev, [repo.id]: false }));
    }
  };

  /**
   * Fetches open pull requests for the clicked repository
   */
  const handleFetchPRs = async (repo, event) => {
    event.stopPropagation();
    setActiveRepoForPRs(repo);
    setPullRequests([]);
    setPrsError(null);

    try {
      setPrsLoading(true);
      const prs = await githubApi.fetchOpenPullRequests(repo.owner, repo.name);
      setPullRequests(prs || []);
      await fetchReviews();
    } catch (error) {
      console.error('Failed to fetch open PRs:', error);
      setPrsError(error.message || 'Failed to retrieve pull requests.');
    } finally {
      setPrsLoading(false);
    }
  };

  const fetchReviews = async () => {
    try {
      const data = await reviewService.getUserReviews();
      setReviews(data || []);
    } catch (e) {
      console.error('Failed to fetch reviews', e);
    }
  };

  const getPRStatus = (prNumber) => {
    if (!activeRepoForPRs) return 'Not Reviewed';
    const prReviews = reviews.filter(
      r => r.repository_id === activeRepoForPRs.id && r.pr_number === prNumber
    );
    if (prReviews.length === 0) return 'Not Reviewed';
    const latestReview = prReviews[0];
    
    switch (latestReview.status) {
      case 'pending': return 'Queued';
      case 'processing': return 'AI Reviewing';
      case 'completed': return 'Completed';
      case 'failed': return 'Failed';
      default: return 'Not Reviewed';
    }
  };

  const renderStatusBadge = (status) => {
    switch (status) {
      case 'Queued':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-warning/10 text-warning">🟡 Queued</span>;
      case 'AI Reviewing':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">⚙️ AI Reviewing</span>;
      case 'Completed':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-success/10 text-success">✅ Completed</span>;
      case 'Failed':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-500">❌ Failed</span>;
      default:
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-2 text-text-muted">Not Reviewed</span>;
    }
  };

  /**
   * Triggers the backend and Celery worker analysis for the selected Pull Request
   */
  const handleTriggerReview = async (pr) => {
    if (triggeringPrs[pr.id]) return;

    setModalPrNumber(pr.number);
    setModalStep(1);
    setShowLoadingModal(true);

    const toastId = `trigger-${pr.id}`;
    setTriggeringPrs(prev => ({ ...prev, [pr.id]: true }));
    try {
      // Animate the checklist steps while the API call is in-flight
      const t1 = setTimeout(() => setModalStep(2), 650);
      const t2 = setTimeout(() => setModalStep(3), 1300);

      toast.loading(`Triggering analysis for PR #${pr.number}...`, { id: toastId });
      const response = await reviewService.triggerReview(
        activeRepoForPRs.owner,
        activeRepoForPRs.name,
        pr.number,
        profile?.id,
        activeRepoForPRs.id
      );

      clearTimeout(t1);
      clearTimeout(t2);
      setModalStep(4); // Success!

      // Extract the reviewId from the backend 202 response.
      // sendSuccess wraps data as { success: true, data: { reviewId, ... } }
      const reviewId = response?.data?.reviewId;

      setTimeout(() => {
        setShowLoadingModal(false);
        toast.success('Review request queued successfully.', { id: toastId });

        // Navigate immediately to the report page so the user can watch progress.
        // AIReviewReportPage will poll GET /api/reviews/:reviewId every 4s.
        if (reviewId) {
          navigate(`/history/report?reviewId=${reviewId}`);
        }
      }, 950);

      window.dispatchEvent(new Event('reviewTriggered'));
    } catch (error) {
      console.error('Failed to trigger review:', error);
      setShowLoadingModal(false);
      const errorMsg = error.response?.data?.error || error.message || 'Unable to queue review';
      toast.error(errorMsg, { id: toastId });
    } finally {
      setTriggeringPrs(prev => ({ ...prev, [pr.id]: false }));
    }
  };

  // ── Sort repositories client-side (no API call) ─────────────────────────────
  const sortedRepositories = useMemo(() => {
    const copy = [...repositories];
    if (sortBy === 'alpha') {
      return copy.sort((a, b) =>
        (a.name || a.full_name || '').localeCompare(b.name || b.full_name || '')
      );
    }
    // 'recent' — newest first, updated_at preferred, fallback to created_at
    return copy.sort((a, b) => {
      const dateA = new Date(a.updated_at || a.created_at || 0).getTime();
      const dateB = new Date(b.updated_at || b.created_at || 0).getTime();
      return dateB - dateA;
    });
  }, [repositories, sortBy]);

  return (
    <div className={`space-y-6 ${className}`.trim()}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">Repositories</h3>
          <p className="text-sm text-text-muted">Choose a repository for future review workflows.</p>
        </div>

        <button
          type="button"
          disabled={refreshing}
          onClick={handleRefresh}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {refreshing ? <RiLoader4Line className="animate-spin text-base" /> : <RiRefreshLine />}
          {refreshing ? 'Refreshing...' : 'Refresh from GitHub'}
        </button>
      </div>

      {/* ── Sort toggle — only shown when repos are loaded ───────────────────── */}
      {!loading && repositories.length > 0 && (
        <div className="flex items-center gap-1 w-fit rounded-xl border border-border bg-surface-2 p-1">
          <button
            type="button"
            onClick={() => setSortBy('recent')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              sortBy === 'recent'
                ? 'bg-primary text-white shadow-sm'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            <RiTimeLine className="text-sm" />
            Recent
          </button>
          <button
            type="button"
            onClick={() => setSortBy('alpha')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              sortBy === 'alpha'
                ? 'bg-primary text-white shadow-sm'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            <RiSortAsc className="text-sm" />
            A–Z
          </button>
        </div>
      )}

      {/* ── Repository grid (scrollable, ~4 cards visible at once) ──────────── */}
      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-border bg-surface-1 px-6 py-10 text-text-muted">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span>Loading repositories…</span>
          </div>
        </div>
      ) : sortedRepositories.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface-1 px-6 py-10 text-center text-sm text-text-muted">
          No repositories found. Click Refresh from GitHub.
        </div>
      ) : (
        /* Scrollable wrapper — shows ~4 cards (2 rows in 2-col layout) */
        <div className="scrollbar-styled" style={{ maxHeight: '440px', overflowY: 'auto' }}>
          <div className="grid gap-4 md:grid-cols-2">
            {sortedRepositories.map((repo) => {
              const isSelected = selectedRepoId === repo.id;
              const visibilityLabel = repo.private ? 'Private' : 'Public';

              return (
                <motion.div
                  key={repo.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelectRepo(repo)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      handleSelectRepo(repo);
                    }
                  }}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`rounded-2xl border p-5 text-left transition ${
                    isSelected
                      ? 'border-primary bg-primary/10 shadow-sm'
                      : 'border-border bg-surface-1 hover:border-primary/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-base font-semibold text-text-primary">
                        {repo.name || repo.full_name}
                      </h4>
                      <p className="text-sm text-text-muted">{repo.owner || 'Unknown owner'}</p>
                    </div>
                    {isSelected && (
                      <div className="rounded-full bg-primary/15 p-2 text-primary">
                        <RiCheckLine className="text-sm" />
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${repo.private ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}`}>
                      {visibilityLabel}
                    </span>
                    <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-text-muted">
                      {repo.default_branch || 'main'}
                    </span>
                  </div>

                  <div className="mt-4 flex items-center justify-between text-sm text-text-muted">
                    <span>Last updated</span>
                    <span className="font-medium text-text-primary">
                      {repo.updated_at ? new Date(repo.updated_at).toLocaleDateString() : '—'}
                    </span>
                  </div>

                  <div className="mt-4 flex items-center justify-between text-sm">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-text-primary">AI Review</span>
                      <span className="text-xs text-text-muted">
                        {repo.github_webhook_id ? 'Enabled · Webhook Active' : 'Disabled · Webhook Inactive'}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={togglingRepos[repo.id]}
                      onClick={(event) => handleToggleAIReview(repo, event)}
                      className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${
                        repo.github_webhook_id
                          ? 'bg-success/10 text-success hover:bg-success/20'
                          : 'bg-primary/10 text-primary hover:bg-primary/20'
                      }`}
                    >
                      {togglingRepos[repo.id] ? <RiLoader4Line className="animate-spin text-sm" /> : <RiToggleLine className="text-sm" />}
                      {repo.github_webhook_id ? 'Disable AI Review' : 'Enable AI Review'}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={(event) => handleFetchPRs(repo, event)}
                    className={`w-full mt-4 flex items-center justify-between text-sm rounded-xl p-2.5 transition font-semibold ${
                      activeRepoForPRs?.id === repo.id
                        ? 'bg-primary text-white shadow-lg shadow-primary/20 border border-primary-hover hover:brightness-110'
                        : 'bg-surface-2 text-text-primary hover:bg-surface-3 border border-border-light'
                    }`}
                  >
                    <span>Review Pull Requests →</span>
                    <RiGithubLine className={activeRepoForPRs?.id === repo.id ? 'text-white text-base' : 'text-primary text-base'} />
                  </button>
              </motion.div>
            );
          })}
          </div>
        </div>
      )}

      {/* ─── Pull Requests Display Area ───────────────────────────────────── */}
      {activeRepoForPRs && (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-border bg-surface-1 p-6"
        >
          <div className="flex items-center justify-between mb-4 border-b border-border pb-3">
            <div>
              <h4 className="text-base font-semibold text-text-primary">
                Open Pull Requests for {activeRepoForPRs.owner}/{activeRepoForPRs.name}
              </h4>
              <p className="text-xs text-text-muted mt-0.5">Select a pull request to trigger reviews manually.</p>
            </div>
            <button
              onClick={() => setActiveRepoForPRs(null)}
              className="text-xs text-text-muted hover:text-text-primary transition"
            >
              Close
            </button>
          </div>

          {prsLoading ? (
            <div className="flex items-center justify-center py-8 text-text-muted">
              <RiLoader4Line className="animate-spin text-xl mr-2 text-primary" />
              <span>Fetching pull requests…</span>
            </div>
          ) : prsError ? (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-500 text-center">
              {prsError}
            </div>
          ) : pullRequests.length === 0 ? (
            <div className="py-8 text-center text-text-muted text-sm">
              No open pull requests found for this repository.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-text-muted">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wider text-text-primary">
                    <th className="py-3 px-4">PR #</th>
                    <th className="py-3 px-4">Title</th>
                    <th className="py-3 px-4">Author</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pullRequests.map((pr) => (
                    <tr key={pr.id} className="border-b border-border hover:bg-surface-2 transition">
                      <td className="py-3 px-4 font-semibold text-text-primary">#{pr.number}</td>
                      <td className="py-3 px-4">
                        <a
                          href={pr.html_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline text-text-primary font-medium"
                        >
                          {pr.title}
                        </a>
                      </td>
                      <td className="py-3 px-4">{pr.user}</td>
                      <td className="py-3 px-4">{renderStatusBadge(getPRStatus(pr.number))}</td>
                      <td className="py-3 px-4 text-right">
                        {(() => {
                          const status = getPRStatus(pr.number);
                          const isTriggering = triggeringPrs[pr.id];
                          
                          if (isTriggering) {
                            return (
                              <button
                                type="button"
                                disabled
                                className="px-3 py-1.5 rounded-lg bg-primary/50 text-white text-xs font-semibold cursor-not-allowed transition flex items-center justify-center gap-1.5 ml-auto border-2 border-red-500 animate-pulse"
                              >
                                <RiLoader4Line className="animate-spin text-sm" />
                                Queueing Review...
                              </button>
                            );
                          }
                          
                          if (status === 'Queued') {
                            return (
                              <button
                                type="button"
                                disabled
                                className="px-3 py-1.5 rounded-lg bg-warning/20 text-warning text-xs font-semibold cursor-not-allowed transition flex items-center justify-center gap-1.5 ml-auto border border-warning/30"
                              >
                                Queued
                              </button>
                            );
                          }
                          
                          if (status === 'AI Reviewing') {
                            return (
                              <button
                                type="button"
                                disabled
                                className="px-3 py-1.5 rounded-lg bg-primary/20 text-primary text-xs font-semibold cursor-not-allowed transition flex items-center justify-center gap-1.5 ml-auto border border-primary/30"
                              >
                                Reviewing
                              </button>
                            );
                          }
                          
                          return (
                            <button
                              type="button"
                              className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:opacity-90 transition flex items-center justify-center gap-1.5 ml-auto"
                              onClick={() => handleTriggerReview(pr)}
                            >
                              Review PR
                            </button>
                          );
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      )}

      {/* Glassmorphic Queue Progress Modal */}
      <AnimatePresence>
        {showLoadingModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.25 }}
              className="glass-card w-full max-w-md p-6 border border-border-light shadow-2xl bg-surface-1/95 mx-4"
            >
              <div className="flex flex-col items-center text-center gap-5">
                {/* Visual Scanner Animation */}
                <div className="relative w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary overflow-hidden">
                  <RiLoader4Line className="text-3xl animate-spin text-primary" />
                  <motion.div 
                    initial={{ top: "-100%" }}
                    animate={{ top: "100%" }}
                    transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                    className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent opacity-60"
                  />
                </div>

                <div>
                  <h3 className="text-lg font-bold text-text-primary">
                    Queueing Review for PR #{modalPrNumber}
                  </h3>
                  <p className="text-xs text-text-muted mt-1 leading-relaxed">
                    Connecting to GitHub webhook engine to dispatch analysis.
                  </p>
                </div>

                {/* Checklist Progress Indicators */}
                <div className="w-full space-y-3 mt-3 text-left bg-surface-2/40 p-4 rounded-xl border border-border-light">
                  <div className="flex items-center gap-3 text-xs">
                    <span className={`w-2 h-2 rounded-full ${modalStep >= 1 ? 'bg-primary' : 'bg-surface-3'}`} />
                    <span className={modalStep >= 1 ? 'text-text-primary font-medium' : 'text-text-muted'}>
                      {modalStep > 1 ? '✓ Checked Repository Settings' : '● Validating Repository Settings...'}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs">
                    <span className={`w-2 h-2 rounded-full ${modalStep >= 2 ? 'bg-primary animate-pulse' : 'bg-surface-3'}`} />
                    <span className={modalStep >= 2 ? 'text-text-primary font-medium' : 'text-text-muted'}>
                      {modalStep > 2 ? '✓ Created Database Entry' : modalStep === 2 ? '● Creating Database Entry...' : '○ Pending Database Sync'}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs">
                    <span className={`w-2 h-2 rounded-full ${modalStep >= 3 ? 'bg-primary animate-pulse' : 'bg-surface-3'}`} />
                    <span className={modalStep >= 3 ? 'text-text-primary font-medium' : 'text-text-muted'}>
                      {modalStep > 3 ? '✓ Dispatched to Redis Queue' : modalStep === 3 ? '● Dispatching to Celery Worker...' : '○ Pending Redis Dispatch'}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs">
                    <span className={`w-2 h-2 rounded-full ${modalStep === 4 ? 'bg-emerald-500 animate-bounce' : 'bg-surface-3'}`} />
                    <span className={modalStep === 4 ? 'text-emerald-500 font-bold' : 'text-text-muted'}>
                      {modalStep === 4 ? '✓ Review Successfully Queued!' : '○ Enqueued'}
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default RepositoryList;
