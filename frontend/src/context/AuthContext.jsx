/**
 * AuthContext
 *
 * Provides authentication state and actions to the entire application.
 * Wraps the app with AuthProvider to make user, profile, and auth
 * functions available anywhere via the useAuth hook.
 *
 * State:
 *   - user          : Supabase auth user object (or null)
 *   - profile       : Row from the profiles table (includes role)
 *   - loading       : true while session is being restored on first load
 *   - authError     : Last auth error message (or null)
 *
 * Actions:
 *   - login(email, password)
 *   - register(fullName, email, password)
 *   - logout()
 *   - refreshProfile()        ← re-fetches profile from DB
 *   - updateProfile(data)     ← updates profile in DB + refreshes state
 *
 * Computed:
 *   - isAuthenticated : boolean
 *   - isAdmin         : boolean
 *   - isUser          : boolean
 */

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

import supabase from '../services/supabase.js';

// ─── Create Context ────────────────────────────────────────────────────────────
export const AuthContext = createContext(null);

// ─── AuthProvider ──────────────────────────────────────────────────────────────
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  // ─── Fetch Profile Row ────────────────────────────────────────────────────
  /**
   * Fetch the profiles row for a given user ID.
   * Includes all columns — role, github_username, github_connected, etc.
   */
  const fetchProfile = useCallback(async (userId) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('[AuthContext] Profile fetch error:', error.message);
        return null;
      }
      return data;
    } catch (err) {
      console.error('[AuthContext] Unexpected profile error:', err.message);
      return null;
    }
  }, []);

  // ─── Restore Session on Mount ─────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    const initSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (mounted && session?.user) {
          setUser(session.user);
          const profileData = await fetchProfile(session.user.id);
          if (mounted) setProfile(profileData);
        }
      } catch (err) {
        console.error('[AuthContext] Session restore error:', err.message);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    initSession();

    // ─── Listen for Auth State Changes ────────────────────────────────────
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;

        if (session?.user) {
          setUser(session.user);
          const profileData = await fetchProfile(session.user.id);
          if (mounted) setProfile(profileData);
        } else {
          setUser(null);
          setProfile(null);
        }

        if (event === 'INITIAL_SESSION') {
          setLoading(false);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  // ─── Login ────────────────────────────────────────────────────────────────
  const login = async (email, password) => {
    setAuthError(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        const message = error.message || 'Login failed. Please try again.';
        setAuthError(message);
        return { success: false, error: message };
      }

      return { success: true, user: data.user };
    } catch (err) {
      const message = 'An unexpected error occurred. Please try again.';
      setAuthError(message);
      return { success: false, error: message };
    }
  };

  // ─── Register ─────────────────────────────────────────────────────────────
  const register = async (fullName, email, password) => {
    setAuthError(null);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
          },
        },
      });

      if (error) {
        const message = error.message || 'Registration failed. Please try again.';
        setAuthError(message);
        return { success: false, error: message };
      }

      if (data.session) {
        return { success: true, user: data.user, requiresConfirmation: false };
      } else {
        return { success: true, user: data.user, requiresConfirmation: true };
      }
    } catch (err) {
      const message = 'An unexpected error occurred. Please try again.';
      setAuthError(message);
      return { success: false, error: message };
    }
  };

  // ─── Logout ───────────────────────────────────────────────────────────────
  const logout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('[AuthContext] Logout error:', error.message);
      }
      // State cleared by onAuthStateChange listener → redirect handled by ProtectedRoute
    } catch (err) {
      console.error('[AuthContext] Logout error:', err.message);
    }
  };

  // ─── refreshProfile ───────────────────────────────────────────────────────
  /**
   * Manually re-fetch the profile from Supabase and update state.
   * Call this after any operation that modifies the profiles table
   * (e.g., GitHub connection, avatar upload, role change).
   *
   * @returns {Promise<object|null>} The refreshed profile, or null on error
   */
  const refreshProfile = useCallback(async () => {
    if (!user?.id) return null;
    const profileData = await fetchProfile(user.id);
    setProfile(profileData);
    return profileData;
  }, [user, fetchProfile]);

  // ─── updateProfile ────────────────────────────────────────────────────────
  /**
   * Update allowed profile fields (full_name, avatar_url, github_username)
   * directly via Supabase and refresh the local state.
   *
   * Does NOT allow role changes — those are backend/SQL only.
   *
   * @param {object} updates - { full_name?, avatar_url?, github_username? }
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  const updateProfile = useCallback(async (updates) => {
    if (!user?.id) return { success: false, error: 'Not authenticated' };

    // Whitelist safe fields only — never allow role
    const safeUpdates = {};
    if (updates.full_name !== undefined) safeUpdates.full_name = updates.full_name;
    if (updates.avatar_url !== undefined) safeUpdates.avatar_url = updates.avatar_url;
    if (updates.github_username !== undefined) safeUpdates.github_username = updates.github_username;

    if (Object.keys(safeUpdates).length === 0) {
      return { success: false, error: 'No valid fields to update' };
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .update(safeUpdates)
        .eq('id', user.id)
        .select('*')
        .single();

      if (error) {
        return { success: false, error: error.message };
      }

      setProfile(data);
      return { success: true, profile: data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, [user]);

  // ─── Context Value ────────────────────────────────────────────────────────
  const value = {
    // State
    user,
    profile,
    loading,
    authError,

    // Computed
    isAuthenticated: !!user,
    isAdmin: profile?.role === 'admin',
    isUser: profile?.role === 'user',

    // Auth Actions
    login,
    register,
    logout,

    // Profile Actions
    refreshProfile,
    updateProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthProvider;
