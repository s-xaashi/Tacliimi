-- Restrict profile phone-uniqueness checks to the signed-in profile.
-- The account-settings page is the only frontend consumer and always has an
-- authenticated session. Do not allow anonymous number probing or exclusion
-- of an arbitrary third-party profile ID.
BEGIN;

CREATE OR REPLACE FUNCTION public.check_profile_phone_unique(
  p_phone text,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_clean_phone text;
  v_caller_id uuid := auth.uid();
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NOT NULL AND p_user_id IS DISTINCT FROM v_caller_id THEN
    RAISE EXCEPTION 'Cannot check phone uniqueness for another account'
      USING ERRCODE = '42501';
  END IF;

  IF p_phone IS NULL OR trim(p_phone) = '' THEN
    RETURN false;
  END IF;

  v_clean_phone := regexp_replace(p_phone, '\\D', '', 'g');
  v_clean_phone := regexp_replace(v_clean_phone, '^(252|254|253|256|250|255|0+)', '');

  IF length(v_clean_phone) < 6 THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id <> v_caller_id
      AND p.phone_number IS NOT NULL
      AND regexp_replace(
        regexp_replace(p.phone_number, '\\D', '', 'g'),
        '^(252|254|253|256|250|255|0+)',
        ''
      ) = v_clean_phone
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.check_profile_phone_unique(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_profile_phone_unique(text, uuid) TO authenticated;

COMMIT;
