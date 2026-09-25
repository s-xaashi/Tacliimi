-- migration file: 20260827_phase6_trigger_scope_version_status.sql
-- Phase 6 Closure: Extend protect_course_state_fields to cover version_status and is_latest_published.
-- These fields are exclusively set by server-side RPCs (approve_course_admin, reject_course_admin,
-- get_or_create_course_revision) and must never be directly writable by an authenticated user.
-- The trigger uses JWT-based role detection (not current_user) to correctly identify the caller.
CREATE OR REPLACE FUNCTION public.protect_course_state_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Allow service_role callers (identified via JWT claim, not current_user which is always 'postgres' in SECURITY DEFINER)
  IF current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Allow application-level admins
  IF auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN NEW;
  END IF;

  -- Block direct mutation of system-controlled workflow fields
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Unauthorized: Cannot directly modify course status';
  END IF;

  IF NEW.version_status IS DISTINCT FROM OLD.version_status THEN
    RAISE EXCEPTION 'Unauthorized: Cannot directly modify course version_status';
  END IF;

  IF NEW.is_latest_published IS DISTINCT FROM OLD.is_latest_published THEN
    RAISE EXCEPTION 'Unauthorized: Cannot directly modify course is_latest_published';
  END IF;

  RETURN NEW;
END;
$$;
