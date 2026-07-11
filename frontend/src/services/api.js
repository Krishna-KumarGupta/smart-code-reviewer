/**
 * API Service
 * Axios instance that auto-attaches the Supabase JWT to every request.
 * Use this for all backend API calls.
 */

import axios from 'axios';
import supabase from './supabase.js';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000',
  headers: {
    'Content-Type': 'application/json',
  },
});

// ─── Request Interceptor — attach JWT ─────────────────────────────────────────
api.interceptors.request.use(
  async (config) => {
    // Get the current session's access token from Supabase
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.access_token) {
      config.headers.Authorization = `Bearer ${session.access_token}`;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// ─── Response Interceptor — handle auth errors ────────────────────────────────
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // If 401 from backend, session may be expired — sign out
    if (error.response?.status === 401) {
      await supabase.auth.signOut();
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

export default api;
