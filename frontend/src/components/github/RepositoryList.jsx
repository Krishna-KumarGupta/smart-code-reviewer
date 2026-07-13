import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { RiGithubLine, RiRefreshLine, RiCheckLine } from 'react-icons/ri';
import githubService from '../../services/githubService.js';

const RepositoryList = ({ className = '' }) => {
  const [repositories, setRepositories] = useState([]);
  const [selectedRepoId, setSelectedRepoId] = useState(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className={`space-y-4 ${className}`.trim()}>
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

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-border bg-surface-1 px-6 py-10 text-text-muted">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span>Loading repositories…</span>
          </div>
        </div>
      ) : repositories.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface-1 px-6 py-10 text-center text-sm text-text-muted">
          No repositories found. Click Refresh from GitHub.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {repositories.map((repo) => {
            const isSelected = selectedRepoId === repo.id;
            const visibilityLabel = repo.private ? 'Private' : 'Public';

            return (
              <motion.button
                key={repo.id}
                type="button"
                onClick={() => handleSelectRepo(repo)}
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
                  <span className="text-primary font-medium">Review Pull Requests →</span>
                  <RiGithubLine className="text-primary" />
                </div>
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default RepositoryList;
