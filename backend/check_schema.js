import 'dotenv/config';
import { supabaseAdmin } from './src/config/supabase.js';

async function check() {
  console.log('Checking database table structures...');
  const { data: cols, error: colError } = await supabaseAdmin.rpc('get_table_columns', { table_name: 'reviews' });
  if (colError) {
    // If rpc not available, let's try direct query or just fetch one row
    console.log('RPC get_table_columns not available, attempting select of 1 row.');
    const { data: row, error: rowError } = await supabaseAdmin
      .from('reviews')
      .select('*')
      .limit(1);
    if (rowError) {
      console.error('Error fetching review row:', rowError);
    } else {
      console.log('Sample row keys:', row && row[0] ? Object.keys(row[0]) : 'No rows found');
      console.log('Sample row data:', JSON.stringify(row && row[0]));
    }
  } else {
    console.log('Columns:', cols);
  }
}

check().catch(console.error);
