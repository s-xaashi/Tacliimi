-- Migration: Student Login Rate Limiting & Account Security
-- Description: Creates login_attempts table and check_and_record_login_attempt function for server-side login rate limiting.

CREATE TABLE IF NOT EXISTS public.login_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    ip_address TEXT,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    success BOOLEAN NOT NULL
);

-- Index for fast lookup of recent login attempts by email
CREATE INDEX IF NOT EXISTS idx_login_attempts_email_at 
ON public.login_attempts (lower(email), attempted_at DESC);

-- Enable RLS on login_attempts table to prevent direct public/client access
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

-- Deny all direct client access to login_attempts (only SECURITY DEFINER function can manage it)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'login_attempts' AND policyname = 'deny_all_login_attempts_client'
    ) THEN
        CREATE POLICY deny_all_login_attempts_client ON public.login_attempts
        FOR ALL TO public USING (false) WITH CHECK (false);
    END IF;
END $$;

-- SECURITY DEFINER Function: check_and_record_login_attempt
-- Handles checking rate limit status AND recording failed/successful attempts.
CREATE OR REPLACE FUNCTION public.check_and_record_login_attempt(
    p_email TEXT,
    p_success BOOLEAN DEFAULT NULL,
    p_ip TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_clean_email TEXT;
    v_failed_count INT := 0;
    v_last_success TIMESTAMPTZ;
    v_last_failed TIMESTAMPTZ;
    v_lockout_seconds INT := 0;
    v_remaining_seconds INT := 0;
    v_max_attempts INT := 3;
BEGIN
    IF p_email IS NULL OR trim(p_email) = '' THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'error', 'Email is required',
            'retry_after_seconds', 0,
            'remaining_attempts', 0
        );
    END IF;

    v_clean_email := lower(trim(p_email));

    -- If p_success IS TRUE: record successful login & return success
    IF p_success IS TRUE THEN
        INSERT INTO public.login_attempts (email, ip_address, success)
        VALUES (v_clean_email, p_ip, true);

        RETURN jsonb_build_object(
            'allowed', true,
            'retry_after_seconds', 0,
            'remaining_attempts', v_max_attempts
        );
    END IF;

    -- Find the timestamp of the last successful login for this email
    SELECT max(attempted_at) INTO v_last_success
    FROM public.login_attempts
    WHERE lower(email) = v_clean_email AND success = true;

    -- Count failed attempts since last successful login (or within the last 15 minutes)
    SELECT count(*), max(attempted_at)
    INTO v_failed_count, v_last_failed
    FROM public.login_attempts
    WHERE lower(email) = v_clean_email
      AND success = false
      AND attempted_at > COALESCE(v_last_success, now() - INTERVAL '15 minutes')
      AND attempted_at > now() - INTERVAL '15 minutes';

    -- If p_success IS FALSE: insert a new failed attempt BEFORE checking limits
    IF p_success IS FALSE THEN
        INSERT INTO public.login_attempts (email, ip_address, success)
        VALUES (v_clean_email, p_ip, false);

        v_failed_count := v_failed_count + 1;
        v_last_failed := now();
    END IF;

    -- Calculate lockout duration based on consecutive failed attempts:
    -- 3 to 4 failed attempts: 30s lockout
    -- 5 to 9 failed attempts: 120s (2m) lockout
    -- 10+ failed attempts: 900s (15m) lockout
    IF v_failed_count >= 10 THEN
        v_lockout_seconds := 900;
    ELSIF v_failed_count >= 5 THEN
        v_lockout_seconds := 120;
    ELSIF v_failed_count >= 3 THEN
        v_lockout_seconds := 30;
    ELSE
        v_lockout_seconds := 0;
    END IF;

    -- Calculate remaining lockout duration in seconds if currently locked out
    IF v_lockout_seconds > 0 AND v_last_failed IS NOT NULL THEN
        v_remaining_seconds := GREATEST(0, v_lockout_seconds - FLOOR(EXTRACT(EPOCH FROM (now() - v_last_failed)))::INT);
    ELSE
        v_remaining_seconds := 0;
    END IF;

    IF v_remaining_seconds > 0 THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'retry_after_seconds', v_remaining_seconds,
            'remaining_attempts', 0,
            'failed_attempts', v_failed_count
        );
    ELSE
        RETURN jsonb_build_object(
            'allowed', true,
            'retry_after_seconds', 0,
            'remaining_attempts', GREATEST(0, v_max_attempts - v_failed_count),
            'failed_attempts', v_failed_count
        );
    END IF;
END;
$$;

-- Grant execution to anon and authenticated roles
GRANT EXECUTE ON FUNCTION public.check_and_record_login_attempt(TEXT, BOOLEAN, TEXT) TO anon, authenticated;
