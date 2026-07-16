/**
 * ConnectGitHubCard
 *
 * The main GitHub connection widget. Renders two states:
 *
 *  NOT CONNECTED:
 *    ⚪ GitHub not connected
 *    Description text
 *    [ Connect GitHub ] button
 *
 *  CONNECTED:
 *    🟢 Connected as @username
 *    Avatar + username + member info
 *    [ Disconnect ] button
 *
 * Reads state from AuthContext. Initiates OAuth via githubService.connect().
 * Handles URL param ?github=connected on mount to show a toast.
 */

import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import {
  RiGithubLine,
  RiLoader4Line,
  RiCheckLine,
} from "react-icons/ri";

import useAuth from "../../hooks/useAuth.js";
import githubService from "../../services/githubService.js";
import GitHubStatus from "./GitHubStatus.jsx";
import DisconnectGitHubButton from "./DisconnectGitHubButton.jsx";
import ConnectGithubModal from "./ConnectGithubModal.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// Connected State
// ─────────────────────────────────────────────────────────────────────────────

const ConnectedView = ({ username, avatar }) => (
  <motion.div
    key="connected"
    initial={{ opacity: 0, scale: 0.97 }}
    animate={{ opacity: 1, scale: 1 }}
    exit={{ opacity: 0, scale: 0.97 }}
    transition={{ duration: 0.3 }}
    className="flex flex-col items-center text-center gap-6 py-4"
  >
    <div className="relative">
      <div className="w-20 h-20 rounded-2xl overflow-hidden border-2 border-emerald-500/40 shadow-lg shadow-emerald-500/10">
        {avatar ? (
          <img
            src={avatar}
            alt={`${username} GitHub avatar`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-surface-2 flex items-center justify-center">
            <RiGithubLine className="text-3xl text-text-muted" />
          </div>
        )}
      </div>

      <span className="absolute -bottom-2 -right-2 w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center shadow-md">
        <RiCheckLine className="text-white text-xs" />
      </span>
    </div>

    <div>
      <GitHubStatus connected username={username} size="md" />

      {username && (
        <a
          href={`https://github.com/${username}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block mt-1 text-xs text-text-muted hover:text-primary transition-colors"
        >
          github.com/{username} ↗
        </a>
      )}
    </div>

    <DisconnectGitHubButton />
  </motion.div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Not Connected State
// ─────────────────────────────────────────────────────────────────────────────

const NotConnectedView = ({ onConnect, loading }) => (
  <motion.div
    key="not-connected"
    initial={{ opacity: 0, scale: 0.97 }}
    animate={{ opacity: 1, scale: 1 }}
    exit={{ opacity: 0, scale: 0.97 }}
    transition={{ duration: 0.3 }}
    className="flex flex-col items-center text-center gap-5 py-4"
  >
    <div className="w-16 h-16 rounded-2xl bg-surface-2 border border-border-light flex items-center justify-center">
      <RiGithubLine className="text-4xl text-text-muted" />
    </div>

    <div>
      <GitHubStatus connected={false} size="md" />

      <p className="text-sm text-text-muted mt-3 max-w-xs leading-relaxed">
        Connect your GitHub account to enable AI-powered code reviews for your pull requests.
      </p>
    </div>

    <button
      id="connect-github-btn"
      onClick={onConnect}
      disabled={loading}
      className="
        inline-flex items-center gap-2.5
        px-5 py-2.5 rounded-xl
        text-sm font-semibold
        bg-gradient-to-r from-primary to-accent
        text-white
        shadow-glow
        hover:opacity-90 hover:shadow-glow-lg
        disabled:opacity-50 disabled:cursor-not-allowed
        transition-all duration-200
        active:scale-[0.98]
      "
    >
      {loading ? (
        <>
          <RiLoader4Line className="animate-spin text-base" />
          Redirecting to GitHub...
        </>
      ) : (
        <>
          <RiGithubLine className="text-base" />
          Connect GitHub
        </>
      )}
    </button>

  </motion.div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

const ConnectGitHubCard = () => {
  const {
    githubConnected,
    githubUsername,
    githubAvatar,
    refreshGitHubStatus,
  } = useAuth();

  const [searchParams, setSearchParams] = useSearchParams();
  const [loginLoading, setLoginLoading] = useState(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false);

  // ── Handle OAuth callback result query param ─────────────────────────────
  // The backend redirects to /home?github=connected (or denied/error) after
  // the OAuth flow. This effect reads that param, refreshes GitHub status,
  // and clears the param from the URL so it isn't processed again on re-render.
  //
  // refreshGitHubStatus is in the deps array so we always call the version
  // that has the current (non-stale) user reference captured in its closure.
  // The effect still runs only once on mount because refreshGitHubStatus is
  // stable (useCallback with [user] dep — user doesn't change mid-session).
  useEffect(() => {
    const githubParam = searchParams.get("github");

    if (!githubParam) return;

    console.info('[ConnectGitHubCard] OAuth callback param received:', githubParam);

    if (githubParam === "connected") {
      setHasConnectedOnce(true);
      // Explicitly refresh status from backend — the source of truth.
      // initSession() already fetched status on page load, but this ensures
      // the freshest state is reflected immediately after OAuth return.
      refreshGitHubStatus().then((status) => {
        console.info('[ConnectGitHubCard] refreshGitHubStatus result:', {
          connected: status?.connected,
          username:  status?.username,
        });
        toast.success("🎉 GitHub account connected!", { duration: 5000 });
      }).catch((err) => {
        console.error('[ConnectGitHubCard] refreshGitHubStatus failed:', err?.message);
      });
    } else if (githubParam === "denied") {
      toast("GitHub connection cancelled", { icon: "ℹ️" });
    } else if (githubParam === "error") {
      const reason = searchParams.get("reason") || "unknown";
      toast.error(`GitHub connection failed (${reason}). Please try again.`);
    }

    // Remove the param from the URL so it isn't re-processed on re-render
    setSearchParams((prev) => {
      prev.delete("github");
      prev.delete("reason");
      return prev;
    });
  }, [refreshGitHubStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnect = async () => {
    setIsConnectModalOpen(false);
    setLoginLoading(true);

    try {
      await githubService.connect();
      // window.location.href redirect happens inside githubService.connect()
    } catch (err) {
      console.error('[ConnectGitHubCard] Connect error:', err?.message);
      console.error('[ConnectGitHubCard] Connect error response:', err?.response?.data);
      toast.error(
        err?.response?.data?.error ||
        "Failed to start GitHub connection"
      );
      setLoginLoading(false);
    }
  };

  if (githubConnected) {
    return (
      <ConnectedView
        username={githubUsername}
        avatar={githubAvatar}
      />
    );
  }

  return (
    <>
      <NotConnectedView
        onConnect={() => setIsConnectModalOpen(true)}
        loading={loginLoading}
      />

      <ConnectGithubModal
        isOpen={isConnectModalOpen && !hasConnectedOnce}
        onClose={() => setIsConnectModalOpen(false)}
        onContinue={handleConnect}
        loading={loginLoading}
      />
    </>
  );
};

export default ConnectGitHubCard;