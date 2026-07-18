/**
 * DisconnectGitHubButton
 *
 * A standalone button that handles the GitHub account disconnect flow.
 * Shows a loading spinner during the API call, then fires a toast.
 *
 * Props:
 *   onSuccess : () => void — called after successful disconnect
 *   className : string     — additional Tailwind classes
 */

import { useState } from 'react';
import toast from 'react-hot-toast';
import { RiLinkUnlink, RiLoader4Line } from 'react-icons/ri';
import githubService from '../../services/githubService.js';
import useAuth from '../../hooks/useAuth.js';

const DisconnectGitHubButton = ({ onSuccess, className = '' }) => {
  const { refreshGitHubStatus, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleDisconnect = async () => {
    if (loading) return;

    setLoading(true);
    try {
      await githubService.disconnect();

      // Refresh both GitHub status and profile in parallel
      await Promise.all([refreshGitHubStatus(), refreshProfile()]);

      toast.success(
        'GitHub account disconnected. You can connect any GitHub account again. GitHub uses the account currently signed into github.com.'
      );
      onSuccess?.();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to disconnect GitHub');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      id="disconnect-github-btn"
      onClick={handleDisconnect}
      disabled={loading}
      className={`
        inline-flex items-center gap-2
        px-4 py-2 rounded-xl
        text-sm font-medium
        border border-red-500/30
        bg-red-500/10 text-red-400
        hover:bg-red-500/20 hover:border-red-500/50
        disabled:opacity-50 disabled:cursor-not-allowed
        transition-all duration-200
        ${className}
      `}
    >
      {loading ? (
        <RiLoader4Line className="animate-spin text-base" />
      ) : (
        <RiLinkUnlink className="text-base" />
      )}
      {loading ? 'Disconnecting…' : 'Disconnect'}
    </button>
  );
};

export default DisconnectGitHubButton;
