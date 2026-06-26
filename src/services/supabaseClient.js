import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm';

// TODO: Replace with actual project URL and Anon Key from Supabase Dashboard
const supabaseUrl = 'https://jboruccxbgdqntrggslz.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impib3J1Y2N4YmdkcW50cmdnc2x6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NjYzMzQsImV4cCI6MjA4ODU0MjMzNH0.cL5gA73bHs1bR_fg3FsiwP5mI24LeN3wSCtWw3Rn_QQ';

export const supabase = createClient(supabaseUrl, supabaseKey);
