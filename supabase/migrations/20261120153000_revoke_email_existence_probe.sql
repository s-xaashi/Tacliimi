-- The signup flow no longer needs this public existence probe.
-- Supabase Auth handles signup; the UI now uses neutral responses for duplicate
-- addresses so callers cannot enumerate registered accounts through this RPC.
BEGIN;

REVOKE ALL ON FUNCTION public.check_email_exists(text) FROM PUBLIC, anon, authenticated;

COMMIT;
