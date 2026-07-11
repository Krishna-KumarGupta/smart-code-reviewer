/**
 * AdminPage — Admin Dashboard
 *
 * Protected by AdminRoute — only accessible to users with role='admin'.
 * Displays system-wide statistics fetched from /api/admin/dashboard.
 * Includes user management placeholder for future implementation.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  RiShieldLine,
  RiGroupLine,
  RiUserAddLine,
  RiAdminLine,
  RiRefreshLine,
  RiCheckboxCircleLine,
} from 'react-icons/ri';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import api from '../services/api.js';

// ─── Stat Card ────────────────────────────────────────────────────────────────
const AdminStatCard = ({ icon, label, value, color, subLabel, delay }) => (
  <motion.div
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.4 }}
    className="glass-card p-6"
  >
    <div className="flex items-start justify-between mb-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl ${color}`}>
        {icon}
      </div>
      <span className="badge badge-success">
        <RiCheckboxCircleLine />
        Live
      </span>
    </div>
    <p className="text-3xl font-bold text-text-primary mb-1">{value ?? '—'}</p>
    <p className="text-sm font-medium text-text-secondary">{label}</p>
    {subLabel && <p className="text-xs text-text-muted mt-0.5">{subLabel}</p>}
  </motion.div>
);

const AdminPage = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDashboard = async () => {
    try {
      setError(null);
      const { data } = await api.get('/api/admin/dashboard');
      setStats(data.data);
    } catch (err) {
      console.error('[AdminPage] Fetch error:', err);
      setError(err.response?.data?.error || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchDashboard();
  };

  return (
    <div className="min-h-full">

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Page Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex items-start justify-between mb-8"
        >
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                <RiShieldLine className="text-accent text-sm" />
              </div>
              <h1 className="text-2xl font-bold text-text-primary">Admin Dashboard</h1>
            </div>
            <p className="text-text-muted text-sm ml-11">
              System-wide statistics and user management.
            </p>
          </div>

          <Button
            variant="secondary"
            onClick={handleRefresh}
            loading={refreshing}
            className="shrink-0"
          >
            <RiRefreshLine className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </Button>
        </motion.div>

        {/* Error State */}
        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mb-6 px-5 py-4 rounded-xl bg-error/10 border border-error/20 text-sm text-error"
          >
            ⚠ {error}
          </motion.div>
        )}

        {/* Stats Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="glass-card p-6 animate-pulse">
                <div className="w-12 h-12 rounded-xl bg-surface-2 mb-4" />
                <div className="h-8 bg-surface-2 rounded w-1/2 mb-2" />
                <div className="h-4 bg-surface-2 rounded w-3/4" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <AdminStatCard
              icon={<RiGroupLine />}
              label="Total Users"
              value={stats?.stats?.totalUsers}
              color="bg-primary/10 text-primary"
              subLabel="Registered accounts"
              delay={0.1}
            />
            <AdminStatCard
              icon={<RiUserAddLine />}
              label="New This Week"
              value={stats?.stats?.newUsersThisWeek}
              color="bg-success/10 text-success"
              subLabel="Last 7 days"
              delay={0.15}
            />
            <AdminStatCard
              icon={<RiAdminLine />}
              label="Admins"
              value={stats?.stats?.adminCount}
              color="bg-accent/10 text-accent"
              subLabel="Admin users"
              delay={0.2}
            />
            <AdminStatCard
              icon={<RiGroupLine />}
              label="Regular Users"
              value={stats?.stats?.regularUsers}
              color="bg-warning/10 text-warning"
              subLabel="Role = user"
              delay={0.25}
            />
          </div>
        )}

        {/* User Management Placeholder */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.4 }}
        >
          <Card
            title="User Management"
            subtitle="View and manage all registered users"
            glass
          >
            <div className="flex flex-col items-center text-center py-10 px-4">
              <div className="w-14 h-14 rounded-2xl bg-surface-2 border border-border-light flex items-center justify-center mb-4">
                <RiGroupLine className="text-2xl text-text-muted" />
              </div>
              <h3 className="text-base font-semibold text-text-primary mb-2">
                User Management Panel
              </h3>
              <p className="text-sm text-text-muted max-w-sm leading-relaxed mb-4">
                Full user management including role assignment, account suspension,
                and audit logs will be available in the next release.
              </p>
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-surface-2 border border-border text-xs text-text-muted">
                <span className="w-2 h-2 rounded-full bg-accent animate-pulse-slow" />
                Coming in Phase 2
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Admin Info */}
        {stats?.admin && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mt-4 px-4 py-3 rounded-xl bg-surface border border-border text-xs text-text-muted"
          >
            Logged in as admin: <span className="text-text-secondary">{stats.admin.email}</span>
            {' · '}
            Last refreshed: <span className="text-text-secondary">{new Date(stats.timestamp).toLocaleTimeString()}</span>
          </motion.div>
        )}

      </main>
    </div>
  );
};

export default AdminPage;
