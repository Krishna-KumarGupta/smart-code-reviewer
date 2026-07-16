import './src/env.js';
import { supabaseAdmin } from './src/config/supabase.js';

async function check() {
  const { data: revs } = await supabaseAdmin.from('reviews').select('id, pr_number, status, error, updated_at').eq('pr_number', 4).order('updated_at', { ascending: false });
  console.log('PR 4 Reviews:', revs);
}
check();
