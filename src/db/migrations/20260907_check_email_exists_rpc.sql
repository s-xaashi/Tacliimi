-- Migration: Create check_email_exists RPC function
-- Purpose: Bypasses RLS to safely check if an email address is already registered in auth.users or profiles
-- Date: 2026-09-07

CREATE OR REPLACE FUNCTION check_email_exists(p_email text)
RETURNS boolean AS $$
DECLARE
    email_clean text;
    is_found boolean;
BEGIN
    IF p_email IS NULL OR trim(p_email) = '' THEN
        RETURN false;
    END IF;
    
    email_clean := lower(trim(p_email));

    SELECT EXISTS (
        SELECT 1 FROM auth.users WHERE lower(email) = email_clean
        UNION
        SELECT 1 FROM public.profiles WHERE lower(email) = email_clean
    ) INTO is_found;

    RETURN is_found;
END;
$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Grant execution to anonymous and authenticated users so prospective students can check email availability
REVOKE ALL ON FUNCTION public.check_email_exists(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_email_exists(text) TO anon, authenticated;
