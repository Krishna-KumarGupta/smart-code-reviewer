/**
 * GitHubSettingsPage
 *
 * Dedicated settings page for GitHub account connection.
 * Route: /settings/github (ProtectedRoute + DashboardLayout)
 *
 * Shows:
 *  - Page header with back link to /settings
 *  - ConnectGitHubCard (handles both connected and not-connected states)
 *  - Info card explaining what the connection grants
 */

import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  RiGithubLine,
  RiArrowLeftLine,
  RiShieldCheckLine,
  RiCodeSSlashLine,
  RiUserLine,
} from 'react-icons/ri';
import useAuth from '../hooks/useAuth.js';
import Card from '../components/ui/Card.jsx';
import ConnectGitHubCard from '../components/github/ConnectGitHubCard.jsx';
import GitHubStatus from '../components/github/GitHubStatus.jsx';

// ─── Permission Info Item ─────────────────────────────────────────────────────
const PermItem = ({ icon, label, description }) => (
  <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
    <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center text-primary shrink-0 mt-0.5">
      {icon}
    </div>
    <div>
      <p className="text-sm font-medium text-text-primary">{label}</p>
      <p className="text-xs text-text-muted mt-0.5">{description}</p>
    </div>
  </div>
);

// ─── Page ─────────────────────────────────────────────────────────────────────
const GitHubSettingsPage = () => {
  const { githubConnected, githubUsername } = useAuth();

  return (
    <div className="min-h-full">
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Back + Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8"
        >
          <Link
            to="/settings"
            className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-primary transition-colors mb-4"
          >
            <RiArrowLeftLine />
            Back to Settings
          </Link>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <RiGithubLine className="text-primary text-xl" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-text-primary">GitHub Connection</h1>
                <p className="text-sm text-text-muted">
                  {githubConnected
                    ? 'Your GitHub account is linked'
                    : 'Link your GitHub account to enable reviews'}
                </p>
              </div>
            </div>
            {/* Live status badge */}
            <GitHubStatus
              connected={githubConnected}
              username={githubUsername}
              size="sm"
            />
          </div>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* Connection Card */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08, duration: 0.4 }}
            className="lg:col-span-3"
          >
            <Card
              title="GitHub Account"
              subtitle={githubConnected ? `Connected as @${githubUsername}` : 'No account connected'}
              glass
            >
              <ConnectGitHubCard />
            </Card>
          </motion.div>

          {/* Info Sidebar */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.4 }}
            className="lg:col-span-2 space-y-4"
          >
            {/* Permissions */}
            <Card title="What we access" glass padding="sm">
              <div className="pt-1">
                <PermItem
                  icon={<RiUserLine className="text-sm" />}
                  label="Public profile"
                  description="Your GitHub username and avatar"
                />
                <PermItem
                  icon={<RiCodeSSlashLine className="text-sm" />}
                  label="Repository access"
                  description="Read access to repositories you choose (Phase 2)"
                />
                <PermItem
                  icon={<RiShieldCheckLine className="text-sm" />}
                  label="Email address"
                  description="Your primary GitHub email (read-only)"
                />
              </div>
            </Card>

            {/* Security note */}
            <Card glass padding="sm">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <RiShieldCheckLine className="text-emerald-400 text-sm" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary mb-1">Secure Storage</p>
                  <p className="text-xs text-text-muted leading-relaxed">
                    Your OAuth token is encrypted with AES-256-GCM before storage.
                    It is never exposed in API responses.
                  </p>
                </div>
              </div>
            </Card>
          </motion.div>

        </div>
      </main>
    </div>
  );
};

export default GitHubSettingsPage;
