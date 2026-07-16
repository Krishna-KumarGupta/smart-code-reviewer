import './src/env.js';
import { supabaseAdmin } from './src/config/supabase.js';

async function queryReviews() {
  const { data, error } = await supabaseAdmin
    .from('reviews')
    .select('id, pr_number, status, error, updated_at, report_json')
    .eq('pr_number', 1)
    .order('updated_at', { ascending: false });
  console.log('Reviews for PR #1:');
  console.log(JSON.stringify(data, null, 2));
}

queryReviews();
