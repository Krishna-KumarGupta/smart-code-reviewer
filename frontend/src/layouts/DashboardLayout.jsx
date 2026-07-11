/**
 * DashboardLayout
 *
 * Shared layout for all authenticated dashboard pages.
 * Renders: Navbar (top) + Sidebar (left, desktop) + <Outlet /> (content)
 *
 * Used by:
 *   - /home     → HomePage
 *   - /history  → HistoryPage
 *   - /admin    → AdminPage
 *   - /repos    → RepositoriesPage
 *   - /settings → SettingsPage
 *
 * The Outlet renders the matched child route's page component.
 * Pages should NOT include their own <Navbar /> — the layout handles it.
 */

import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { RiMenuLine, RiCloseLine } from 'react-icons/ri';
import Navbar from '../components/layout/Navbar.jsx';
import Sidebar from '../components/layout/Sidebar.jsx';

const DashboardLayout = () => {
  // Mobile sidebar open/close state
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background bg-grid flex flex-col">
      {/* ── Top Navbar ───────────────────────────────────────────────────── */}
      <Navbar onMenuToggle={() => setMobileSidebarOpen((v) => !v)} />

      <div className="flex flex-1 overflow-hidden">
        {/* ── Desktop Sidebar (hidden on mobile) ───────────────────────── */}
        <div className="hidden lg:block shrink-0">
          <Sidebar />
        </div>

        {/* ── Mobile Sidebar Overlay ────────────────────────────────────── */}
        <AnimatePresence>
          {mobileSidebarOpen && (
            <>
              {/* Backdrop */}
              <motion.div
                key="backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
                onClick={() => setMobileSidebarOpen(false)}
              />

              {/* Sidebar panel */}
              <motion.div
                key="sidebar"
                initial={{ x: -280 }}
                animate={{ x: 0 }}
                exit={{ x: -280 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className="fixed left-0 top-0 h-full z-50 lg:hidden"
              >
                {/* Close button */}
                <button
                  onClick={() => setMobileSidebarOpen(false)}
                  className="
                    absolute top-4 right-[-44px] z-50
                    w-9 h-9 rounded-lg
                    bg-surface border border-border
                    flex items-center justify-center
                    text-text-muted hover:text-text-primary
                    transition-colors
                  "
                  aria-label="Close sidebar"
                >
                  <RiCloseLine className="text-lg" />
                </button>
                <Sidebar />
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* ── Main Content ──────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
