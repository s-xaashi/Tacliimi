-- Migration: Phase 7 - Finding #1 Remediation
-- Drops the unused, vulnerable, and broken verify_admin_login function entirely.

BEGIN;

-- Drop the function including both its arguments (p_username, p_password)
DROP FUNCTION IF EXISTS public.verify_admin_login(text, text);

COMMIT;
