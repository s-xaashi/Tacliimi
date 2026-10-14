import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm';

// TODO: Replace with actual project URL and Anon Key from Supabase Dashboard
const supabaseUrl = 'https://jboruccxbgdqntrggslz.supabase.co';
const supabaseKey = 'sb_publishable_a8VrPRpRhukaEnyXRfDJqw_-ZuofwAs';

export const supabase = createClient(supabaseUrl, supabaseKey);

// Supabase manages its own persisted auth session and refresh-token lifecycle.
// Do not broadly delete auth storage during INITIAL_SESSION or TOKEN_REFRESHED events.
