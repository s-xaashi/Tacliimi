-- Keep platform_settings private while exposing only fields used by public UI.
BEGIN;

DROP POLICY IF EXISTS "Anyone can read platform settings" ON public.platform_settings;
DROP POLICY IF EXISTS "Active admins can read platform settings" ON public.platform_settings;
CREATE POLICY "Active admins can read platform settings"
ON public.platform_settings
FOR SELECT
TO authenticated
USING ((SELECT public.check_is_admin()));

REVOKE SELECT ON TABLE public.platform_settings FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.platform_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.get_public_platform_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'show_refund_request', ps.show_refund_request,
    'course_boost_price_per_day', ps.course_boost_price_per_day,
    'mentor_boost_price_per_day', ps.mentor_boost_price_per_day,
    'course_banner_price_per_day', ps.course_banner_price_per_day,
    'mentor_banner_price_per_day', ps.mentor_banner_price_per_day,
    'boost_min_days', ps.boost_min_days,
    'boost_max_days', ps.boost_max_days,
    'boost_rotation_window_minutes', ps.boost_rotation_window_minutes,
    'course_boost_enabled', ps.course_boost_enabled,
    'course_banner_enabled', ps.course_banner_enabled,
    'mentor_boost_enabled', ps.mentor_boost_enabled,
    'mentor_banner_enabled', ps.mentor_banner_enabled,
    'self_hosted_video_uploads_enabled', ps.self_hosted_video_uploads_enabled,
    'certificate_payment_enabled', COALESCE(ps.certificate_payment_enabled, false),
    'certificate_price', COALESCE(ps.certificate_price, 1),
    'certificate_free_generation_limit', COALESCE(ps.certificate_free_generation_limit, 3)
  )
  INTO v_result
  FROM public.platform_settings AS ps
  LIMIT 1;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_public_platform_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_platform_settings() TO anon, authenticated;

-- The old RPC exposed commission splits, withdrawal reserves and minimum
-- withdrawal values. Admin pages now read the protected table directly.
REVOKE ALL ON FUNCTION public.get_platform_settings() FROM PUBLIC, anon, authenticated;

COMMIT;
