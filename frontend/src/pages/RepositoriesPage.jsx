import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { RiGithubLine, RiRefreshLine, RiCheckLine } from 'react-icons/ri';
import githubService from '../services/githubService.js';

const RepositoriesPage = () => {
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
    <div className="min-h-full">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
              Choose a repository for pull request review workflows.
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

        {loading ? (
          <div className="text-text-muted">Loading repositories…</div>
        ) : repositories.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface-1 p-8 text-center text-text-muted">
            No repositories found yet.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                      <h2 className="text-lg font-semibold text-text-primary">{repo.name || repo.full_name}</h2>
                      <p className="text-sm text-text-muted">{repo.owner || 'Unknown owner'}</p>
                    </div>
                    {isSelected && (
                      <div className="rounded-full bg-primary/15 p-2 text-primary">
                        <RiCheckLine className="text-sm" />
                      </div>
                    )}
                  </div>

                  <div className="mt-4 space-y-2 text-sm text-text-muted">
                    <div className="flex items-center justify-between">
                      <span>Visibility</span>
                      <span className="font-medium text-text-primary">{visibilityLabel}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Default branch</span>
                      <span className="font-medium text-text-primary">{repo.default_branch || 'main'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Last updated</span>
                      <span className="font-medium text-text-primary">
                        {repo.updated_at ? new Date(repo.updated_at).toLocaleDateString() : '—'}
                      </span>
                    </div>
                  </div>

                  <div className="mt-5 flex items-center justify-between text-sm">
                    <span className="text-primary font-medium">Review Pull Requests →</span>
                    <RiGithubLine className="text-primary" />
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default RepositoriesPage;
