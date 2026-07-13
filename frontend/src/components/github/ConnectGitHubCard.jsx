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
  RiQuestionLine,
} from "react-icons/ri";

import useAuth from "../../hooks/useAuth.js";
import githubService from "../../services/githubService.js";
import GitHubStatus from "./GitHubStatus.jsx";
import DisconnectGitHubButton from "./DisconnectGitHubButton.jsx";
import Modal from "../ui/Modal.jsx";

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

const NotConnectedView = ({ onConnect, loading, onOpenHelp }) => (
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

    <button
      type="button"
      onClick={onOpenHelp}
      className="inline-flex items-center gap-2 text-sm font-medium text-primary transition hover:text-accent"
    >
      <RiQuestionLine />
      Need help connecting a different GitHub account?
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
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);

  useEffect(() => {
    const githubParam = searchParams.get("github");

    if (!githubParam) return;

    if (githubParam === "connected") {
      refreshGitHubStatus().then(() => {
        toast.success("🎉 GitHub account connected!", {
          duration: 5000,
        });
      });
    } else if (githubParam === "denied") {
      toast("GitHub connection cancelled", {
        icon: "ℹ️",
      });
    } else if (githubParam === "error") {
      const reason = searchParams.get("reason") || "unknown";

      toast.error(
        `GitHub connection failed (${reason}). Please try again.`
      );
    }

    setSearchParams((prev) => {
      prev.delete("github");
      prev.delete("reason");
      return prev;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnect = async () => {
    setLoginLoading(true);

    try {
      await githubService.connect();
      // Redirect happens automatically
    } catch (err) {
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
        onConnect={handleConnect}
        loading={loginLoading}
        onOpenHelp={() => setIsHelpModalOpen(true)}
      />

      <Modal
        isOpen={isHelpModalOpen}
        onClose={() => setIsHelpModalOpen(false)}
        title="Connect a different GitHub account"
        maxWidth="max-w-xl"
      >
        <div className="space-y-5">
          <p className="text-sm leading-6 text-text-muted">
            GitHub uses the account currently signed in to github.com in this browser.
          </p>

          <div className="rounded-2xl border border-border bg-surface-2 p-4 text-sm text-text-muted">
            <ol className="list-decimal space-y-2 pl-5">
              <li>If you&apos;re already connected in this app, disconnect your GitHub account first.</li>
              <li>Switch GitHub accounts on github.com, or sign out and sign back in with the desired account.</li>
              <li>Return to this app and click &quot;Connect GitHub&quot; again.</li>
            </ol>
          </div>

          <p className="text-sm leading-6 text-text-muted">
            Alternative: use a Private/Incognito window and sign in to the GitHub account you want to connect.
          </p>

          <p className="text-sm leading-6 text-text-muted">
            Disconnecting from this application does not sign you out of GitHub. It only removes the connection between this application and your GitHub account.
          </p>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setIsHelpModalOpen(false)}
              className="rounded-xl bg-gradient-to-r from-primary to-accent px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default ConnectGitHubCard;