/**
 * ProtectedRoute Layout
 *
 * Guards routes that require authentication.
 * - Shows LoadingScreen while session is being restored
 * - Redirects unauthenticated users to "/"
 * - Renders <Outlet /> for authenticated users
 *
 * Note: DashboardLayout is composed on top of this in App.jsx.
 * ProtectedRoute handles auth; DashboardLayout handles the UI shell.
 */

import { Navigate, Outlet } from 'react-router-dom';
import useAuth from '../hooks/useAuth.js';
import LoadingScreen from '../components/ui/LoadingScreen.jsx';

const ProtectedRoute = () => {
  const { user, loading } = useAuth();

  if (loading) return <LoadingScreen message="Restoring session..." />;
  if (!user)   return <Navigate to="/" replace />;

  return <Outlet />;
};

export default ProtectedRoute;
