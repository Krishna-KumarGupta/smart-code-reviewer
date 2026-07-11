/**
 * App.jsx — Root Application Router
 *
 * Route structure:
 *
 *  /                     → AuthPage  (public — redirects if already logged in)
 *
 *  ProtectedRoute        (auth guard — redirects to / if not logged in)
 *   └─ DashboardLayout   (Navbar + Sidebar + Outlet shell)
 *       ├─ /home         → HomePage
 *       ├─ /history      → HistoryPage
 *       ├─ /repos        → RepositoriesPage
 *       └─ /settings     → SettingsPage
 *
 *  AdminRoute            (auth + admin role guard — redirects to /home if not admin)
 *   └─ DashboardLayout
 *       └─ /admin        → AdminPage
 *
 *  *                     → NotFoundPage
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

import AuthProvider     from './context/AuthContext.jsx';
import ProtectedRoute   from './layouts/ProtectedRoute.jsx';
import AdminRoute       from './layouts/AdminRoute.jsx';
import DashboardLayout  from './layouts/DashboardLayout.jsx';
import ErrorBoundary    from './components/ui/ErrorBoundary.jsx';

import AuthPage           from './pages/AuthPage.jsx';
import HomePage           from './pages/HomePage.jsx';
import HistoryPage        from './pages/HistoryPage.jsx';
import AdminPage          from './pages/AdminPage.jsx';
import RepositoriesPage   from './pages/RepositoriesPage.jsx';
import SettingsPage       from './pages/SettingsPage.jsx';
import NotFoundPage       from './pages/NotFoundPage.jsx';

// ─── Toast Config ─────────────────────────────────────────────────────────────
const toastOptions = {
  duration: 4000,
  style: {
    background: '#12121a',
    color: '#f1f5f9',
    border: '1px solid #1e1e2e',
    borderRadius: '12px',
    fontSize: '14px',
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  success: {
    iconTheme: { primary: '#22c55e', secondary: '#12121a' },
  },
  error: {
    iconTheme: { primary: '#ef4444', secondary: '#12121a' },
  },
};

const App = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        {/* Global Toast Notifications */}
        <Toaster position="top-right" toastOptions={toastOptions} />

        {/* Global Error Boundary wraps all routes */}
        <ErrorBoundary>
          <Routes>
            {/* ── Public ──────────────────────────────────────────────── */}
            <Route path="/" element={<AuthPage />} />

            {/* ── Protected: any authenticated user ───────────────────── */}
            <Route element={<ProtectedRoute />}>
              <Route element={<DashboardLayout />}>
                <Route path="/home"     element={<HomePage />} />
                <Route path="/history"  element={<HistoryPage />} />
                <Route path="/repos"    element={<RepositoriesPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
            </Route>

            {/* ── Admin-Only ──────────────────────────────────────────── */}
            <Route element={<AdminRoute />}>
              <Route element={<DashboardLayout />}>
                <Route path="/admin" element={<AdminPage />} />
              </Route>
            </Route>

            {/* ── 404 ────────────────────────────────────────────────── */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
