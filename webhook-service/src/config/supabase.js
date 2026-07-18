import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    '[Config] Missing Supabase env vars. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env'
  );
}

export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export default supabaseAdmin;
