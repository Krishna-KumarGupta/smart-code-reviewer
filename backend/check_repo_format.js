import './src/env.js';
import { supabaseAdmin } from './src/config/supabase.js';

async function check() {
  const { data: revs } = await supabaseAdmin.from('reviews').select('repo_url').limit(1);
  const { data: repos } = await supabaseAdmin.from('repositories').select('full_name').limit(1);
  console.log('Sample Review repo_url:', revs);
  console.log('Sample Repository full_name:', repos);
}
check();
