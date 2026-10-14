import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm';

// TODO: Replace with actual project URL and Anon Key from Supabase Dashboard
const supabaseUrl = 'https://jboruccxbgdqntrggslz.supabase.co';
const supabaseKey = 'sb_publishable_a8VrPRpRhukaEnyXRfDJqw_-ZuofwAs';

// Keep one Auth client per browser context, even if this module is evaluated
// through more than one URL/import path. Separate GoTrue clients sharing the
// same localStorage key can race during session restoration and refresh.
const clientGlobalKey = '__tacliimiSupabaseClient';
const existingClient = globalThis[clientGlobalKey];

export const supabase = existingClient || (globalThis[clientGlobalKey] = createClient(
    supabaseUrl,
    supabaseKey,
    {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    }
));

// Supabase manages its own persisted auth session and refresh-token lifecycle.
// Do not broadly delete auth storage during INITIAL_SESSION or TOKEN_REFRESHED events.
