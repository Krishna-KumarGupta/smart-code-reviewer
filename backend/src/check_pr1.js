import './env.js';
import { supabaseAdmin } from './config/supabase.js';

async function check() {
  const { data } = await supabaseAdmin.from('reviews').select('id, pr_number, status, report_json, error').eq('pr_number', 1);
  console.log(JSON.stringify(data, null, 2));
}
check();
