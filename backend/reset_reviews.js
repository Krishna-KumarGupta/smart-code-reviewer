import './src/env.js';
import { supabaseAdmin } from './src/config/supabase.js';

async function resetPendingReviews() {
  console.log('Resetting stuck pending/processing reviews...');
  const { data, error } = await supabaseAdmin
    .from('reviews')
    .update({ 
      status: 'failed', 
      error: 'Manually reset because task was stuck in queue during Redis outage' 
    })
    .in('status', ['pending', 'processing', 'queued', 'running'])
    .select('id, pr_number');

  if (error) {
    console.error('Error resetting reviews:', error);
  } else {
    console.log(`Successfully reset ${data.length} reviews.`);
    console.table(data);
  }
}

resetPendingReviews();
