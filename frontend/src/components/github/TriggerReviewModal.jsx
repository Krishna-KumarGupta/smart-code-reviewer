import { useState, useEffect } from 'react';
import { RiCodeSSlashLine, RiAlertLine } from 'react-icons/ri';
import Modal from '../ui/Modal.jsx';
import Input from '../ui/Input.jsx';
import reviewService from '../../services/reviewService.js';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

const TriggerReviewModal = ({ isOpen, onClose, repositories, initialRepository }) => {
  const navigate = useNavigate();
  const [selectedRepoId, setSelectedRepoId] = useState('');
  const [prNumber, setPrNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Synchronise selected repo when modal opens or initialRepository changes
  useEffect(() => {
    if (isOpen) {
      if (initialRepository) {
        setSelectedRepoId(initialRepository.id);
      } else if (repositories && repositories.length > 0) {
        setSelectedRepoId(repositories[0].id);
      }
      setPrNumber('');
      setError(null);
    }
  }, [initialRepository, isOpen, repositories]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedRepoId) {
      setError('Repository selection is required');
      return;
    }
    if (!prNumber) {
      setError('PR number is required');
      return;
    }
    const prNum = parseInt(prNumber, 10);
    if (isNaN(prNum) || prNum <= 0) {
      setError('Please enter a valid PR number');
      return;
    }

    const repo = repositories.find((r) => r.id === selectedRepoId);
    if (!repo) {
      setError('Selected repository not found');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const [owner, repoName] = repo.full_name.split('/');
      const result = await reviewService.triggerReview(owner, repoName, prNum, repo.id);

      toast.success('Code review triggered successfully!');
      onClose();
      // Redirect to the detail page (matching the route pattern '/history/report?reviewId={uuid}')
      navigate(`/history/report?reviewId=${result.reviewId}`);
    } catch (err) {
      console.error('[TriggerReviewModal] trigger error:', err);
      setError(err?.response?.data?.error || err.message || 'Failed to trigger review');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Trigger AI Code Review"
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="repo-select" className="text-sm font-medium text-text-secondary">
            Repository
          </label>
          <select
            id="repo-select"
            value={selectedRepoId}
            onChange={(e) => {
              setSelectedRepoId(e.target.value);
              if (error) setError(null);
            }}
            disabled={loading}
            className="w-full bg-surface-2 border border-border/40 focus:border-primary text-text-primary rounded-xl py-3 px-4 text-sm outline-none focus:shadow-[0_0_0_3px_rgba(99,102,241,0.15)] transition-all duration-200"
          >
            {repositories.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.full_name}
              </option>
            ))}
          </select>
        </div>

        <Input
          id="pr-number-input"
          label="Pull Request Number"
          type="number"
          placeholder="e.g. 42"
          value={prNumber}
          onChange={(e) => {
            setPrNumber(e.target.value);
            if (error) setError(null);
          }}
          icon={<RiCodeSSlashLine />}
          error={error}
          disabled={loading}
          min="1"
          required
        />

        {error && !error.includes('PR number') && !error.includes('Repository') && (
          <div className="flex items-start gap-2.5 rounded-xl bg-red-500/10 border border-red-500/25 p-3.5 text-xs text-red-400">
            <RiAlertLine className="text-sm shrink-0 mt-0.5" />
            <p className="leading-relaxed">{error}</p>
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-text-primary transition hover:bg-surface-3 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Triggering...' : 'Trigger Review'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default TriggerReviewModal;
