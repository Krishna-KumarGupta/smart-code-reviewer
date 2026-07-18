/**
 * Sidebar Component
 * Left navigation panel used inside DashboardLayout.
 * Role-based navigation items + bottom utility links.
 */

import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  RiCodeSSlashLine,
  RiHomeLine,
  RiHistoryLine,
  RiShieldLine,
  RiGithubLine,
  RiSettingsLine,
  RiLogoutBoxRLine,
} from 'react-icons/ri';
import useAuth from '../../hooks/useAuth.js';

const NavItem = ({ path, label, icon, disabled = false }) => {
  const location = useLocation();
  const isActive = location.pathname === path;

  if (disabled) {
    return (
      <span className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-text-muted opacity-40 cursor-not-allowed">
        {icon}
        {label}
      </span>
    );
  }

  return (
    <Link
      to={path}
      className={`
        relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
        transition-all duration-200
        ${isActive
          ? 'text-primary bg-primary/10'
          : 'text-text-muted hover:text-text-primary hover:bg-surface-2'
        }
      `}
    >
      {isActive && (
        <motion.div
          layoutId="sidebar-indicator"
          className="absolute inset-0 rounded-xl bg-primary/10"
          style={{ zIndex: -1 }}
        />
      )}
      <span className={`text-lg ${isActive ? 'text-primary' : ''}`}>{icon}</span>
      {label}
    </Link>
  );
};

const Sidebar = () => {
  const { isAdmin, profile, logout } = useAuth();

  const userNav = [
    { path: '/home',     label: 'Dashboard',   icon: <RiHomeLine /> },
    { path: '/history',  label: 'Review History', icon: <RiHistoryLine /> },
    { path: '/repos',    label: 'Repositories', icon: <RiGithubLine /> },
  ];

  const adminNav = [
    { path: '/admin', label: 'Admin Panel', icon: <RiShieldLine /> },
  ];

  const mainNav = isAdmin ? adminNav : userNav;

  const bottomNav = [
    { path: '/settings', label: 'Settings', icon: <RiSettingsLine /> },
  ];

  return (
    <aside className="w-64 h-full border-r border-border bg-surface flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-glow shrink-0">
            <RiCodeSSlashLine className="text-white text-base" />
          </div>
          <div>
            <p className="font-bold text-text-primary text-sm leading-tight">SmartReview</p>
            <p className="text-xs text-text-muted">AI PR Reviewer</p>
          </div>
        </div>
      </div>

      {/* Main Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {mainNav.map((item) => (
          <NavItem key={item.path} {...item} />
        ))}
      </nav>

      {/* User Info */}
      <div className="px-3 py-3 border-t border-border">
        <div className="flex items-center gap-2.5 px-2 mb-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-xs font-bold shrink-0">
            {profile?.full_name?.charAt(0).toUpperCase() || profile?.email?.charAt(0).toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-text-secondary truncate">
              {profile?.full_name || 'User'}
            </p>
            <p className="text-xs text-text-muted truncate">{profile?.email}</p>
          </div>
        </div>

        {/* Bottom links */}
        <div className="space-y-1">
          {bottomNav.map((item) => (
            <NavItem key={item.path} {...item} />
          ))}

          {/* Logout */}
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-error hover:bg-red-500/10 transition-all duration-200"
          >
            <RiLogoutBoxRLine className="text-lg" />
            Logout
          </button>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
