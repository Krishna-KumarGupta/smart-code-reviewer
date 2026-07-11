/**
 * Navbar Component
 * Top navigation bar with logo, role-based nav items, user info, and logout.
 * Receives onMenuToggle from DashboardLayout for mobile sidebar control.
 *
 * Props:
 *   onMenuToggle : function — called when hamburger button is clicked (mobile)
 */

import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  RiCodeSSlashLine,
  RiHistoryLine,
  RiShieldLine,
  RiHomeLine,
  RiLogoutBoxRLine,
  RiGithubLine,
  RiSettingsLine,
  RiMenuLine,
} from 'react-icons/ri';
import useAuth from '../../hooks/useAuth.js';

const Navbar = ({ onMenuToggle }) => {
  const { profile, logout, isAdmin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  // Role-based nav links
  const navItems = isAdmin
    ? [{ path: '/admin', label: 'Dashboard', icon: <RiShieldLine /> }]
    : [
        { path: '/home',    label: 'Dashboard', icon: <RiHomeLine /> },
        { path: '/history', label: 'History',   icon: <RiHistoryLine /> },
        { path: '/repos',   label: 'Repos',     icon: <RiGithubLine />, disabled: true },
      ];

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-surface/80 backdrop-blur-xl">
      <div className="max-w-full px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">

          {/* Left: Hamburger (mobile) + Logo */}
          <div className="flex items-center gap-3">
            {/* Mobile hamburger — only shown if handler provided */}
            {onMenuToggle && (
              <button
                onClick={onMenuToggle}
                id="mobile-menu-btn"
                className="lg:hidden p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
                aria-label="Toggle navigation"
              >
                <RiMenuLine className="text-xl" />
              </button>
            )}

            {/* Logo */}
            <Link
              to={isAdmin ? '/admin' : '/home'}
              className="flex items-center gap-2.5 group"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-glow">
                <RiCodeSSlashLine className="text-white text-sm" />
              </div>
              <span className="font-bold text-text-primary group-hover:gradient-text transition-all hidden sm:block">
                SmartReview
              </span>
            </Link>
          </div>

          {/* Center: Nav Items (desktop only) */}
          <div className="hidden lg:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return item.disabled ? (
                <span
                  key={item.path}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium text-text-muted opacity-40 cursor-not-allowed"
                >
                  {item.icon}
                  {item.label}
                </span>
              ) : (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`
                    relative flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium
                    transition-all duration-200
                    ${isActive
                      ? 'text-primary bg-primary/10'
                      : 'text-text-muted hover:text-text-primary hover:bg-surface-2'
                    }
                  `}
                >
                  {item.icon}
                  {item.label}
                  {isActive && (
                    <motion.div
                      layoutId="nav-indicator"
                      className="absolute inset-0 rounded-lg bg-primary/10"
                      style={{ zIndex: -1 }}
                    />
                  )}
                </Link>
              );
            })}
          </div>

          {/* Right: Badge + Avatar + Logout */}
          <div className="flex items-center gap-3">
            {/* Role Badge */}
            {profile?.role === 'admin' ? (
              <span className="badge badge-admin hidden sm:inline-flex">
                <RiShieldLine />
                Admin
              </span>
            ) : (
              <span className="badge badge-primary hidden sm:inline-flex">User</span>
            )}

            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-xs font-bold shrink-0">
              {profile?.full_name?.charAt(0).toUpperCase()
                || profile?.email?.charAt(0).toUpperCase()
                || 'U'}
            </div>

            {/* Name (desktop) */}
            <span className="hidden md:block text-sm text-text-secondary font-medium max-w-[120px] truncate">
              {profile?.full_name || profile?.email || 'User'}
            </span>

            {/* Settings (desktop) */}
            <Link
              to="/settings"
              className="hidden sm:flex items-center p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-2 transition-all"
              title="Settings"
            >
              <RiSettingsLine className="text-base" />
            </Link>

            {/* Logout */}
            <button
              onClick={handleLogout}
              id="logout-btn"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-text-muted hover:text-error hover:bg-red-500/10 transition-all duration-200"
              title="Logout"
            >
              <RiLogoutBoxRLine className="text-base" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>

        </div>
      </div>
    </nav>
  );
};

export default Navbar;
