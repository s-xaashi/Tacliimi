-- Replace caller-controlled login attempt recording and phone-number enumeration.
-- Sign-in attempts are rate-limited by Supabase Auth. Profile phone uniqueness is
-- enforced on writes, without exposing an arbitrary-number lookup RPC.
BEGIN;

REVOKE ALL ON FUNCTION public.check_and_record_login_attempt(text, boolean, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_profile_phone_unique()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_clean_phone text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.phone_number IS NOT DISTINCT FROM OLD.phone_number THEN
    RETURN NEW;
  END IF;

  IF NEW.phone_number IS NULL OR btrim(NEW.phone_number) = '' THEN
    RETURN NEW;
  END IF;

  v_clean_phone := pg_catalog.regexp_replace(NEW.phone_number, '\D', '', 'g');
  v_clean_phone := pg_catalog.regexp_replace(v_clean_phone, '^(252|254|253|256|250|255|0+)', '');

  -- Preserve the existing validation convention: short values are not treated
  -- as valid phone numbers by the legacy uniqueness checker.
  IF pg_catalog.length(v_clean_phone) < 6 THEN
    RETURN NEW;
  END IF;

  -- Serialize writes for the same normalized phone to close the concurrent
  -- check-then-write race without introducing a global lock.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_clean_phone, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id IS DISTINCT FROM NEW.id
      AND p.phone_number IS NOT NULL
      AND pg_catalog.regexp_replace(
            pg_catalog.regexp_replace(p.phone_number, '\D', '', 'g'),
            '^(252|254|253|256|250|255|0+)',
            ''
          ) = v_clean_phone
  ) THEN
    RAISE EXCEPTION 'This phone number is already in use.'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_profile_phone_unique ON public.profiles;
CREATE TRIGGER enforce_profile_phone_unique
BEFORE INSERT OR UPDATE OF phone_number
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_profile_phone_unique();

REVOKE ALL ON FUNCTION public.enforce_profile_phone_unique() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_profile_phone_unique(text, uuid)
  FROM PUBLIC, anon, authenticated;

COMMIT;
