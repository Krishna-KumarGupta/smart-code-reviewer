import { useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { RiGithubLine, RiRefreshLine, RiCheckLine, RiToggleLine, RiSortAsc, RiTimeLine } from 'react-icons/ri';
import githubService from '../../services/githubService.js';

const RepositoryList = ({ className = '' }) => {
  const [repositories, setRepositories] = useState([]);
  const [selectedRepoId, setSelectedRepoId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('recent'); // 'recent' | 'alpha'

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
    try {
      await githubService.syncRepositories();
      toast.success('Repositories updated successfully');
      await loadRepositories();
    } catch (error) {
      console.error('Failed to refresh repositories:', error);
      toast.error(error?.response?.data?.error || 'Unable to refresh repositories');
    }
  };

  const handleSelectRepo = (repo) => {
    setSelectedRepoId(repo.id);
  };

  const handleToggleAIReview = async (repo, event) => {
    event.stopPropagation();
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
    <div className={`space-y-4 ${className}`.trim()}>

      {/* ── Header row ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">Repositories</h3>
          <p className="text-sm text-text-muted">Choose a repository for future review workflows.</p>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          <RiRefreshLine />
          Refresh from GitHub
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
                      onClick={(event) => handleToggleAIReview(repo, event)}
                      className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium transition ${
                        repo.github_webhook_id
                          ? 'bg-success/10 text-success hover:bg-success/20'
                          : 'bg-primary/10 text-primary hover:bg-primary/20'
                      }`}
                    >
                      <RiToggleLine className="text-sm" />
                      {repo.github_webhook_id ? 'Disable AI Review' : 'Enable AI Review'}
                    </button>
                  </div>

                  <div className="mt-4 flex items-center justify-between text-sm">
                    <span className="text-primary font-medium">Review Pull Requests →</span>
                    <RiGithubLine className="text-primary" />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default RepositoryList;
