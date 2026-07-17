import './src/env.js';
import { supabaseAdmin } from './src/config/supabase.js';

async function checkRepo() {
  const { data, error } = await supabaseAdmin
    .from('repositories')
    .select('id, full_name, github_repo_id');
  console.log(data);
}

checkRepo();
