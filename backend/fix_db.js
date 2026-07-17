import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fix() {
  const { data, error } = await supabaseAdmin.from('reviews').select('*');
  if (error) {
    console.error('Error fetching:', error);
    return;
  }
  
  let count = 0;
  for (const review of data) {
    if (review.report_json) {
      let reportStr = typeof review.report_json === 'string' ? review.report_json : JSON.stringify(review.report_json);
      if (reportStr.includes('Review could not be completed')) {
        console.log(`Deleting broken review ${review.id} created at ${review.created_at}`);
        await supabaseAdmin.from('reviews').delete().eq('id', review.id);
        count++;
      }
    }
  }
  console.log(`Done. Deleted ${count} broken reviews.`);
}

fix();
