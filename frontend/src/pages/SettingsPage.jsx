/**
 * SettingsPage — User Settings
 *
 * Protected user page — placeholder for Phase 2.
 * Will allow users to update profile, manage notifications,
 * configure GitHub integration, and manage API keys.
 */

import { motion } from 'framer-motion';
import {
  RiSettingsLine,
  RiUserLine,
  RiNotificationLine,
  RiGithubLine,
  RiShieldKeyholeLine,
} from 'react-icons/ri';
import useAuth from '../hooks/useAuth.js';
import Card from '../components/ui/Card.jsx';

// ─── Settings Section Card ────────────────────────────────────────────────────
const SettingSection = ({ icon, title, description, badge, delay }) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.4 }}
  >
    <Card glass>
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-surface-2 border border-border flex items-center justify-center text-lg text-text-muted shrink-0">
          {icon}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
            {badge && (
              <span className="px-2 py-0.5 rounded-full bg-surface-2 border border-border text-xs text-text-muted">
                {badge}
              </span>
            )}
          </div>
          <p className="text-xs text-text-muted leading-relaxed">{description}</p>
        </div>
        <button
          disabled
          className="px-3 py-1.5 rounded-lg bg-surface-2 border border-border text-xs text-text-muted cursor-not-allowed opacity-50"
        >
          Configure
        </button>
      </div>
    </Card>
  </motion.div>
);

const SettingsPage = () => {
  const { profile } = useAuth();

  return (
    <div className="min-h-full">
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Page Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8"
        >
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <RiSettingsLine className="text-primary text-sm" />
            </div>
            <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
          </div>
          <p className="text-text-muted text-sm ml-11">
            Manage your account, integrations, and preferences.
          </p>
        </motion.div>

        {/* Profile Card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.4 }}
          className="mb-4"
        >
          <Card title="Profile" glass>
            <div className="flex items-center gap-4 py-2">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white font-bold text-lg shrink-0">
                {profile?.full_name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text-primary">{profile?.full_name || '—'}</p>
                <p className="text-xs text-text-muted">{profile?.email}</p>
                <p className="text-xs text-text-muted mt-0.5">
                  Member since {profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : '—'}
                </p>
              </div>
              <button
                disabled
                className="px-3 py-1.5 rounded-lg bg-surface-2 border border-border text-xs text-text-muted cursor-not-allowed opacity-50"
              >
                Edit
              </button>
            </div>
          </Card>
        </motion.div>

        {/* Settings Sections */}
        <div className="space-y-3">
          <SettingSection
            icon={<RiUserLine />}
            title="Account Settings"
            description="Update your display name, email address, and avatar."
            delay={0.1}
          />
          <SettingSection
            icon={<RiNotificationLine />}
            title="Notifications"
            description="Configure email and in-app notifications for review events."
            badge="Coming soon"
            delay={0.15}
          />
          <SettingSection
            icon={<RiGithubLine />}
            title="GitHub Integration"
            description="Connect your GitHub account and manage installed repositories."
            badge="Phase 2"
            delay={0.2}
          />
          <SettingSection
            icon={<RiShieldKeyholeLine />}
            title="Security"
            description="Manage password, active sessions, and two-factor authentication."
            badge="Coming soon"
            delay={0.25}
          />
        </div>

      </main>
    </div>
  );
};

export default SettingsPage;
