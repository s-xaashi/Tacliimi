-- Remove plaintext administrator backup-password exposure.
-- Admin passwords are already managed by Supabase Auth; they must not be copied
-- into admin_auth or returned to a browser for later recovery.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_admin_account(
  p_admin_id uuid,
  p_full_name text,
  p_role text,
  p_caller_id uuid,
  p_username text DEFAULT NULL::text,
  p_backup_password text DEFAULT NULL::text,
  p_backup_email text DEFAULT NULL::text,
  p_address text DEFAULT NULL::text,
  p_city text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR p_caller_id IS DISTINCT FROM auth.uid()
     OR NOT EXISTS (
       SELECT 1
       FROM public.admin_auth AS aa
       WHERE aa.id = auth.uid()
         AND aa.role = 'superadmin'
         AND COALESCE(aa.is_suspended, false) = false
     ) THEN
    RAISE EXCEPTION 'Unauthorized: active superadmin required'
      USING ERRCODE = '42501';
  END IF;

  IF p_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users AS u WHERE u.id = p_admin_id
  ) THEN
    RAISE EXCEPTION 'The administrator must have an existing Auth account';
  END IF;

  IF p_role IS NULL OR p_role NOT IN ('superadmin', 'course_manager', 'finance_manager') THEN
    RAISE EXCEPTION 'Invalid administrator role';
  END IF;

  INSERT INTO public.admin_auth AS existing (
    id, full_name, role, username, backup_password_enc, backup_email,
    address, city, phone_number
  )
  VALUES (
    p_admin_id, p_full_name, p_role, p_username, NULL, p_backup_email,
    p_address, p_city, p_phone
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    username = COALESCE(EXCLUDED.username, existing.username),
    backup_password_enc = NULL,
    backup_email = COALESCE(EXCLUDED.backup_email, existing.backup_email),
    address = COALESCE(EXCLUDED.address, existing.address),
    city = COALESCE(EXCLUDED.city, existing.city),
    phone_number = COALESCE(EXCLUDED.phone_number, existing.phone_number);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_admin_account(uuid, text, text, uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_admin_account(uuid, text, text, uuid, text, text, text, text, text, text) TO authenticated;

-- Legacy overloads can still write the same plaintext column. The current
-- Admin Management page uses the 10-argument signature above; disable older
-- overloads so they cannot reintroduce plaintext credential storage.
DO $block$
DECLARE
  v_function regprocedure;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'create_admin_account'
      AND p.oid <> 'public.create_admin_account(uuid,text,text,uuid,text,text,text,text,text,text)'::regprocedure
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_function);
  END LOOP;
END;
$block$;

-- The credential reveal endpoint is no longer used and must not remain callable.
REVOKE ALL ON FUNCTION public.admin_get_backup_password(uuid) FROM PUBLIC, anon, authenticated;

-- Existing values were inserted directly from the Auth signup password field;
-- the column name did not reflect encryption. Clear those plaintext copies.
UPDATE public.admin_auth
SET backup_password_enc = NULL
WHERE backup_password_enc IS NOT NULL;

COMMIT;
