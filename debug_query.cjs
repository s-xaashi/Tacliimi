const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2ZGttdXhwcXVwZXZhbnZiZHB0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2NTU3MTgxNjAsImV4cCI6MTk3MTI5NDE2MH0.2rDq-YyH_zJwO23_C152B_-eXJpS_O1oU9Y72bXZKk';

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data: reviews, error } = await supabase
        .from('mentorship_reviews')
        .select('rating, comment, created_at, student_id, student:profiles!mentorship_reviews_student_id_fkey(id, full_name, avatar_url)');
    console.log("Reviews output:", JSON.stringify(reviews, null, 2));
    if (error) console.log("Error:", error);
}

check();
