-- Secure update-migration coupon validation against caller-supplied identity.
-- The browser may continue calling the existing RPC signature; the authenticated
-- identity is now derived from auth.uid(), never trusted from p_student_id.
BEGIN;

CREATE OR REPLACE FUNCTION public.validate_course_coupon(
  p_course_id uuid,
  p_code text,
  p_student_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(discount_percent numeric, valid boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_coupon public.course_coupons%ROWTYPE;
  v_family_id uuid;
  v_student_id uuid := auth.uid();
BEGIN
  IF p_course_id IS NULL OR p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN QUERY SELECT NULL::numeric, false, 'Invalid coupon code';
    RETURN;
  END IF;

  -- Retain signature compatibility but reject any attempt to validate an
  -- account-specific offer for a different user.
  IF p_student_id IS NOT NULL AND p_student_id IS DISTINCT FROM v_student_id THEN
    RETURN QUERY SELECT NULL::numeric, false, 'This coupon is not available for your account';
    RETURN;
  END IF;

  SELECT COALESCE(c.root_course_id, c.id)
    INTO v_family_id
  FROM public.courses AS c
  WHERE c.id = p_course_id;

  IF v_family_id IS NULL THEN
    RETURN QUERY SELECT NULL::numeric, false, 'Invalid coupon code';
    RETURN;
  END IF;

  SELECT cc.*
    INTO v_coupon
  FROM public.course_coupons AS cc
  WHERE cc.course_id IN (
    SELECT c.id
    FROM public.courses AS c
    WHERE COALESCE(c.root_course_id, c.id) = v_family_id
  )
    AND cc.code = upper(trim(p_code))
    AND cc.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::numeric, false, 'Invalid coupon code';
    RETURN;
  END IF;

  IF v_coupon.starts_at IS NOT NULL AND v_coupon.starts_at > now() THEN
    RETURN QUERY SELECT NULL::numeric, false, 'Coupon not active yet';
    RETURN;
  END IF;

  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at < now() THEN
    RETURN QUERY SELECT NULL::numeric, false, 'Coupon has expired';
    RETURN;
  END IF;

  IF v_coupon.coupon_type = 'update_migration' THEN
    IF v_student_id IS NULL THEN
      RETURN QUERY SELECT NULL::numeric, false, 'This coupon requires a student account';
      RETURN;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.course_update_offers AS cuo
      WHERE cuo.coupon_id = v_coupon.id
        AND cuo.student_id = v_student_id
        AND cuo.redeemed_at IS NULL
    ) THEN
      RETURN QUERY SELECT NULL::numeric, false, 'This coupon is not available for your account';
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT v_coupon.discount_percent::numeric, true, 'Valid';
END;
$function$;

-- Preserve the existing public validation contract for ordinary coupons.
-- The function no longer accepts a caller-selected identity for private offers.
REVOKE ALL ON FUNCTION public.validate_course_coupon(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_course_coupon(uuid, text, uuid) TO anon, authenticated;

COMMIT;
