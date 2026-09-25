-- Add independent toggles for Boosts and Banners
ALTER TABLE public.platform_settings
ADD COLUMN IF NOT EXISTS course_boost_enabled boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS course_banner_enabled boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS mentor_boost_enabled boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS mentor_banner_enabled boolean DEFAULT true;

-- Update the RPC to return these new fields in the JSON object
CREATE OR REPLACE FUNCTION public.get_platform_settings()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    result jsonb;
BEGIN
    SELECT jsonb_build_object(
        'commission_enabled', ps.commission_enabled,
        'instructor_percentage', ps.instructor_percentage,
        'platform_percentage', ps.platform_percentage,
        'min_withdrawal_amount', ps.min_withdrawal_amount,
        'show_refund_request', ps.show_refund_request,
        'course_boost_price_per_day', ps.course_boost_price_per_day,
        'mentor_boost_price_per_day', ps.mentor_boost_price_per_day,
        'course_banner_price_per_day', ps.course_banner_price_per_day,
        'mentor_banner_price_per_day', ps.mentor_banner_price_per_day,
        'boost_min_days', ps.boost_min_days,
        'boost_max_days', ps.boost_max_days,
        'course_boost_enabled', ps.course_boost_enabled,
        'course_banner_enabled', ps.course_banner_enabled,
        'mentor_boost_enabled', ps.mentor_boost_enabled,
        'mentor_banner_enabled', ps.mentor_banner_enabled,
        'updated_at', ps.updated_at
    ) INTO result
    FROM public.platform_settings ps
    LIMIT 1;

    RETURN COALESCE(result, '{"commission_enabled":false,"instructor_percentage":100,"platform_percentage":0,"min_withdrawal_amount":10,"show_refund_request":true}'::jsonb);
END;
$function$;
