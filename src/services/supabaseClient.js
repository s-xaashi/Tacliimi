import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm';

// TODO: Replace with actual project URL and Anon Key from Supabase Dashboard
const supabaseUrl = 'https://jboruccxbgdqntrggslz.supabase.co';
const supabaseKey = 'sb_publishable_a8VrPRpRhukaEnyXRfDJqw_-ZuofwAs';

export const supabase = createClient(supabaseUrl, supabaseKey);

// Automatically purge invalid or revoked auth tokens if refresh fails
supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || (!session && (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION'))) {
        try {
            Object.keys(localStorage).forEach(key => {
                if (key.includes('auth-token') || (key.startsWith('sb-') && key.endsWith('-token'))) {
                    localStorage.removeItem(key);
                }
            });
        } catch (e) {}
    }
});
