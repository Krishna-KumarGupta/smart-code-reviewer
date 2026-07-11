/**
 * useAuth Hook
 * Thin wrapper around AuthContext for clean, consistent imports.
 *
 * Usage:
 *   const { user, profile, login, logout, register, loading, isAdmin } = useAuth();
 */

import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext.jsx';

const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider. Wrap your app with <AuthProvider>.');
  }

  return context;
};

export default useAuth;
