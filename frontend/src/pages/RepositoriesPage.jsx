import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  RiGithubLine,
  RiRefreshLine,
  RiCheckLine,
  RiWebhookLine,
  RiFlashlightLine,
  RiLoader4Line,
} from 'react-icons/ri';
import githubService from '../services/githubService.js';

const RepositoriesPage = () => {
  const [repositories, setRepositories]     = useState([]);
  const [selectedRepoId, setSelectedRepoId] = useState(null);
  const [loading, setLoading]               = useState(true);

  // Tracks which repos are currently being enabled (to show per-card spinner).
  // Shape: { [repoId]: true }
  const [enablingRepos, setEnablingRepos] = useState({});

  // ─── Load repositories from the local DB (already synced) ─────────────────
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

  // ─── Refresh: re-sync from GitHub then reload ──────────────────────────────
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

  // ─── Select a repo card ────────────────────────────────────────────────────
  const handleSelectRepo = (repo) => {
    setSelectedRepoId(repo.id);
  };

  // ─── Enable Code Review — creates webhook via backend ─────────────────────
  // The backend call is idempotent: if a webhook already exists for this repo
  // (github_webhook_id is set), the server returns alreadyExisted: true.
  const handleEnableRepository = async (e, repo) => {
    // Prevent the card's click handler (handleSelectRepo) from firing
    e.stopPropagation();

    // Prevent double-clicks while a request is in flight
    if (enablingRepos[repo.id]) return;

    setEnablingRepos((prev) => ({ ...prev, [repo.id]: true }));

    try {
      const result = await githubService.enableRepository(repo.id);

      if (result.alreadyExisted) {
        toast.success(`Webhook already active for ${repo.name}`);
      } else {
        toast.success(`Code review enabled for ${repo.name}! Webhook created.`);
      }

      // Refresh the repository list so the webhook badge appears immediately.
      // We reload all repos rather than patching state to keep a single source
      // of truth (the DB).
      await loadRepositories();
    } catch (error) {
      console.error('Failed to enable repository:', error);
      const message =
        error?.response?.data?.error ||
        error?.message ||
        'Failed to enable code review';
      toast.error(message);
    } finally {
      setEnablingRepos((prev) => ({ ...prev, [repo.id]: false }));
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-full">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* ── Page Header ──────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8"
        >
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <RiGithubLine className="text-primary text-sm" />
              </div>
              <h1 className="text-2xl font-bold text-text-primary">Repositories</h1>
            </div>
            <p className="text-text-muted text-sm ml-11">
              Enable code review on a repository to automatically receive pull request reviews.
            </p>
          </div>

          <button
            onClick={handleRefresh}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-medium hover:opacity-90 transition"
          >
            <RiRefreshLine />
            Refresh from GitHub
          </button>
        </motion.div>

        {/* ── Repository Grid ───────────────────────────────────────────────── */}
        {loading ? (
          <div className="text-text-muted">Loading repositories…</div>
        ) : repositories.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface-1 p-8 text-center text-text-muted">
            No repositories found yet. Use the Refresh button to sync from GitHub.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {repositories.map((repo) => {
              const isSelected      = selectedRepoId === repo.id;
              const isEnabling      = !!enablingRepos[repo.id];
              // A non-null github_webhook_id means the webhook has been registered
              const webhookIsActive = repo.github_webhook_id != null;
              const visibilityLabel = repo.private ? 'Private' : 'Public';

              return (
                <motion.div
                  key={repo.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`rounded-2xl border p-5 text-left transition cursor-pointer ${
                    isSelected
                      ? 'border-primary bg-primary/10 shadow-sm'
                      : 'border-border bg-surface-1 hover:border-primary/40'
                  }`}
                  onClick={() => handleSelectRepo(repo)}
                >
                  {/* ── Card header ─────────────────────────────────────── */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h2 className="text-lg font-semibold text-text-primary truncate">
                        {repo.name || repo.full_name}
                      </h2>
                      <p className="text-sm text-text-muted">{repo.owner || 'Unknown owner'}</p>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Webhook active badge — appears after enabling */}
                      {webhookIsActive && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/15 text-green-500 text-xs font-medium">
                          <RiWebhookLine className="text-xs" />
                          Webhook Active
                        </span>
                      )}

                      {/* Selected indicator */}
                      {isSelected && (
                        <div className="rounded-full bg-primary/15 p-2 text-primary">
                          <RiCheckLine className="text-sm" />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Repo metadata ───────────────────────────────────── */}
                  <div className="mt-4 space-y-2 text-sm text-text-muted">
                    <div className="flex items-center justify-between">
                      <span>Visibility</span>
                      <span className="font-medium text-text-primary">{visibilityLabel}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Default branch</span>
                      <span className="font-medium text-text-primary">
                        {repo.default_branch || 'main'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Last updated</span>
                      <span className="font-medium text-text-primary">
                        {repo.updated_at
                          ? new Date(repo.updated_at).toLocaleDateString()
                          : '—'}
                      </span>
                    </div>
                  </div>

                  {/* ── Enable Code Review CTA ──────────────────────────── */}
                  <div className="mt-5">
                    {webhookIsActive ? (
                      /* Already enabled — static confirmation */
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-green-500 font-medium flex items-center gap-1.5">
                          <RiCheckLine />
                          Code Review Enabled
                        </span>
                        <RiWebhookLine className="text-green-500" />
                      </div>
                    ) : (
                      /* Not yet enabled — show the enable button */
                      <button
                        id={`enable-repo-${repo.id}`}
                        type="button"
                        onClick={(e) => handleEnableRepository(e, repo)}
                        disabled={isEnabling}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl
                                   bg-primary/10 text-primary text-sm font-medium
                                   hover:bg-primary/20 transition
                                   disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {isEnabling ? (
                          <>
                            <RiLoader4Line className="animate-spin text-base" />
                            Creating webhook…
                          </>
                        ) : (
                          <>
                            <RiFlashlightLine className="text-base" />
                            Enable Code Review
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default RepositoriesPage;
