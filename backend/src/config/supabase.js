/**
 * Supabase Configuration
 * Exports two Supabase clients:
 *
 *  - supabaseAnon  : uses ANON_KEY   — for JWT verification (public operations)
 *  - supabaseAdmin : uses SERVICE_ROLE_KEY — server-side only, bypasses RLS
 *
 * NEVER expose the SERVICE_ROLE_KEY to the browser.
 */

import { createClient } from '@supabase/supabase-js';

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    '[Config] Missing Supabase env vars. Check SUPABASE_URL, SUPABASE_ANON_KEY, ' +
    'and SUPABASE_SERVICE_ROLE_KEY in .env'
  );
}

/**
 * Anon client — used for token verification only.
 * No session management needed server-side.
 */
export const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Admin client — bypasses Row Level Security.
 * Use for all server-side data queries.
 */
export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export default supabaseAdmin;
