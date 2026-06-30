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
    console.log('Querying mentor_categories...');
    const categories = await queryTable('mentor_categories', 'order=created_at.desc&limit=10');
    console.log('Recent categories:', JSON.stringify(categories, null, 2));

  } catch (e) {
    console.error('Error:', e);
  }
}

test();
