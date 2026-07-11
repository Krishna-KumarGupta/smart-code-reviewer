/**
 * AdminRoute Layout
 *
 * Guards routes that require admin role.
 * - Shows LoadingScreen while session or profile is loading
 * - Redirects unauthenticated users to "/"
 * - Redirects authenticated non-admin users to "/home"
 * - Renders <Outlet /> for admin users
 *
 * Note: DashboardLayout is composed on top of this in App.jsx.
 */

import { Navigate, Outlet } from 'react-router-dom';
import useAuth from '../hooks/useAuth.js';
import LoadingScreen from '../components/ui/LoadingScreen.jsx';

const AdminRoute = () => {
  const { user, profile, loading } = useAuth();

  // Wait for both session and profile to load
  if (loading)              return <LoadingScreen message="Verifying permissions..." color="accent" />;
  if (!user)                return <Navigate to="/" replace />;
  if (!profile)             return <LoadingScreen message="Loading profile..." color="accent" />;
  if (profile.role !== 'admin') return <Navigate to="/home" replace />;

  return <Outlet />;
};

export default AdminRoute;
