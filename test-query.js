import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: 'c:\\Users\\salmaan\\.gemini\\antigravity\\Tacliimi\\.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    const { data: updateOffers, error } = await supabase
        .from('course_update_offers')
        .select(`
            *,
            to_course:courses!to_version_id(id, version_number),
            coupon:course_coupons(*)
        `)
        .limit(10);
        
    console.log(error || updateOffers);
}

test();
