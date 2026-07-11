/**
 * Supabase Client
 * Single instance — import this wherever Supabase access is needed.
 * Uses environment variables so credentials are never hardcoded.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env'
  );
}

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Automatically persist session in localStorage
    persistSession: true,
    // Automatically refresh the token before it expires
    autoRefreshToken: true,
    // Detect OAuth redirects (needed for future GitHub OAuth)
    detectSessionInUrl: true,
  },
});

export default supabase;
