const supabaseUrl = 'https://jboruccxbgdqntrggslz.supabase.co';
const supabaseKey = 'sb_publishable_a8VrPRpRhukaEnyXRfDJqw_-ZuofwAs';

async function queryTable(tableName, params = '') {
  const response = await fetch(`${supabaseUrl}/rest/v1/${tableName}?${params}`, {
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to query ${tableName}: ${response.statusText}`);
  }
  return response.json();
}

async function test() {
  try {
    console.log('Querying payout_methods for column...');
    const result = await queryTable('payout_methods', 'select=phone_cash_on_delivery&limit=1');
    console.log('payout_methods Select Result:', JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('Error:', e);
  }
}

test();
