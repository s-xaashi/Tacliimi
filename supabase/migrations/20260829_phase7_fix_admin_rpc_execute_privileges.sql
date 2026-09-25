-- Migration: Phase 7 Finding #5 — Fix Admin RPC Execute Privileges
-- Revoke PUBLIC and anon execute grants for all cancel overloads

-- 1. admin_cancel_boost
REVOKE EXECUTE ON FUNCTION public.admin_cancel_boost(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_boost(UUID) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_cancel_boost(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_boost(UUID, TEXT) TO authenticated, service_role;

-- 2. admin_cancel_promo_banner
REVOKE EXECUTE ON FUNCTION public.admin_cancel_promo_banner(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_promo_banner(UUID) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_cancel_promo_banner(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_promo_banner(UUID, TEXT) TO authenticated, service_role;

-- 3. cancel_boost (for instructors)
REVOKE EXECUTE ON FUNCTION public.cancel_boost(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_boost(UUID) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.cancel_boost(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_boost(UUID, TEXT, TEXT) TO authenticated, service_role;

-- 4. cancel_promo_banner (for instructors)
REVOKE EXECUTE ON FUNCTION public.cancel_promo_banner(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_promo_banner(UUID) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.cancel_promo_banner(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_promo_banner(UUID, TEXT, TEXT) TO authenticated, service_role;
