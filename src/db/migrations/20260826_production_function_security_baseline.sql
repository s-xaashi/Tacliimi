-- ============================================================
-- PRODUCTION FUNCTION SECURITY BASELINE
-- Generated from live Tacliimi Supabase database
-- Project: jboruccxbgdqntrggslz
-- Date: 2026-08-26
-- Purpose: Version-control snapshot of production functions absent from Git.
--          DO NOT EXECUTE against production. 
--          This is a READ-ONLY synchronization record.
-- ============================================================

-- ============================================================
-- FINANCIAL FUNCTIONS
-- ============================================================

-- Function: get_instructor_earnings_summary
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.get_instructor_earnings_summary(p_instructor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_total_earned         numeric;
    v_total_platform_fees  numeric;
    v_total_withdrawn      numeric;
    v_pending_withdrawals  numeric;
    v_held_balance         numeric;
    v_available            numeric;
    v_cleared_earnings     numeric;
    v_min_withdrawal       numeric;
    v_reserve              numeric;
    v_withdrawable         numeric;
    v_monthly              numeric;
    v_weekly               numeric;
    v_today                numeric;
BEGIN
    -- Verify the caller is the instructor requesting their own summary (or an admin)
    IF auth.uid() != p_instructor_id AND NOT check_is_finance_admin() AND NOT check_is_superadmin() THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    -- Total earned (instructor share from paid payments)
    SELECT COALESCE(SUM(ie.instructor_share), 0),
           COALESCE(SUM(ie.platform_fee), 0)
    INTO v_total_earned, v_total_platform_fees
    FROM public.instructor_earnings ie
    JOIN public.payments p ON p.id = ie.payment_id
    WHERE ie.instructor_id = p_instructor_id
      AND p.payment_status = 'paid';

    -- Total withdrawn (approved + processing + paid)
    SELECT COALESCE(SUM(wr.amount), 0)
    INTO v_total_withdrawn
    FROM public.withdrawal_requests wr
    WHERE wr.instructor_id = p_instructor_id
      AND wr.status IN ('approved', 'processing', 'paid');

    -- Pending withdrawals
    SELECT COALESCE(SUM(wr.amount), 0)
    INTO v_pending_withdrawals
    FROM public.withdrawal_requests wr
    WHERE wr.instructor_id = p_instructor_id
      AND wr.status = 'pending';

    -- Held balance: mentorship earnings only, while still within hold window.
    SELECT COALESCE(SUM(ie.instructor_share), 0)
    INTO v_held_balance
    FROM public.instructor_earnings ie
    JOIN public.payments p ON p.id = ie.payment_id
    LEFT JOIN public.mentorship_sessions ms ON ms.id = ie.mentorship_session_id
    WHERE ie.instructor_id = p_instructor_id
      AND ie.earning_type = 'mentorship'
      AND p.payment_status = 'paid'
      AND (
          (ms.mentorship_type = 'single'  AND now() < ms.scheduled_at + interval '1 day')
       OR (ms.mentorship_type = 'program' AND now() < ms.end_date)
      );

    -- Cleared earnings (Gross total minus what is still held)
    v_cleared_earnings := v_total_earned - v_held_balance;

    -- Available (Cleared minus already withdrawn)
    v_available := v_cleared_earnings - v_total_withdrawn - v_pending_withdrawals;

    -- Fetch min withdrawal
    SELECT COALESCE(ps.min_withdrawal_amount, 10)
    INTO v_min_withdrawal
    FROM public.platform_settings ps LIMIT 1;
    
    v_reserve := v_min_withdrawal / 2.0;

    -- Actual safely withdrawable
    v_withdrawable := GREATEST(0, v_available - v_reserve);

    -- Monthly earnings
    SELECT COALESCE(SUM(ie.instructor_share), 0)
    INTO v_monthly
    FROM public.instructor_earnings ie
    JOIN public.payments p ON p.id = ie.payment_id
    WHERE ie.instructor_id = p_instructor_id
      AND p.payment_status = 'paid'
      AND ie.created_at >= date_trunc('month', now());

    -- Weekly earnings
    SELECT COALESCE(SUM(ie.instructor_share), 0)
    INTO v_weekly
    FROM public.instructor_earnings ie
    JOIN public.payments p ON p.id = ie.payment_id
    WHERE ie.instructor_id = p_instructor_id
      AND p.payment_status = 'paid'
      AND ie.created_at >= date_trunc('week', now());

    -- Today's earnings
    SELECT COALESCE(SUM(ie.instructor_share), 0)
    INTO v_today
    FROM public.instructor_earnings ie
    JOIN public.payments p ON p.id = ie.payment_id
    WHERE ie.instructor_id = p_instructor_id
      AND p.payment_status = 'paid'
      AND ie.created_at >= date_trunc('day', now());

    RETURN jsonb_build_object(
        'total_earned',          v_total_earned,
        'cleared_earnings',      v_cleared_earnings,
        'platform_fees',         v_total_platform_fees,
        'net_earnings',          v_total_earned,
        'total_withdrawn',       v_total_withdrawn,
        'pending_withdrawals',   v_pending_withdrawals,
        'held_balance',          v_held_balance,
        'available_balance',     v_available,
        'min_withdrawal_amount', v_min_withdrawal,
        'withdrawable_amount',   v_withdrawable,
        'reserve_amount',        v_reserve,
        'monthly',               v_monthly,
        'weekly',                v_weekly,
        'today',                 v_today
    );
END;
$function$


-- Grants for get_instructor_earnings_summary:
GRANT EXECUTE ON FUNCTION public.get_instructor_earnings_summary(p_instructor_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_instructor_earnings_summary(p_instructor_id uuid) TO service_role;

-- Function: get_instructor_payment_details
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.get_instructor_payment_details()
 RETURNS TABLE(earning_id uuid, serial_id integer, student_full_name text, student_avatar_url text, refund_status text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT
        ie.id                    AS earning_id,
        p.serial_id,
        pr.full_name             AS student_full_name,
        pr.avatar_url            AS student_avatar_url,
        rr.status                AS refund_status
    FROM public.instructor_earnings ie
    JOIN public.payments p ON p.id = ie.payment_id
    LEFT JOIN public.profiles pr ON pr.id = p.student_id
    LEFT JOIN LATERAL (
        -- Deterministic single row per payment:
        -- Priority: approved > pending > rejected; ties broken by newest first
        SELECT status
        FROM public.refund_requests
        WHERE payment_id = p.id
        ORDER BY
            CASE status
                WHEN 'approved' THEN 0
                WHEN 'pending'  THEN 1
                ELSE                 2
            END,
            created_at DESC
        LIMIT 1
    ) rr ON true
    WHERE ie.instructor_id = auth.uid();
$function$


-- Grants for get_instructor_payment_details:
GRANT EXECUTE ON FUNCTION public.get_instructor_payment_details() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_instructor_payment_details() TO service_role;

-- Function: request_withdrawal
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.request_withdrawal(p_amount numeric, p_payout_method_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_instructor_id uuid;
    v_summary jsonb;
    v_min_withdrawal numeric;
    v_withdrawable numeric;
    v_available numeric;
    v_reserve numeric;
    v_method_snapshot jsonb;
    v_ref_number text;
    v_new_id uuid;
    v_method_type text;
BEGIN
    v_instructor_id := auth.uid();
    IF v_instructor_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
    END IF;

    -- Validate amount
    IF p_amount <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
    END IF;

    -- Call single source of truth for balances!
    v_summary := get_instructor_earnings_summary(v_instructor_id);
    v_min_withdrawal := (v_summary->>'min_withdrawal_amount')::numeric;
    v_withdrawable := (v_summary->>'withdrawable_amount')::numeric;
    v_available := (v_summary->>'available_balance')::numeric;
    v_reserve := (v_summary->>'reserve_amount')::numeric;

    -- Reject if below the platform minimum limit
    IF p_amount < v_min_withdrawal THEN
        RETURN jsonb_build_object('success', false, 'error', 
            'Minimum withdrawal is $' || v_min_withdrawal::text);
    END IF;

    -- Notice the exact condition provided by the business rule:
    -- Cannot withdraw above `withdrawable` (which leaves the computed reserve intact)
    IF p_amount > v_withdrawable THEN
        RETURN jsonb_build_object('success', false, 'error', 
            'Insufficient balance. Only $' || v_withdrawable::text || ' is permitted to leave the $' || v_reserve::text || ' reserve intact.');
    END IF;

    -- Snapshot the payout method
    SELECT jsonb_build_object(
        'method_type', pm.method_type,
        'provider_name', pm.provider_name,
        'country', pm.country,
        'phone_mobile_money', pm.phone_mobile_money,
        'phone_cash_on_delivery', pm.phone_cash_on_delivery,
        'address', pm.address,
        'city', pm.city
    ), pm.method_type::text
    INTO v_method_snapshot, v_method_type
    FROM public.payout_methods pm
    WHERE pm.id = p_payout_method_id
      AND pm.instructor_id = v_instructor_id;

    IF v_method_snapshot IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Payout method not found');
    END IF;

    -- Generate reference number: WDR-YYYY-NNNNNN
    SELECT 'WDR-' || to_char(now(), 'YYYY') || '-' ||
           lpad((COALESCE(MAX(
               CASE WHEN reference_number ~ '^WDR-[0-9]{4}-[0-9]+$'
               THEN (regexp_replace(reference_number, '^WDR-[0-9]{4}-', ''))::int
               ELSE 0 END
           ), 0) + 1)::text, 6, '0')
    INTO v_ref_number
    FROM public.withdrawal_requests;

    -- Insert withdrawal request
    INSERT INTO public.withdrawal_requests
        (instructor_id, amount, payout_method, status, reference_number, currency, payout_method_snapshot)
    VALUES
        (v_instructor_id, p_amount, v_method_type, 'pending', v_ref_number, 'USD', v_method_snapshot)
    RETURNING id INTO v_new_id;

    RETURN jsonb_build_object(
        'success', true,
        'withdrawal_id', v_new_id,
        'reference_number', v_ref_number,
        'amount', p_amount
    );
END;
$function$


-- Grants for request_withdrawal:
GRANT EXECUTE ON FUNCTION public.request_withdrawal(p_amount numeric, p_payout_method_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(p_amount numeric, p_payout_method_id uuid) TO service_role;

-- Function: set_payments_updated_at
-- SECURITY DEFINER: False
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=True, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.set_payments_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$


-- Grants for set_payments_updated_at:
GRANT EXECUTE ON FUNCTION public.set_payments_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.set_payments_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_payments_updated_at() TO service_role;

-- Function: validate_course_coupon
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=True, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.validate_course_coupon(p_course_id uuid, p_code text, p_student_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(discount_percent numeric, valid boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_coupon    course_coupons%ROWTYPE;
  v_family_id UUID;
BEGIN
  SELECT COALESCE(root_course_id, id) INTO v_family_id FROM courses WHERE id = p_course_id;

  SELECT * INTO v_coupon
  FROM course_coupons
  WHERE course_id IN (
    SELECT id FROM courses WHERE COALESCE(root_course_id, id) = v_family_id
  )
    AND code = UPPER(p_code)
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::NUMERIC, false, 'Invalid coupon code';
    RETURN;
  END IF;

  IF v_coupon.starts_at IS NOT NULL AND v_coupon.starts_at > now() THEN
    RETURN QUERY SELECT NULL::NUMERIC, false, 'Coupon not active yet';
    RETURN;
  END IF;

  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at < now() THEN
    RETURN QUERY SELECT NULL::NUMERIC, false, 'Coupon has expired';
    RETURN;
  END IF;

  IF v_coupon.coupon_type = 'update_migration' THEN
    IF p_student_id IS NULL THEN
      RETURN QUERY SELECT NULL::NUMERIC, false, 'This coupon requires a student account';
      RETURN;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM course_update_offers
      WHERE coupon_id = v_coupon.id AND student_id = p_student_id AND redeemed_at IS NULL
    ) THEN
      RETURN QUERY SELECT NULL::NUMERIC, false, 'This coupon is not available for your account';
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT v_coupon.discount_percent::NUMERIC, true, 'Valid';
END;
$function$


-- Grants for validate_course_coupon:
GRANT EXECUTE ON FUNCTION public.validate_course_coupon(p_course_id uuid, p_code text, p_student_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.validate_course_coupon(p_course_id uuid, p_code text, p_student_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_course_coupon(p_course_id uuid, p_code text, p_student_id uuid) TO service_role;

-- ============================================================
-- PROMOTION FUNCTIONS (Boost / Banner)
-- ============================================================

-- Function: admin_cancel_boost
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres
CREATE OR REPLACE FUNCTION public.admin_cancel_boost(p_boost_id uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Check admin privileges
    IF NOT EXISTS (SELECT 1 FROM admin_auth WHERE admin_id = auth.uid()) THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    UPDATE boosts
    SET cancelled_at = now()
    WHERE id = p_boost_id AND cancelled_at IS NULL;
END;
$function$


-- Grants for admin_cancel_boost:
GRANT EXECUTE ON FUNCTION public.admin_cancel_boost(p_boost_id uuid, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_boost(p_boost_id uuid, p_note text) TO service_role;

-- Function: admin_cancel_promo_banner
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres
CREATE OR REPLACE FUNCTION public.admin_cancel_promo_banner(p_banner_id uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Check admin privileges
    IF NOT EXISTS (SELECT 1 FROM admin_auth WHERE admin_id = auth.uid()) THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    UPDATE promo_banners
    SET cancelled_at = now()
    WHERE id = p_banner_id AND cancelled_at IS NULL;
END;
$function$


-- Grants for admin_cancel_promo_banner:
GRANT EXECUTE ON FUNCTION public.admin_cancel_promo_banner(p_banner_id uuid, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_promo_banner(p_banner_id uuid, p_note text) TO service_role;

-- Function: admin_grant_boost
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.admin_grant_boost(p_entity_type text, p_entity_id uuid, p_instructor_id uuid, p_plan_days integer, p_amount_paid numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- RBAC check
  IF NOT EXISTS (
      SELECT 1 FROM admin_auth
      WHERE id = auth.uid() AND role IN ('superadmin', 'finance_manager')
  ) THEN
      RAISE EXCEPTION 'Insufficient privileges';
  END IF;

  INSERT INTO boosts (
    entity_type,
    entity_id,
    instructor_id,
    plan_days,
    amount_paid,
    starts_at,
    ends_at,
    is_admin_granted
  ) VALUES (
    p_entity_type,
    p_entity_id,
    p_instructor_id,
    p_plan_days,
    p_amount_paid,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP + (p_plan_days || ' days')::interval,
    TRUE
  );
END;
$function$


-- Grants for admin_grant_boost:
GRANT EXECUTE ON FUNCTION public.admin_grant_boost(p_entity_type text, p_entity_id uuid, p_instructor_id uuid, p_plan_days integer, p_amount_paid numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_boost(p_entity_type text, p_entity_id uuid, p_instructor_id uuid, p_plan_days integer, p_amount_paid numeric) TO service_role;

-- Function: admin_grant_boost_and_banner_atomic
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.admin_grant_boost_and_banner_atomic(p_entity_type text, p_entity_id uuid, p_instructor_id uuid, p_plan_days integer, p_boost_amount_paid numeric, p_banner_amount_paid numeric, p_banner_text text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- We don't strictly need RBAC here if the sub-functions check it, but doing it early is safe
  IF NOT EXISTS (
      SELECT 1 FROM admin_auth
      WHERE id = auth.uid() AND role IN ('superadmin', 'finance_manager')
  ) THEN
      RAISE EXCEPTION 'Insufficient privileges';
  END IF;

  PERFORM admin_grant_boost(
    p_entity_type,
    p_entity_id,
    p_instructor_id,
    p_plan_days,
    p_boost_amount_paid
  );
  
  PERFORM admin_grant_promo_banner(
    p_entity_type,
    p_entity_id,
    p_instructor_id,
    p_banner_text,
    p_plan_days,
    p_banner_amount_paid
  );
END;
$function$


-- Grants for admin_grant_boost_and_banner_atomic:
GRANT EXECUTE ON FUNCTION public.admin_grant_boost_and_banner_atomic(p_entity_type text, p_entity_id uuid, p_instructor_id uuid, p_plan_days integer, p_boost_amount_paid numeric, p_banner_amount_paid numeric, p_banner_text text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_boost_and_banner_atomic(p_entity_type text, p_entity_id uuid, p_instructor_id uuid, p_plan_days integer, p_boost_amount_paid numeric, p_banner_amount_paid numeric, p_banner_text text) TO service_role;

-- Function: admin_grant_promo_banner
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.admin_grant_promo_banner(p_entity_type text, p_entity_id uuid, p_instructor_id uuid, p_banner_text text, p_plan_days integer, p_amount_paid numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- RBAC check
  IF NOT EXISTS (
      SELECT 1 FROM admin_auth
      WHERE id = auth.uid() AND role IN ('superadmin', 'finance_manager')
  ) THEN
      RAISE EXCEPTION 'Insufficient privileges';
  END IF;

  INSERT INTO promo_banners (
    entity_type,
    entity_id,
    instructor_id,
    banner_text,
    plan_days,
    amount_paid,
    starts_at,
    ends_at,
    is_admin_granted
  ) VALUES (
    p_entity_type,
    p_entity_id,
    p_instructor_id,
    p_banner_text,
    p_plan_days,
    p_amount_paid,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP + (p_plan_days || ' days')::interval,
    TRUE
  );
END;
$function$


-- Grants for admin_grant_promo_banner:
GRANT EXECUTE ON FUNCTION public.admin_grant_promo_banner(p_entity_type text, p_entity_id uuid, p_instructor_id uuid, p_banner_text text, p_plan_days integer, p_amount_paid numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_promo_banner(p_entity_type text, p_entity_id uuid, p_instructor_id uuid, p_banner_text text, p_plan_days integer, p_amount_paid numeric) TO service_role;

-- Function: cancel_boost
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.cancel_boost(p_boost_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_instructor_id uuid;
  v_cancelled_at timestamptz;
BEGIN
  SELECT instructor_id, cancelled_at INTO v_instructor_id, v_cancelled_at FROM boosts WHERE id = p_boost_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Boost not found.';
  END IF;
  IF auth.uid() IS NULL OR v_instructor_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: only the owner can cancel this boost.';
  END IF;
  IF v_cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Boost is already cancelled.';
  END IF;
  UPDATE boosts SET cancelled_at = now() WHERE id = p_boost_id;
END;
$function$


-- Grants for cancel_boost:
GRANT EXECUTE ON FUNCTION public.cancel_boost(p_boost_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_boost(p_boost_id uuid) TO service_role;

-- Function: cancel_boost
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.cancel_boost(p_boost_id uuid, p_reason text, p_phone text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_instructor_id uuid;
  v_cancelled_at timestamptz;
BEGIN
  SELECT instructor_id, cancelled_at INTO v_instructor_id, v_cancelled_at FROM boosts WHERE id = p_boost_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Boost not found.';
  END IF;
  IF auth.uid() IS NULL OR v_instructor_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: only the owner can cancel this boost.';
  END IF;
  IF v_cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Boost is already cancelled.';
  END IF;
  UPDATE boosts SET cancelled_at = now(), cancel_reason = p_reason, cancel_contact_phone = p_phone WHERE id = p_boost_id;
END;
$function$


-- Grants for cancel_boost:
GRANT EXECUTE ON FUNCTION public.cancel_boost(p_boost_id uuid, p_reason text, p_phone text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_boost(p_boost_id uuid, p_reason text, p_phone text) TO service_role;

-- Function: cancel_promo_banner
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.cancel_promo_banner(p_banner_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_instructor_id uuid;
  v_cancelled_at timestamptz;
BEGIN
  SELECT instructor_id, cancelled_at INTO v_instructor_id, v_cancelled_at FROM promo_banners WHERE id = p_banner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promo banner not found.';
  END IF;
  IF auth.uid() IS NULL OR v_instructor_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: only the owner can cancel this banner.';
  END IF;
  IF v_cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Promo banner is already cancelled.';
  END IF;
  UPDATE promo_banners SET cancelled_at = now() WHERE id = p_banner_id;
END;
$function$


-- Grants for cancel_promo_banner:
GRANT EXECUTE ON FUNCTION public.cancel_promo_banner(p_banner_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_promo_banner(p_banner_id uuid) TO service_role;

-- Function: cancel_promo_banner
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.cancel_promo_banner(p_banner_id uuid, p_reason text, p_phone text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_instructor_id uuid;
  v_cancelled_at timestamptz;
BEGIN
  SELECT instructor_id, cancelled_at INTO v_instructor_id, v_cancelled_at FROM promo_banners WHERE id = p_banner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promo banner not found.';
  END IF;
  IF auth.uid() IS NULL OR v_instructor_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: only the owner can cancel this banner.';
  END IF;
  IF v_cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Promo banner is already cancelled.';
  END IF;
  UPDATE promo_banners SET cancelled_at = now(), cancel_reason = p_reason, cancel_contact_phone = p_phone WHERE id = p_banner_id;
END;
$function$


-- Grants for cancel_promo_banner:
GRANT EXECUTE ON FUNCTION public.cancel_promo_banner(p_banner_id uuid, p_reason text, p_phone text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_promo_banner(p_banner_id uuid, p_reason text, p_phone text) TO service_role;

-- Function: consume_promotion_order
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.consume_promotion_order(p_order_id uuid, p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id     uuid;
  v_order         public.promotion_orders%ROWTYPE;
  v_payment       RECORD;
  v_boost_id      uuid;
  v_banner_id     uuid;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required';
  END IF;

  -- Lock the order row — prevents concurrent consumption (replay protection)
  SELECT * INTO v_order
  FROM public.promotion_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  -- Verify payer identity
  IF v_order.payer_id != v_caller_id THEN
    RAISE EXCEPTION 'Unauthorized: order does not belong to the current user';
  END IF;

  -- Replay protection: order must still be pending
  IF v_order.status != 'pending' THEN
    RAISE EXCEPTION 'Order has already been consumed or voided (status: %)', v_order.status;
  END IF;

  -- Validate the payment record
  SELECT id, student_id, amount, currency, payment_status, verification_status
  INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment record not found: %', p_payment_id;
  END IF;

  -- Payer must be the payment's student_id
  IF v_payment.student_id != v_caller_id THEN
    RAISE EXCEPTION 'Unauthorized: payment does not belong to the current user';
  END IF;

  -- Payment must be paid
  IF v_payment.payment_status != 'paid' THEN
    RAISE EXCEPTION 'Payment is not in paid status (current: %)', v_payment.payment_status;
  END IF;

  -- Payment must be verified
  IF v_payment.verification_status != 'verified' THEN
    RAISE EXCEPTION 'Payment is not verified (current: %)', v_payment.verification_status;
  END IF;

  -- Amount must exactly match canonical price
  IF v_payment.amount != v_order.canonical_amount THEN
    RAISE EXCEPTION 'Payment amount (%) does not match canonical order amount (%)',
      v_payment.amount, v_order.canonical_amount;
  END IF;

  -- Currency must match
  IF v_payment.currency IS DISTINCT FROM v_order.currency THEN
    RAISE EXCEPTION 'Payment currency (%) does not match order currency (%)',
      v_payment.currency, v_order.currency;
  END IF;

  -- Mark order consumed BEFORE inserting grants (rollback restores 'pending' if grants fail)
  UPDATE public.promotion_orders
  SET status = 'paid_consumed', payment_id = p_payment_id, consumed_at = now()
  WHERE id = p_order_id;

  -- Grant boost if applicable
  IF v_order.product_type IN ('boost', 'boost_and_banner') THEN
    INSERT INTO public.boosts (
      entity_type, entity_id, instructor_id,
      plan_days, amount_paid, payment_id,
      starts_at, ends_at
    ) VALUES (
      v_order.entity_type, v_order.entity_id, v_caller_id,
      v_order.plan_days,
      CASE v_order.product_type
        WHEN 'boost_and_banner' THEN v_order.canonical_amount / 2
        ELSE v_order.canonical_amount
      END,
      p_payment_id,
      now(),
      now() + (v_order.plan_days || ' days')::interval
    ) RETURNING id INTO v_boost_id;
  END IF;

  -- Grant banner if applicable
  IF v_order.product_type IN ('banner', 'boost_and_banner') THEN
    INSERT INTO public.promo_banners (
      entity_type, entity_id, instructor_id,
      banner_text, plan_days, amount_paid, payment_id,
      starts_at, ends_at
    ) VALUES (
      v_order.entity_type, v_order.entity_id, v_caller_id,
      COALESCE(v_order.banner_text, ''),
      v_order.plan_days,
      CASE v_order.product_type
        WHEN 'boost_and_banner' THEN v_order.canonical_amount / 2
        ELSE v_order.canonical_amount
      END,
      p_payment_id,
      now(),
      now() + (v_order.plan_days || ' days')::interval
    ) RETURNING id INTO v_banner_id;
  END IF;

  RETURN jsonb_build_object(
    'success',      true,
    'order_id',     p_order_id,
    'boost_id',     v_boost_id,
    'banner_id',    v_banner_id,
    'product_type', v_order.product_type
  );
END;
$function$


-- Grants for consume_promotion_order:
GRANT EXECUTE ON FUNCTION public.consume_promotion_order(p_order_id uuid, p_payment_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_promotion_order(p_order_id uuid, p_payment_id uuid) TO service_role;

-- Function: create_promotion_order
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.create_promotion_order(p_product_type text, p_entity_type text, p_entity_id uuid, p_plan_days integer, p_banner_text text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id       uuid;
  v_owned           boolean;
  v_boost_price     numeric;
  v_banner_price    numeric;
  v_boost_enabled   boolean;
  v_banner_enabled  boolean;
  v_min_days        integer;
  v_max_days        integer;
  v_canonical       numeric;
  v_order_id        uuid;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required';
  END IF;

  IF p_product_type NOT IN ('boost', 'banner', 'boost_and_banner') THEN
    RAISE EXCEPTION 'Invalid product_type: %', p_product_type;
  END IF;

  IF p_entity_type = 'course' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.courses
      WHERE id = p_entity_id
        AND instructor_id = v_caller_id
        AND deleted_at IS NULL
    ) INTO v_owned;
    IF NOT v_owned THEN
      RAISE EXCEPTION 'Unauthorized: course does not belong to the current user or does not exist';
    END IF;
  ELSIF p_entity_type = 'mentor' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.mentorship_profiles
      WHERE id = p_entity_id
        AND instructor_id = v_caller_id
        AND deleted_at IS NULL
    ) INTO v_owned;
    IF NOT v_owned THEN
      RAISE EXCEPTION 'Unauthorized: mentor profile does not belong to the current user or does not exist';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported entity_type: %. Must be ''course'' or ''mentor''.', p_entity_type;
  END IF;

  SELECT
    CASE WHEN p_entity_type = 'course' THEN course_boost_price_per_day ELSE mentor_boost_price_per_day END,
    CASE WHEN p_entity_type = 'course' THEN course_banner_price_per_day ELSE mentor_banner_price_per_day END,
    CASE WHEN p_entity_type = 'course' THEN course_boost_enabled ELSE mentor_boost_enabled END,
    CASE WHEN p_entity_type = 'course' THEN course_banner_enabled ELSE mentor_banner_enabled END,
    COALESCE(boost_min_days, 1),
    COALESCE(boost_max_days, 90)
  INTO v_boost_price, v_banner_price, v_boost_enabled, v_banner_enabled, v_min_days, v_max_days
  FROM public.platform_settings
  LIMIT 1;

  IF p_product_type IN ('boost', 'boost_and_banner') AND v_boost_enabled IS FALSE THEN
    RAISE EXCEPTION 'Boosting is currently disabled for % entities', p_entity_type;
  END IF;
  IF p_product_type IN ('banner', 'boost_and_banner') AND v_banner_enabled IS FALSE THEN
    RAISE EXCEPTION 'Banners are currently disabled for % entities', p_entity_type;
  END IF;

  IF p_plan_days < v_min_days OR p_plan_days > v_max_days THEN
    RAISE EXCEPTION 'plan_days must be between % and %', v_min_days, v_max_days;
  END IF;

  v_canonical :=
    CASE p_product_type
      WHEN 'boost'            THEN v_boost_price  * p_plan_days
      WHEN 'banner'           THEN v_banner_price * p_plan_days
      WHEN 'boost_and_banner' THEN (v_boost_price + v_banner_price) * p_plan_days
    END;

  INSERT INTO public.promotion_orders (
    payer_id, product_type, entity_type, entity_id,
    plan_days, canonical_amount, currency, banner_text, status
  ) VALUES (
    v_caller_id, p_product_type, p_entity_type, p_entity_id,
    p_plan_days, v_canonical, 'USD', p_banner_text, 'pending'
  ) RETURNING id INTO v_order_id;

  RETURN jsonb_build_object(
    'order_id',         v_order_id,
    'canonical_amount', v_canonical,
    'currency',         'USD',
    'product_type',     p_product_type,
    'entity_type',      p_entity_type,
    'entity_id',        p_entity_id,
    'plan_days',        p_plan_days
  );
END;
$function$


-- Grants for create_promotion_order:
GRANT EXECUTE ON FUNCTION public.create_promotion_order(p_product_type text, p_entity_type text, p_entity_id uuid, p_plan_days integer, p_banner_text text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_promotion_order(p_product_type text, p_entity_type text, p_entity_id uuid, p_plan_days integer, p_banner_text text) TO service_role;

-- Function: get_active_promo_banners
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=True, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.get_active_promo_banners(p_entity_type text)
 RETURNS TABLE(entity_id uuid, banner_text text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT pb.entity_id, pb.banner_text
  FROM promo_banners pb
  WHERE pb.entity_type = p_entity_type
    AND pb.ends_at > now()
    AND pb.cancelled_at IS NULL;
END;
$function$


-- Grants for get_active_promo_banners:
GRANT EXECUTE ON FUNCTION public.get_active_promo_banners(p_entity_type text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_active_promo_banners(p_entity_type text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_promo_banners(p_entity_type text) TO service_role;

-- Function: get_boosted_entity_ids
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=True, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.get_boosted_entity_ids(p_entity_type text)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_window_minutes integer;
BEGIN
  SELECT COALESCE(boost_rotation_window_minutes, 3) INTO v_window_minutes
  FROM platform_settings
  LIMIT 1;

  RETURN QUERY
  SELECT entity_id
  FROM active_boosts_view
  WHERE entity_type = p_entity_type
  ORDER BY 
    md5(entity_id::text || floor(extract(epoch from now()) / (v_window_minutes * 60))::text) ASC;
END;
$function$


-- Grants for get_boosted_entity_ids:
GRANT EXECUTE ON FUNCTION public.get_boosted_entity_ids(p_entity_type text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_boosted_entity_ids(p_entity_type text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_boosted_entity_ids(p_entity_type text) TO service_role;

-- Function: purchase_boost
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=False, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.purchase_boost(p_entity_type text, p_entity_id uuid, p_plan_days integer, p_amount_paid numeric, p_payment_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_boost_id uuid;
BEGIN
  -- We trust the caller (Edge Function) provided a valid payment_id

  -- Insert into boosts
  INSERT INTO boosts (
    entity_type,
    entity_id,
    instructor_id,
    plan_days,
    amount_paid,
    payment_id,
    starts_at,
    ends_at
  ) VALUES (
    p_entity_type,
    p_entity_id,
    auth.uid(),
    p_plan_days,
    p_amount_paid,
    p_payment_id,
    now(),
    now() + (p_plan_days || ' days')::interval
  ) RETURNING id INTO v_boost_id;

  RETURN v_boost_id;
END;
$function$


-- Grants for purchase_boost:
GRANT EXECUTE ON FUNCTION public.purchase_boost(p_entity_type text, p_entity_id uuid, p_plan_days integer, p_amount_paid numeric, p_payment_id uuid) TO service_role;

-- Function: purchase_boost
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=False, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.purchase_boost(p_entity_type text, p_entity_id uuid, p_instructor_id uuid, p_plan_days integer, p_amount_paid numeric, p_payment_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_boost_id uuid;
BEGIN
  -- We trust the caller (Edge Function) provided a valid payment_id

  -- Insert into boosts
  INSERT INTO boosts (
    entity_type,
    entity_id,
    instructor_id,
    plan_days,
    amount_paid,
    payment_id,
    starts_at,
    ends_at
  ) VALUES (
    p_entity_type,
    p_entity_id,
    p_instructor_id,
    p_plan_days,
    p_amount_paid,
    p_payment_id,
    now(),
    now() + (p_plan_days || ' days')::interval
  ) RETURNING id INTO v_boost_id;

  RETURN v_boost_id;
END;
$function$


-- Grants for purchase_boost:
GRANT EXECUTE ON FUNCTION public.purchase_boost(p_entity_type text, p_entity_id uuid, p_instructor_id uuid, p_plan_days integer, p_amount_paid numeric, p_payment_id uuid) TO service_role;

-- Function: purchase_boost_and_banner_atomic
-- SECURITY DEFINER: False
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=False, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.purchase_boost_and_banner_atomic(p_entity_type text, p_entity_id uuid, p_instructor_id uuid, p_plan_days integer, p_boost_amount_paid numeric, p_banner_amount_paid numeric, p_banner_text text, p_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM purchase_boost(
    p_entity_type,
    p_entity_id,
    p_instructor_id,
    p_plan_days,
    p_boost_amount_paid,
    p_payment_id
  );
  
  PERFORM purchase_promo_banner(
    p_entity_type,
    p_entity_id,
    p_instructor_id,
    p_banner_text,
    p_plan_days,
    p_banner_amount_paid,
    p_payment_id
  );
END;
$function$


-- Grants for purchase_boost_and_banner_atomic:
GRANT EXECUTE ON FUNCTION public.purchase_boost_and_banner_atomic(p_entity_type text, p_entity_id uuid, p_instructor_id uuid, p_plan_days integer, p_boost_amount_paid numeric, p_banner_amount_paid numeric, p_banner_text text, p_payment_id uuid) TO service_role;

-- Function: purchase_promo_banner
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=False, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.purchase_promo_banner(p_entity_type text, p_entity_id uuid, p_banner_text text, p_plan_days integer, p_amount_paid numeric, p_payment_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_banner_id uuid;
BEGIN
  -- Insert into promo_banners
  INSERT INTO promo_banners (
    entity_type,
    entity_id,
    instructor_id,
    banner_text,
    plan_days,
    amount_paid,
    payment_id,
    starts_at,
    ends_at
  ) VALUES (
    p_entity_type,
    p_entity_id,
    auth.uid(),
    p_banner_text,
    p_plan_days,
    p_amount_paid,
    p_payment_id,
    now(),
    now() + (p_plan_days || ' days')::interval
  ) RETURNING id INTO v_banner_id;

  RETURN v_banner_id;
END;
$function$


-- Grants for purchase_promo_banner:
GRANT EXECUTE ON FUNCTION public.purchase_promo_banner(p_entity_type text, p_entity_id uuid, p_banner_text text, p_plan_days integer, p_amount_paid numeric, p_payment_id uuid) TO service_role;

-- Function: purchase_promo_banner
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=False, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.purchase_promo_banner(p_entity_type text, p_entity_id uuid, p_instructor_id uuid, p_banner_text text, p_plan_days integer, p_amount_paid numeric, p_payment_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_banner_id uuid;
BEGIN
  -- Insert into promo_banners
  INSERT INTO promo_banners (
    entity_type,
    entity_id,
    instructor_id,
    banner_text,
    plan_days,
    amount_paid,
    payment_id,
    starts_at,
    ends_at
  ) VALUES (
    p_entity_type,
    p_entity_id,
    p_instructor_id,
    p_banner_text,
    p_plan_days,
    p_amount_paid,
    p_payment_id,
    now(),
    now() + (p_plan_days || ' days')::interval
  ) RETURNING id INTO v_banner_id;

  RETURN v_banner_id;
END;
$function$


-- Grants for purchase_promo_banner:
GRANT EXECUTE ON FUNCTION public.purchase_promo_banner(p_entity_type text, p_entity_id uuid, p_instructor_id uuid, p_banner_text text, p_plan_days integer, p_amount_paid numeric, p_payment_id uuid) TO service_role;

-- Function: update_promo_banner
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.update_promo_banner(p_banner_id uuid, p_banner_text text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE promo_banners
  SET banner_text = p_banner_text
  WHERE id = p_banner_id
    AND instructor_id = auth.uid()
    AND cancelled_at IS NULL
    AND ends_at > now();
    
  IF FOUND THEN
    RETURN true;
  ELSE
    RETURN false;
  END IF;
END;
$function$


-- Grants for update_promo_banner:
GRANT EXECUTE ON FUNCTION public.update_promo_banner(p_banner_id uuid, p_banner_text text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_promo_banner(p_banner_id uuid, p_banner_text text) TO service_role;

-- ============================================================
-- ADMIN FUNCTIONS
-- ============================================================

-- Function: admin_delete_account
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.admin_delete_account(p_target_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_auth WHERE id = auth.uid() AND role = 'superadmin') THEN
    RAISE EXCEPTION 'Unauthorized: Only superadmins can decommission nodes.';
  END IF;

  DELETE FROM public.admin_auth WHERE id = p_target_id;
END;
$function$


-- Grants for admin_delete_account:
GRANT EXECUTE ON FUNCTION public.admin_delete_account(p_target_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_account(p_target_id uuid) TO service_role;

-- Function: admin_delete_instructor
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.admin_delete_instructor(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Authorization: caller must be a valid admin (auth.uid())
    IF NOT EXISTS (SELECT 1 FROM public.admin_auth WHERE id = auth.uid()) THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can delete instructors.';
    END IF;

    -- Delete the instructor's courses (cascade handles lessons/quizzes)
    DELETE FROM public.courses WHERE instructor_id = p_user_id;

    -- Delete mentorship profile and sessions
    DELETE FROM public.mentorship_sessions WHERE mentor_id = p_user_id;
    DELETE FROM public.mentorship_profiles WHERE instructor_id = p_user_id;

    -- Delete teaching profile
    DELETE FROM public.teaching_profiles WHERE instructor_id = p_user_id;

    -- Delete instructor record
    DELETE FROM public.instructors WHERE user_id = p_user_id;

    -- Delete profile last
    DELETE FROM public.profiles WHERE id = p_user_id;
END;
$function$


-- Grants for admin_delete_instructor:
GRANT EXECUTE ON FUNCTION public.admin_delete_instructor(p_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_instructor(p_user_id uuid) TO service_role;

-- Function: admin_delete_student
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.admin_delete_student(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.admin_auth WHERE id = auth.uid()) THEN
        RAISE EXCEPTION 'Unauthorized: Not a valid admin';
    END IF;

    -- Remove all student-related data
    DELETE FROM public.wishlist WHERE student_id = p_user_id;
    DELETE FROM public.enrollments WHERE student_id = p_user_id;
    DELETE FROM public.lesson_progress WHERE student_id = p_user_id;
    DELETE FROM public.course_reviews WHERE student_id = p_user_id;
    DELETE FROM public.mentorship_reviews WHERE student_id = p_user_id;
    DELETE FROM public.mentorship_booking_messages WHERE sender_id = p_user_id;
    DELETE FROM public.mentorship_sessions WHERE student_id = p_user_id;
    DELETE FROM public.refund_requests WHERE student_id = p_user_id;
    DELETE FROM public.support_tickets WHERE student_id = p_user_id;
    DELETE FROM public.notifications WHERE user_id = p_user_id;

    DELETE FROM public.students WHERE user_id = p_user_id;
    DELETE FROM public.profiles WHERE id = p_user_id;
END;
$function$


-- Grants for admin_delete_student:
GRANT EXECUTE ON FUNCTION public.admin_delete_student(p_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_student(p_user_id uuid) TO service_role;

-- Function: admin_get_all_instructors
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.admin_get_all_instructors()
 RETURNS TABLE(user_id uuid, full_name text, email text, avatar_url text, phone_number text, country text, city text, professional_title text, short_bio text, expertise_list jsonb, approval_status text, verification_status text, total_courses_created bigint, total_sessions bigint, hourly_rate numeric, created_at timestamp with time zone, account_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.admin_auth WHERE id = auth.uid()) THEN
        RAISE EXCEPTION 'Unauthorized: Not a valid admin';
    END IF;

    RETURN QUERY
    SELECT
        p.id AS user_id,
        p.full_name,
        p.email,
        p.avatar_url,
        p.phone_number,
        p.country,
        p.city,
        p.professional_title,
        p.short_bio,
        p.expertise_list,
        COALESCE(i.approval_status, 'pending')::TEXT AS approval_status,
        COALESCE(i.verification_status, 'unverified')::TEXT AS verification_status,
        COALESCE(i.total_courses_created, 0)::BIGINT AS total_courses_created,
        COALESCE(mp.total_sessions, 0)::BIGINT AS total_sessions,
        COALESCE(mp.hourly_rate, 0)::NUMERIC AS hourly_rate,
        p.created_at,
        p.account_status::TEXT
    FROM public.profiles p
    LEFT JOIN public.instructors i ON i.user_id = p.id
    LEFT JOIN public.mentorship_profiles mp ON mp.instructor_id = p.id AND mp.deleted_at IS NULL
    WHERE p.role = 'instructor'
    ORDER BY p.created_at DESC;
END;
$function$


-- Grants for admin_get_all_instructors:
GRANT EXECUTE ON FUNCTION public.admin_get_all_instructors() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_all_instructors() TO service_role;

-- Function: admin_get_all_mentorship_sessions
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres
CREATE OR REPLACE FUNCTION public.admin_get_all_mentorship_sessions(p_admin_id uuid)
 RETURNS TABLE(id uuid, student_id uuid, mentor_id uuid, scheduled_at timestamp with time zone, status text, notes text, created_at timestamp with time zone, meeting_type text, meeting_location text, student_phone text, topic text, meeting_link text, booking_status text, mentor_notes text, rejection_note text, duration_minutes integer, mentorship_type text, program_start_date timestamp with time zone, end_date timestamp with time zone, duration_days integer, total_sessions integer, completed_sessions_count integer, reschedule_requested_by text, reschedule_note text, reschedule_history jsonb, student jsonb, mentor jsonb, session_serial_id integer, mentor_serial_id integer, payment_serial_id integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_is_admin boolean;
BEGIN
    SELECT EXISTS (SELECT 1 FROM public.admin_auth aa WHERE aa.id = auth.uid() AND COALESCE(aa.is_suspended, false) = false) INTO v_is_admin;
    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'Unauthorized: Not a valid admin';
    END IF;

    RETURN QUERY
    SELECT
        ms.id, ms.student_id, ms.mentor_id, ms.scheduled_at, ms.status::text, ms.notes,
        ms.created_at, ms.meeting_type, ms.meeting_location, ms.student_phone,
        ms.topic, ms.meeting_link, ms.booking_status, ms.mentor_notes,
        ms.rejection_note, ms.duration_minutes,
        ms.mentorship_type, ms.program_start_date, ms.end_date, ms.duration_days,
        ms.total_sessions, ms.completed_sessions_count,
        ms.reschedule_requested_by, ms.reschedule_note, ms.reschedule_history,
        jsonb_build_object('id', sp.id, 'full_name', sp.full_name, 'avatar_url', sp.avatar_url, 'email', sp.email, 'phone_number', sp.phone_number, 'social_links', sp.social_links) AS student,
        jsonb_build_object('id', mp.id, 'full_name', mp.full_name, 'avatar_url', mp.avatar_url, 'email', mp.email, 'phone_number', mp.phone_number) AS mentor,
        ms.serial_id AS session_serial_id,
        mp.serial_id AS mentor_serial_id,
        pay.serial_id AS payment_serial_id
    FROM public.mentorship_sessions ms
    LEFT JOIN public.profiles sp ON sp.id = ms.student_id
    LEFT JOIN public.profiles mp ON mp.id = ms.mentor_id
    LEFT JOIN public.payments pay ON pay.mentorship_session_id = ms.id
    ORDER BY ms.created_at DESC;
END;
$function$


-- Grants for admin_get_all_mentorship_sessions:
GRANT EXECUTE ON FUNCTION public.admin_get_all_mentorship_sessions(p_admin_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_all_mentorship_sessions(p_admin_id uuid) TO service_role;

-- Function: admin_get_all_students
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.admin_get_all_students(p_admin_id uuid)
 RETURNS TABLE(user_id uuid, full_name text, email text, avatar_url text, phone_number text, country text, city text, gender text, social_links jsonb, account_status text, last_login_timestamp timestamp with time zone, total_enrolled_courses bigint, created_at timestamp with time zone, learning_interests jsonb, short_bio text, professional_title text, role text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Security: verify caller is actually an admin
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Authentication required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.admin_auth WHERE id = auth.uid()) THEN
        RAISE EXCEPTION 'Unauthorized: Not a valid admin';
    END IF;

    RETURN QUERY
    SELECT
        p.id AS user_id,
        p.full_name,
        p.email,
        p.avatar_url,
        p.phone_number,
        p.country,
        p.city,
        p.gender,
        p.social_links,
        COALESCE(p.account_status, 'active') AS account_status,
        s.last_login_timestamp,
        (SELECT COUNT(*)::bigint FROM public.enrollments e WHERE e.student_id = p.id) AS total_enrolled_courses,
        p.created_at,
        p.learning_interests,
        p.short_bio,
        p.professional_title,
        p.role::text
    FROM public.profiles p
    LEFT JOIN public.students s ON s.user_id = p.id
    WHERE p.role = 'student'
    ORDER BY p.created_at DESC;
END;
$function$


-- Grants for admin_get_all_students:
GRANT EXECUTE ON FUNCTION public.admin_get_all_students(p_admin_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_all_students(p_admin_id uuid) TO service_role;

-- Function: admin_get_backup_password
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.admin_get_backup_password(p_target_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_username TEXT;
  v_password TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_auth WHERE id = auth.uid() AND role = 'superadmin') THEN
    RAISE EXCEPTION 'Unauthorized: Only superadmins can view administrative credentials.';
  END IF;

  SELECT username, backup_password_enc INTO v_username, v_password FROM public.admin_auth WHERE id = p_target_id;
  RETURN v_username || ':' || v_password;
END;
$function$


-- Grants for admin_get_backup_password:
GRANT EXECUTE ON FUNCTION public.admin_get_backup_password(p_target_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_backup_password(p_target_id uuid) TO service_role;

-- Function: admin_get_session_details
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres
CREATE OR REPLACE FUNCTION public.admin_get_session_details(p_admin_id uuid, p_session_id uuid)
 RETURNS TABLE(id uuid, student_id uuid, mentor_id uuid, scheduled_at timestamp with time zone, status text, booking_status text, meeting_type text, meeting_link text, meeting_location text, topic text, rejection_note text, created_at timestamp with time zone, duration_minutes integer, mentor_full_name text, mentor_avatar_url text, mentorship_type text, program_start_date timestamp with time zone, end_date timestamp with time zone, duration_days integer, total_sessions integer, completed_sessions_count integer, payment_serial_id integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.admin_auth WHERE admin_auth.id = auth.uid() AND COALESCE(admin_auth.is_suspended, false) = false) THEN
        RAISE EXCEPTION 'Unauthorized: Not a valid admin';
    END IF;

    RETURN QUERY
    SELECT
        s.id, s.student_id, s.mentor_id, s.scheduled_at, s.status, s.booking_status,
        s.meeting_type, s.meeting_link, s.meeting_location, s.topic, s.rejection_note,
        s.created_at, s.duration_minutes, p.full_name AS mentor_full_name, p.avatar_url AS mentor_avatar_url,
        s.mentorship_type, s.program_start_date, s.end_date, s.duration_days, s.total_sessions, s.completed_sessions_count,
        pay.serial_id AS payment_serial_id
    FROM public.mentorship_sessions s
    LEFT JOIN public.profiles p ON p.id = s.mentor_id
    LEFT JOIN public.payments pay ON pay.mentorship_session_id = s.id
    WHERE s.id = p_session_id
    LIMIT 1;
END;
$function$


-- Grants for admin_get_session_details:
GRANT EXECUTE ON FUNCTION public.admin_get_session_details(p_admin_id uuid, p_session_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_session_details(p_admin_id uuid, p_session_id uuid) TO service_role;

-- Function: admin_get_student_enrollments
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.admin_get_student_enrollments(p_admin_id uuid, p_student_id uuid)
 RETURNS TABLE(enrolled_at timestamp with time zone, progress_percentage integer, course_id uuid, title text, thumbnail_url text, serial_id integer, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Security
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Authentication required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.admin_auth WHERE id = auth.uid()) THEN
        RAISE EXCEPTION 'Unauthorized: Not a valid admin';
    END IF;

    RETURN QUERY
    SELECT 
        e.enrolled_at,
        e.progress_percentage,
        c.id AS course_id,
        c.title,
        c.thumbnail_url,
        c.serial_id,
        c.status::text
    FROM public.enrollments e
    JOIN public.courses c ON c.id = e.course_id
    WHERE e.student_id = p_student_id
    ORDER BY e.enrolled_at DESC;
END;
$function$


-- Grants for admin_get_student_enrollments:
GRANT EXECUTE ON FUNCTION public.admin_get_student_enrollments(p_admin_id uuid, p_student_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_student_enrollments(p_admin_id uuid, p_student_id uuid) TO service_role;

-- Function: admin_reschedule_session
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.admin_reschedule_session(p_admin_id uuid, p_session_id uuid, p_new_scheduled_at timestamp with time zone, p_new_duration_minutes integer, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_is_admin boolean;
    v_total_sessions integer;
    v_completed integer;
    v_mentorship_type text;
    v_remaining integer;
    v_new_end_date timestamptz;
    v_previous_scheduled_at timestamptz;
    v_previous_duration integer;
    v_meetings_held integer;
    v_current_candidate timestamptz;
    v_candidate_end timestamptz;
BEGIN
    SELECT EXISTS (SELECT 1 FROM public.admin_auth WHERE id = auth.uid() AND COALESCE(is_suspended, false) = false) INTO v_is_admin;
    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'Unauthorized: not a valid admin';
    END IF;

    SELECT total_sessions, COALESCE(completed_sessions_count, 0), mentorship_type, scheduled_at, duration_minutes
    INTO v_total_sessions, v_completed, v_mentorship_type, v_previous_scheduled_at, v_previous_duration
    FROM public.mentorship_sessions WHERE id = p_session_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF v_mentorship_type = 'program' THEN
        v_meetings_held := 0;
        v_current_candidate := v_previous_scheduled_at;
        WHILE true LOOP
            v_candidate_end := v_current_candidate + (v_previous_duration || ' minutes')::interval;
            IF v_current_candidate > now() THEN
                EXIT;
            END IF;
            IF now() >= v_candidate_end THEN
                v_meetings_held := v_meetings_held + 1;
            END IF;
            v_current_candidate := v_current_candidate + interval '24 hours';
        END LOOP;

        -- ADDITIVE, not GREATEST: previously-banked progress plus newly-elapsed
        -- sessions under the anchor being replaced. GREATEST silently discarded
        -- real elapsed sessions whenever a reschedule moved the anchor forward.
        v_completed := v_completed + v_meetings_held;
        v_remaining := GREATEST(v_total_sessions - v_completed, 1);
        v_new_end_date := p_new_scheduled_at + ((v_remaining - 1) || ' days')::interval;

        UPDATE public.mentorship_sessions
        SET scheduled_at = p_new_scheduled_at,
            duration_minutes = COALESCE(p_new_duration_minutes, duration_minutes),
            end_date = v_new_end_date,
            completed_sessions_count = v_completed,
            reschedule_requested_by = 'admin',
            reschedule_note = p_note,
            reschedule_history = COALESCE(reschedule_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                'previous_scheduled_at', v_previous_scheduled_at,
                'previous_duration', v_previous_duration,
                'note', p_note,
                'requested_by', 'admin',
                'rescheduled_at', now()
            ))
        WHERE id = p_session_id;
    ELSE
        UPDATE public.mentorship_sessions
        SET scheduled_at = p_new_scheduled_at,
            duration_minutes = COALESCE(p_new_duration_minutes, duration_minutes),
            reschedule_requested_by = 'admin',
            reschedule_note = p_note,
            reschedule_history = COALESCE(reschedule_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                'previous_scheduled_at', v_previous_scheduled_at,
                'previous_duration', v_previous_duration,
                'note', p_note,
                'requested_by', 'admin',
                'rescheduled_at', now()
            ))
        WHERE id = p_session_id;
    END IF;
END;
$function$


-- Grants for admin_reschedule_session:
GRANT EXECUTE ON FUNCTION public.admin_reschedule_session(p_admin_id uuid, p_session_id uuid, p_new_scheduled_at timestamp with time zone, p_new_duration_minutes integer, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reschedule_session(p_admin_id uuid, p_session_id uuid, p_new_scheduled_at timestamp with time zone, p_new_duration_minutes integer, p_note text) TO service_role;

-- Function: admin_toggle_suspension
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.admin_toggle_suspension(p_target_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_auth WHERE id = auth.uid() AND role = 'superadmin') THEN
    RAISE EXCEPTION 'Unauthorized: Only superadmins can manage account status.';
  END IF;

  UPDATE public.admin_auth
  SET is_suspended = NOT is_suspended
  WHERE id = p_target_id;
END;
$function$


-- Grants for admin_toggle_suspension:
GRANT EXECUTE ON FUNCTION public.admin_toggle_suspension(p_target_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_toggle_suspension(p_target_id uuid) TO service_role;

-- Function: admin_update_instructor_status
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres
CREATE OR REPLACE FUNCTION public.admin_update_instructor_status(p_admin_id uuid, p_user_id uuid, p_approval_status text DEFAULT NULL::text, p_verification_status text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_auth WHERE id = auth.uid() AND role IN ('superadmin', 'course_manager')) THEN
    RAISE EXCEPTION 'Unauthorized: Not a valid admin';
  END IF;

  INSERT INTO public.instructors (user_id, approval_status, verification_status)
  VALUES (p_user_id, p_approval_status, p_verification_status)
  ON CONFLICT (user_id) DO UPDATE SET
      approval_status = COALESCE(EXCLUDED.approval_status, instructors.approval_status),
      verification_status = COALESCE(EXCLUDED.verification_status, instructors.verification_status);
END;
$function$


-- Grants for admin_update_instructor_status:
GRANT EXECUTE ON FUNCTION public.admin_update_instructor_status(p_admin_id uuid, p_user_id uuid, p_approval_status text, p_verification_status text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_instructor_status(p_admin_id uuid, p_user_id uuid, p_approval_status text, p_verification_status text) TO service_role;

-- Function: admin_update_session_status
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.admin_update_session_status(p_admin_id uuid, p_session_id uuid, p_booking_status text, p_rejection_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_legacy_status text;
    v_is_admin boolean;
BEGIN
    SELECT EXISTS (SELECT 1 FROM public.admin_auth aa WHERE aa.id = auth.uid() AND COALESCE(aa.is_suspended, false) = false) INTO v_is_admin;
    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'Unauthorized: Not a valid admin';
    END IF;

    v_legacy_status := CASE p_booking_status
        WHEN 'pending_review'           THEN 'pending'
        WHEN 'pending_rejection_review' THEN 'pending'
        WHEN 'awaiting_meeting_link'    THEN 'confirmed'
        WHEN 'location_negotiation'     THEN 'negotiating'
        WHEN 'confirmed'                THEN 'confirmed'
        WHEN 'completed'                THEN 'completed'
        WHEN 'cancelled'                THEN 'cancelled'
        ELSE 'upcoming'
    END;

    UPDATE public.mentorship_sessions ms
    SET booking_status = p_booking_status, status = v_legacy_status, rejection_note = COALESCE(p_rejection_note, ms.rejection_note)
    WHERE ms.id = p_session_id;
END;
$function$


-- Grants for admin_update_session_status:
GRANT EXECUTE ON FUNCTION public.admin_update_session_status(p_admin_id uuid, p_session_id uuid, p_booking_status text, p_rejection_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_session_status(p_admin_id uuid, p_session_id uuid, p_booking_status text, p_rejection_note text) TO service_role;

-- Function: admin_update_student_status
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres
CREATE OR REPLACE FUNCTION public.admin_update_student_status(p_admin_id uuid, p_user_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_auth WHERE id = v_caller_id AND role IN ('superadmin', 'course_manager')) THEN
    RAISE EXCEPTION 'Unauthorized: Not a valid admin';
  END IF;

  UPDATE public.profiles
  SET account_status = p_status, updated_at = now()
  WHERE id = p_user_id;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND role = 'student') THEN
    INSERT INTO public.students (user_id, account_status)
    VALUES (p_user_id, p_status)
    ON CONFLICT (user_id) DO UPDATE SET account_status = p_status;
  END IF;

  INSERT INTO public.admin_audit_logs (admin_id, action, entity_type, entity_id, details)
  VALUES (v_caller_id, 'update_status', 'student', p_user_id, jsonb_build_object('new_status', p_status));
END;
$function$


-- Grants for admin_update_student_status:
GRANT EXECUTE ON FUNCTION public.admin_update_student_status(p_admin_id uuid, p_user_id uuid, p_status text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_student_status(p_admin_id uuid, p_user_id uuid, p_status text) TO service_role;

-- Function: check_is_admin
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.check_is_admin()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_auth
    WHERE id = auth.uid()
  );
$function$


-- Grants for check_is_admin:
GRANT EXECUTE ON FUNCTION public.check_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_is_admin() TO service_role;

-- Function: check_is_course_admin
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.check_is_course_admin()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.admin_auth WHERE id = auth.uid() AND role IN ('superadmin', 'course_manager'));
$function$


-- Grants for check_is_course_admin:
GRANT EXECUTE ON FUNCTION public.check_is_course_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_is_course_admin() TO service_role;

-- Function: check_is_finance_admin
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.check_is_finance_admin()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.admin_auth WHERE id = auth.uid() AND role IN ('superadmin', 'finance_manager'));
$function$


-- Grants for check_is_finance_admin:
GRANT EXECUTE ON FUNCTION public.check_is_finance_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_is_finance_admin() TO service_role;

-- Function: check_is_superadmin
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.check_is_superadmin()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_auth
    WHERE id = auth.uid() AND role = 'superadmin'
  );
$function$


-- Grants for check_is_superadmin:
GRANT EXECUTE ON FUNCTION public.check_is_superadmin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_is_superadmin() TO service_role;

-- Function: create_admin_account
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres
CREATE OR REPLACE FUNCTION public.create_admin_account(p_admin_id uuid, p_full_name text, p_role text, p_caller_id uuid, p_username text DEFAULT NULL::text, p_backup_password text DEFAULT NULL::text, p_backup_email text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_phone text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_auth
    WHERE id = auth.uid() AND role = 'superadmin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only superadmins can provision administrative accounts.';
  END IF;

  INSERT INTO public.admin_auth (
    id, full_name, role, username, backup_password_enc, backup_email,
    address, city, phone_number
  )
  VALUES (
    p_admin_id, p_full_name, p_role, p_username, p_backup_password,
    p_backup_email, p_address, p_city, p_phone
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    username = COALESCE(EXCLUDED.username, admin_auth.username),
    backup_password_enc = COALESCE(EXCLUDED.backup_password_enc, admin_auth.backup_password_enc),
    backup_email = COALESCE(EXCLUDED.backup_email, admin_auth.backup_email),
    address = COALESCE(EXCLUDED.address, admin_auth.address),
    city = COALESCE(EXCLUDED.city, admin_auth.city),
    phone_number = COALESCE(EXCLUDED.phone_number, admin_auth.phone_number);
END;
$function$


-- Grants for create_admin_account:
GRANT EXECUTE ON FUNCTION public.create_admin_account(p_admin_id uuid, p_full_name text, p_role text, p_caller_id uuid, p_username text, p_backup_password text, p_backup_email text, p_address text, p_city text, p_phone text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_admin_account(p_admin_id uuid, p_full_name text, p_role text, p_caller_id uuid, p_username text, p_backup_password text, p_backup_email text, p_address text, p_city text, p_phone text) TO service_role;

-- Function: create_admin_account
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres
CREATE OR REPLACE FUNCTION public.create_admin_account(p_admin_id uuid, p_full_name text, p_role text, p_username text, p_backup_password text, p_caller_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_auth
    WHERE id = auth.uid() AND role = 'superadmin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only superadmins can deploy new nodes.';
  END IF;

  INSERT INTO public.admin_auth (id, full_name, role, username, backup_password_enc)
  VALUES (p_admin_id, p_full_name, p_role, p_username, p_backup_password)
  ON CONFLICT (id) DO UPDATE SET
    full_name = p_full_name,
    role = p_role,
    username = p_username,
    backup_password_enc = p_backup_password;
END;
$function$


-- Grants for create_admin_account:
GRANT EXECUTE ON FUNCTION public.create_admin_account(p_admin_id uuid, p_full_name text, p_role text, p_username text, p_backup_password text, p_caller_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_admin_account(p_admin_id uuid, p_full_name text, p_role text, p_username text, p_backup_password text, p_caller_id uuid) TO service_role;

-- Function: create_admin_account
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.create_admin_account(p_username text, p_password text, p_full_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_user_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_auth
    WHERE id = auth.uid() AND role = 'superadmin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only SuperAdmins can create accounts';
  END IF;

  INSERT INTO public.profiles (full_name, role, profile_completed)
  VALUES (p_full_name, 'admin', true)
  RETURNING id INTO new_user_id;

  INSERT INTO public.admin_auth (id, username, password_hash)
  VALUES (new_user_id, p_username, p_password);

  RETURN new_user_id;
END;
$function$


-- Grants for create_admin_account:
GRANT EXECUTE ON FUNCTION public.create_admin_account(p_username text, p_password text, p_full_name text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_admin_account(p_username text, p_password text, p_full_name text) TO service_role;

-- Function: create_admin_account
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres
CREATE OR REPLACE FUNCTION public.create_admin_account(p_admin_id uuid, p_full_name text, p_role text, p_caller_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_auth
    WHERE id = auth.uid() AND role = 'superadmin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only SuperAdmins can create accounts';
  END IF;

  INSERT INTO public.admin_auth (id, full_name, role)
  VALUES (p_admin_id, p_full_name, p_role)
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name, role = EXCLUDED.role;

  INSERT INTO public.admin_audit_logs (admin_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'CREATE_ADMIN', 'admin_auth', p_admin_id,
          jsonb_build_object('full_name', p_full_name, 'role', p_role));
END;
$function$


-- Grants for create_admin_account:
GRANT EXECUTE ON FUNCTION public.create_admin_account(p_admin_id uuid, p_full_name text, p_role text, p_caller_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_admin_account(p_admin_id uuid, p_full_name text, p_role text, p_caller_id uuid) TO service_role;

-- Function: create_admin_account
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres
CREATE OR REPLACE FUNCTION public.create_admin_account(p_admin_id uuid, p_full_name text, p_role text, p_username text, p_backup_password text, p_backup_email text, p_caller_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_auth
    WHERE id = auth.uid() AND role = 'superadmin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only superadmins can deploy new nodes.';
  END IF;

  INSERT INTO public.admin_auth (id, full_name, role, username, backup_password_enc, backup_email)
  VALUES (p_admin_id, p_full_name, p_role, p_username, p_backup_password, p_backup_email)
  ON CONFLICT (id) DO UPDATE SET
    full_name = p_full_name,
    role = p_role,
    username = p_username,
    backup_password_enc = p_backup_password,
    backup_email = p_backup_email;
END;
$function$


-- Grants for create_admin_account:
GRANT EXECUTE ON FUNCTION public.create_admin_account(p_admin_id uuid, p_full_name text, p_role text, p_username text, p_backup_password text, p_backup_email text, p_caller_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_admin_account(p_admin_id uuid, p_full_name text, p_role text, p_username text, p_backup_password text, p_backup_email text, p_caller_id uuid) TO service_role;

-- Function: get_admin_stats
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.get_admin_stats()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_auth WHERE id = auth.uid() AND COALESCE(is_suspended,false)=false) THEN RAISE EXCEPTION 'Unauthorized: Not a valid admin'; END IF;
  RETURN json_build_object('total_users',(SELECT count(*) FROM profiles),'total_students',(SELECT count(*) FROM profiles WHERE role='student'),'total_instructors',(SELECT count(*) FROM profiles WHERE role='instructor'),'pending_reviews',(SELECT count(*) FROM courses WHERE status='pending_review'),'pending_rejections',(SELECT count(*) FROM mentorship_sessions WHERE status='pending_rejection'),'pending_finance_tickets',(SELECT count(*) FROM support_tickets WHERE category='finance' AND status='open'),'pending_course_mentor_tickets',(SELECT count(*) FROM support_tickets WHERE category IN ('course','mentor','technical') AND status='open'));
END; $function$


-- Grants for get_admin_stats:
GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO service_role;

-- Function: is_admin
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=True, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_auth
    WHERE id = auth.uid()
  );
$function$


-- Grants for is_admin:
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role;

-- Function: verify_admin_login
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=True, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.verify_admin_login(p_username text, p_password text)
 RETURNS TABLE(out_id uuid, out_username text, out_full_name text, out_role text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        a.id::UUID, 
        a.username::TEXT, 
        p.full_name::TEXT, 
        p.role::TEXT
    FROM admin_auth a
    JOIN profiles p ON a.id = p.id
    WHERE a.username = p_username 
    AND a.password_hash = p_password;
END;
$function$


-- Grants for verify_admin_login:
GRANT EXECUTE ON FUNCTION public.verify_admin_login(p_username text, p_password text) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_admin_login(p_username text, p_password text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_admin_login(p_username text, p_password text) TO service_role;

-- ============================================================
-- INSTRUCTOR / COURSE FUNCTIONS
-- ============================================================

-- Function: appeal_course_rejection_instructor
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.appeal_course_rejection_instructor(p_course_id uuid, p_appeal_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- SECURITY: Only the owning instructor can appeal their own course rejection
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: authentication required';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.courses
        WHERE id = p_course_id AND instructor_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Unauthorized: course does not belong to the current user';
    END IF;

    UPDATE courses SET status = 'appealed' WHERE id = p_course_id AND status = 'rejected';

    INSERT INTO course_moderation_logs (course_id, decision, notes)
    VALUES (p_course_id, 'appealed', p_appeal_reason);
END;
$function$


-- Grants for appeal_course_rejection_instructor:
GRANT EXECUTE ON FUNCTION public.appeal_course_rejection_instructor(p_course_id uuid, p_appeal_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.appeal_course_rejection_instructor(p_course_id uuid, p_appeal_reason text) TO service_role;

-- Function: approve_course_admin
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres
CREATE OR REPLACE FUNCTION public.approve_course_admin(p_course_id uuid, p_moderator_id uuid, p_notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_family_id UUID;
  v_is_revision BOOLEAN;
  v_caller_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required';
  END IF;

  SELECT role INTO v_caller_role
  FROM public.admin_auth
  WHERE id = auth.uid();

  IF v_caller_role NOT IN ('course_manager', 'superadmin') THEN
    RAISE EXCEPTION 'Unauthorized: course-manager privileges required';
  END IF;

  SELECT COALESCE(root_course_id, id), (root_course_id IS NOT NULL)
    INTO v_family_id, v_is_revision
  FROM public.courses WHERE id = p_course_id;

  IF v_family_id IS NULL THEN
    RAISE EXCEPTION 'Course not found';
  END IF;

  IF v_is_revision THEN
    UPDATE public.courses
    SET version_status = 'archived', is_latest_published = false
    WHERE COALESCE(root_course_id, id) = v_family_id
      AND is_latest_published = true;
  END IF;

  UPDATE public.courses
  SET status = 'published',
      version_status = 'published',
      is_latest_published = true,
      rejection_reason = NULL
  WHERE id = p_course_id;

  INSERT INTO public.course_moderation_logs (course_id, moderator_id, decision, notes)
  VALUES (p_course_id, auth.uid(), 'approved', COALESCE(p_notes, 'Approved by Admin'));
END;
$function$


-- Grants for approve_course_admin:
GRANT EXECUTE ON FUNCTION public.approve_course_admin(p_course_id uuid, p_moderator_id uuid, p_notes text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_course_admin(p_course_id uuid, p_moderator_id uuid, p_notes text) TO service_role;

-- Function: approve_course_admin
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.approve_course_admin(p_course_id uuid, p_instructor_id uuid, p_moderator_id uuid, p_notes text DEFAULT 'Approved by Admin'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Delegate to the hardened 3-argument implementation; caller identity is authoritative.
  PERFORM public.approve_course_admin(p_course_id, p_moderator_id, p_notes);
END;
$function$


-- Grants for approve_course_admin:
GRANT EXECUTE ON FUNCTION public.approve_course_admin(p_course_id uuid, p_instructor_id uuid, p_moderator_id uuid, p_notes text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_course_admin(p_course_id uuid, p_instructor_id uuid, p_moderator_id uuid, p_notes text) TO service_role;

-- Function: confirm_course_rejection_instructor
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.confirm_course_rejection_instructor(p_course_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.courses
    WHERE id = p_course_id AND instructor_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: course does not belong to the current user';
  END IF;

  UPDATE courses SET status = 'draft'
  WHERE id = p_course_id AND status = 'rejected';
END;
$function$


-- Grants for confirm_course_rejection_instructor:
GRANT EXECUTE ON FUNCTION public.confirm_course_rejection_instructor(p_course_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_course_rejection_instructor(p_course_id uuid) TO service_role;

-- Function: create_update_offer
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.create_update_offer(p_root_course_id uuid, p_to_version_id uuid, p_coupon_id uuid, p_notify boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count     INTEGER;
  v_family_id UUID;
  v_owner_id  UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required';
  END IF;

  SELECT COALESCE(root_course_id, id), instructor_id INTO v_family_id, v_owner_id
  FROM courses WHERE id = p_root_course_id;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Course not found';
  END IF;

  IF v_owner_id != auth.uid() AND NOT EXISTS (SELECT 1 FROM admin_auth WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized: You can only create update offers for your own courses';
  END IF;

  INSERT INTO course_update_offers (
    root_course_id, from_version_id, to_version_id, coupon_id, student_id, notified_at
  )
  SELECT
    v_family_id, e.course_id, p_to_version_id, p_coupon_id, e.student_id,
    CASE WHEN p_notify THEN now() ELSE NULL END
  FROM enrollments e
  JOIN courses c ON c.id = e.course_id
  WHERE COALESCE(c.root_course_id, c.id) = v_family_id
    AND c.id != p_to_version_id
  ON CONFLICT (to_version_id, student_id)
  DO UPDATE SET
    coupon_id = EXCLUDED.coupon_id,
    notified_at = COALESCE(EXCLUDED.notified_at, course_update_offers.notified_at);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$


-- Grants for create_update_offer:
GRANT EXECUTE ON FUNCTION public.create_update_offer(p_root_course_id uuid, p_to_version_id uuid, p_coupon_id uuid, p_notify boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_update_offer(p_root_course_id uuid, p_to_version_id uuid, p_coupon_id uuid, p_notify boolean) TO service_role;

-- Function: get_all_instructors_admin
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres
CREATE OR REPLACE FUNCTION public.get_all_instructors_admin()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE instructors_data json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_auth WHERE id=auth.uid() AND COALESCE(is_suspended,false)=false) THEN RAISE EXCEPTION 'Unauthorized: Not a valid admin'; END IF;
  SELECT json_agg(i) INTO instructors_data FROM (SELECT p.id,p.full_name,p.email,p.avatar_url,p.professional_title,p.short_bio,p.created_at,(SELECT json_agg(c) FROM (SELECT id,title,status,created_at FROM courses WHERE instructor_id=p.id ORDER BY created_at DESC)c) courses_list,(SELECT count(*) FROM courses WHERE instructor_id=p.id) course_count FROM profiles p WHERE p.role='instructor' ORDER BY p.created_at DESC) i;
  RETURN COALESCE(instructors_data,'[]'::json);
END; $function$


-- Grants for get_all_instructors_admin:
GRANT EXECUTE ON FUNCTION public.get_all_instructors_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_all_instructors_admin() TO service_role;

-- Function: get_course_details_admin
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres
CREATE OR REPLACE FUNCTION public.get_course_details_admin(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_course_data jsonb;
BEGIN
    -- [SECURITY ENFORCEMENT]: Admin authorization check
    IF NOT EXISTS (
        SELECT 1
        FROM public.admin_auth
        WHERE id = auth.uid()
          AND COALESCE(is_suspended, false) = false
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Not a valid admin';
    END IF;

    -- [EXISTING LOGIC PRESERVED]: Fetch all course details
    SELECT 
        jsonb_build_object(
            'id', c.id,
            'title', c.title,
            'subtitle', c.subtitle,
            'description', c.description,
            'thumbnail_url', c.thumbnail_url,
            'price', c.price,
            'price_type', c.price_type,
            'currency', c.currency,
            'status', c.status,
            'is_public', c.is_public,
            'intro_video_url', c.intro_video_url,
            'created_at', c.created_at,
            'updated_at', c.updated_at,
            'category_id', c.category_id,
            'level', c.level,
            'instructor', jsonb_build_object(
                'id', p.id,
                'full_name', p.full_name,
                'email', p.email,
                'avatar_url', p.avatar_url,
                'phone', p.phone_number
            ),
            'category', jsonb_build_object('name', cat.name),
            'sections', (
                SELECT COALESCE(jsonb_agg(
                    jsonb_build_object(
                        'id', s.id,
                        'title', s.title,
                        'order_index', s.order_index,
                        'lessons', (
                            SELECT COALESCE(jsonb_agg(
                                jsonb_build_object(
                                    'id', l.id,
                                    'title', l.title,
                                    'video_url', l.video_url,
                                    'content_type', l.content_type,
                                    'description', l.description,
                                    'order_index', l.order_index,
                                    'lesson_resources', (
                                        SELECT COALESCE(jsonb_agg(lr.*), '[]'::jsonb)
                                        FROM lesson_resources lr
                                        WHERE lr.lesson_id = l.id
                                    ),
                                    'quizzes', (
                                        SELECT COALESCE(jsonb_agg(
                                            jsonb_build_object(
                                                'id', q.id,
                                                'title', q.title,
                                                'description', q.description,
                                                'passing_score_percentage', q.passing_score_percentage,
                                                'questions', (
                                                    SELECT COALESCE(jsonb_agg(
                                                        jsonb_build_object(
                                                            'id', qq.id,
                                                            'question_text', qq.question_text,
                                                            'order_index', qq.order_index,
                                                            'options', (
                                                                SELECT COALESCE(jsonb_agg(qo.*), '[]'::jsonb)
                                                                FROM quiz_options qo
                                                                WHERE qo.question_id = qq.id
                                                            )
                                                        )
                                                    ), '[]'::jsonb)
                                                    FROM quiz_questions qq
                                                    WHERE qq.quiz_id = q.id
                                                )
                                            )
                                        ), '[]'::jsonb)
                                        FROM quizzes q
                                        WHERE q.lesson_id = l.id
                                    )
                                )
                            ), '[]'::jsonb)
                            FROM course_lessons l
                            WHERE l.section_id = s.id
                        )
                    )
                ), '[]'::jsonb)
                FROM course_sections s
                WHERE s.course_id = c.id
            ),
            'moderation_history', (
                SELECT COALESCE(jsonb_agg(h.* ORDER BY h.created_at DESC), '[]'::jsonb)
                FROM course_moderation_logs h
                WHERE h.course_id = c.id
            )
        ) INTO v_course_data
    FROM courses c
    LEFT JOIN profiles p ON c.instructor_id = p.id
    LEFT JOIN course_categories cat ON c.category_id = cat.id
    WHERE c.id = p_course_id;

    RETURN v_course_data;
END;
$function$


-- Grants for get_course_details_admin:
GRANT EXECUTE ON FUNCTION public.get_course_details_admin(p_course_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_details_admin(p_course_id uuid) TO service_role;

-- Function: get_course_performance_table
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.get_course_performance_table(p_instructor_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_result json;
    v_caller uuid;
BEGIN
    -- Security: verify caller is the instructor or an admin
    v_caller := auth.uid();
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Authentication required';
    END IF;
    IF v_caller != p_instructor_id AND NOT EXISTS (SELECT 1 FROM admin_auth WHERE id = v_caller) THEN
        RAISE EXCEPTION 'Unauthorized: You can only view your own analytics';
    END IF;

    SELECT json_agg(
        json_build_object(
            'id', c.id,
            'thumbnailUrl', c.thumbnail_url,
            'title', c.title,
            'crsId', c.serial_id,
            'totalStudents', COALESCE((SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id), 0),
            'revenueGenerated', COALESCE((SELECT SUM(instructor_share) FROM instructor_earnings ie WHERE ie.course_id = c.id), 0),
            'completionRate', COALESCE((SELECT AVG(progress_percentage) FROM enrollments e WHERE e.course_id = c.id), 0),
            'rating', COALESCE((SELECT AVG(rating) FROM course_reviews cr WHERE cr.course_id = c.id), 0),
            'numberOfReviews', COALESCE((SELECT COUNT(*) FROM course_reviews cr WHERE cr.course_id = c.id), 0),
            'views', COALESCE(ca.views, 0)
        )
    ) INTO v_result
    FROM courses c
    LEFT JOIN course_analytics ca ON c.id = ca.course_id
    WHERE c.instructor_id = p_instructor_id
      AND c.status = 'published'
      AND c.is_latest_published = true;

    RETURN COALESCE(v_result, '[]'::json);
END;
$function$


-- Grants for get_course_performance_table:
GRANT EXECUTE ON FUNCTION public.get_course_performance_table(p_instructor_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_performance_table(p_instructor_id uuid) TO service_role;

-- Function: get_course_quiz_score
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.get_course_quiz_score(p_student_id uuid, p_course_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_questions INTEGER;
  v_correct_answers INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required';
  END IF;
  IF auth.uid() != p_student_id AND NOT EXISTS (SELECT 1 FROM admin_auth WHERE id = auth.uid())
     AND NOT EXISTS (SELECT 1 FROM courses WHERE id = p_course_id AND instructor_id = auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized: You can only view your own quiz score';
  END IF;

  SELECT COUNT(qq.id) INTO v_total_questions
  FROM course_sections cs
  JOIN course_lessons cl ON cl.section_id = cs.id
  JOIN quizzes qz ON qz.lesson_id = cl.id
  JOIN quiz_questions qq ON qq.quiz_id = qz.id
  WHERE cs.course_id = p_course_id AND cl.deleted_at IS NULL;

  IF v_total_questions IS NULL OR v_total_questions = 0 THEN
    RETURN 100;
  END IF;

  SELECT COUNT(qsa.id) INTO v_correct_answers
  FROM course_sections cs
  JOIN course_lessons cl ON cl.section_id = cs.id
  JOIN quizzes qz ON qz.lesson_id = cl.id
  JOIN quiz_submissions qs ON qs.quiz_id = qz.id AND qs.student_id = p_student_id
  JOIN quiz_submission_answers qsa ON qsa.submission_id = qs.id AND qsa.is_correct = true
  WHERE cs.course_id = p_course_id AND cl.deleted_at IS NULL;

  RETURN ROUND((v_correct_answers::NUMERIC / v_total_questions::NUMERIC) * 100, 2);
END;
$function$


-- Grants for get_course_quiz_score:
GRANT EXECUTE ON FUNCTION public.get_course_quiz_score(p_student_id uuid, p_course_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_quiz_score(p_student_id uuid, p_course_id uuid) TO service_role;

-- Function: get_instructor_analytics_overview
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.get_instructor_analytics_overview(p_instructor_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_total_published_courses integer;
    v_total_draft_courses integer;
    v_total_students_enrolled integer;
    v_active_students integer;
    v_course_completion_rate numeric;
    v_total_course_views integer;
    v_wishlist_saves integer;
    v_average_course_rating numeric;
    v_total_reviews integer;
    v_total_revenue numeric;
    v_monthly_revenue numeric;
    v_mentorship_sessions integer;
    v_total_mentorship_students integer;
    v_returning_students integer;
BEGIN
    -- Security: verify caller is the instructor or an admin
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Authentication required';
    END IF;
    IF auth.uid() != p_instructor_id AND NOT EXISTS (SELECT 1 FROM admin_auth WHERE id = auth.uid()) THEN
        RAISE EXCEPTION 'Unauthorized: You can only view your own analytics';
    END IF;

    SELECT COUNT(*) INTO v_total_published_courses FROM courses WHERE instructor_id = p_instructor_id AND status = 'published';
    SELECT COUNT(*) INTO v_total_draft_courses FROM courses WHERE instructor_id = p_instructor_id AND status = 'draft';

    SELECT COALESCE(SUM(views), 0) INTO v_total_course_views FROM course_analytics ca JOIN courses c ON ca.course_id = c.id WHERE c.instructor_id = p_instructor_id;
    
    SELECT COUNT(DISTINCT e.student_id) INTO v_total_students_enrolled 
    FROM enrollments e JOIN courses c ON e.course_id = c.id 
    WHERE c.instructor_id = p_instructor_id;
    
    SELECT COALESCE(AVG(e.progress_percentage), 0) INTO v_course_completion_rate
    FROM enrollments e JOIN courses c ON e.course_id = c.id
    WHERE c.instructor_id = p_instructor_id;
    
    SELECT COUNT(*) INTO v_wishlist_saves
    FROM wishlist w JOIN courses c ON w.course_id = c.id
    WHERE c.instructor_id = p_instructor_id;
    
    SELECT COUNT(*), COALESCE(AVG(rating), 0) INTO v_total_reviews, v_average_course_rating
    FROM course_reviews r JOIN courses c ON r.course_id = c.id
    WHERE c.instructor_id = p_instructor_id;
    
    SELECT COALESCE(SUM(instructor_share), 0) INTO v_total_revenue
    FROM instructor_earnings
    WHERE instructor_id = p_instructor_id;
    
    SELECT COALESCE(SUM(instructor_share), 0) INTO v_monthly_revenue
    FROM instructor_earnings
    WHERE instructor_id = p_instructor_id AND created_at >= date_trunc('month', now());
    
    SELECT COUNT(*) INTO v_mentorship_sessions
    FROM mentorship_sessions
    WHERE mentor_id = p_instructor_id AND status = 'completed';
    
    SELECT COUNT(DISTINCT student_id) INTO v_total_mentorship_students
    FROM mentorship_sessions
    WHERE mentor_id = p_instructor_id;
    
    SELECT COUNT(DISTINCT e.student_id) INTO v_active_students
    FROM enrollments e JOIN courses c ON e.course_id = c.id
    WHERE c.instructor_id = p_instructor_id AND e.updated_at >= now() - interval '30 days';

    SELECT COUNT(*) INTO v_returning_students FROM (
        SELECT e.student_id 
        FROM enrollments e JOIN courses c ON e.course_id = c.id 
        WHERE c.instructor_id = p_instructor_id 
        GROUP BY e.student_id 
        HAVING COUNT(*) > 1
    ) AS returning_students_sub;

    RETURN json_build_object(
        'totalPublishedCourses', COALESCE(v_total_published_courses, 0),
        'totalDraftCourses', COALESCE(v_total_draft_courses, 0),
        'totalStudentsEnrolled', COALESCE(v_total_students_enrolled, 0),
        'activeStudents', COALESCE(v_active_students, 0),
        'courseCompletionRate', COALESCE(v_course_completion_rate, 0),
        'totalCourseViews', COALESCE(v_total_course_views, 0),
        'wishlistSaves', COALESCE(v_wishlist_saves, 0),
        'averageCourseRating', round(COALESCE(v_average_course_rating, 0), 1),
        'totalReviews', COALESCE(v_total_reviews, 0),
        'totalRevenue', COALESCE(v_total_revenue, 0),
        'monthlyRevenue', COALESCE(v_monthly_revenue, 0),
        'mentorshipSessions', COALESCE(v_mentorship_sessions, 0),
        'totalMentorshipStudents', COALESCE(v_total_mentorship_students, 0),
        'returningStudents', COALESCE(v_returning_students, 0)
    );
END;
$function$


-- Grants for get_instructor_analytics_overview:
GRANT EXECUTE ON FUNCTION public.get_instructor_analytics_overview(p_instructor_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_instructor_analytics_overview(p_instructor_id uuid) TO service_role;

-- Function: get_instructor_courses_refined
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.get_instructor_courses_refined(p_instructor_id uuid)
 RETURNS TABLE(id uuid, serial_id bigint, title text, subtitle text, thumbnail_url text, category_name text, level text, status text, created_at timestamp with time zone, updated_at timestamp with time zone, rejection_reason text, has_rejection_history boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Authentication required';
    END IF;
    IF auth.uid() != p_instructor_id AND NOT EXISTS (SELECT 1 FROM admin_auth WHERE id = auth.uid()) THEN
        RAISE EXCEPTION 'Unauthorized: You can only view your own courses';
    END IF;

    RETURN QUERY
    SELECT
        c.id, c.serial_id, c.title::TEXT, c.subtitle::TEXT, c.thumbnail_url::TEXT,
        cc.name::TEXT as category_name, c.level::TEXT, c.status, c.created_at, c.updated_at,
        (SELECT l.notes FROM course_moderation_logs l
         WHERE l.course_id = c.id AND l.decision = 'rejected'
         ORDER BY l.created_at DESC LIMIT 1)::TEXT as rejection_reason,
        EXISTS (SELECT 1 FROM course_moderation_logs l
                WHERE l.course_id = c.id AND l.decision = 'rejected') as has_rejection_history
    FROM courses c
    LEFT JOIN course_categories cc ON c.category_id = cc.id
    WHERE c.instructor_id = p_instructor_id
    ORDER BY c.created_at DESC;
END;
$function$


-- Grants for get_instructor_courses_refined:
GRANT EXECUTE ON FUNCTION public.get_instructor_courses_refined(p_instructor_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_instructor_courses_refined(p_instructor_id uuid) TO service_role;

-- Function: get_instructor_sales_chart_data
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.get_instructor_sales_chart_data(p_instructor_id uuid, p_period text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_start_date date;
    v_revenue_data json;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Authentication required';
    END IF;
    IF auth.uid() != p_instructor_id AND NOT EXISTS (SELECT 1 FROM admin_auth WHERE id = auth.uid()) THEN
        RAISE EXCEPTION 'Unauthorized: You can only view your own sales data';
    END IF;

    IF p_period = '7days' THEN
        v_start_date := current_date - interval '7 days';
    ELSIF p_period = '90days' THEN
        v_start_date := current_date - interval '90 days';
    ELSIF p_period = '12months' THEN
        v_start_date := current_date - interval '12 months';
    ELSE
        v_start_date := current_date - interval '30 days';
    END IF;

    SELECT json_agg(
        json_build_object('date', d.dt, 'revenue', COALESCE(rev.total_revenue, 0), 'sales', COALESCE(rev.sales_count, 0))
    ) INTO v_revenue_data
    FROM (SELECT generate_series(v_start_date, current_date, '1 day'::interval)::date AS dt) d
    LEFT JOIN (
        SELECT date_trunc('day', created_at)::date AS dt, SUM(instructor_share) AS total_revenue, COUNT(*) AS sales_count
        FROM instructor_earnings
        WHERE instructor_id = p_instructor_id AND created_at >= v_start_date
        GROUP BY 1
    ) rev ON d.dt = rev.dt;

    RETURN json_build_object('chartData', COALESCE(v_revenue_data, '[]'::json));
END;
$function$


-- Grants for get_instructor_sales_chart_data:
GRANT EXECUTE ON FUNCTION public.get_instructor_sales_chart_data(p_instructor_id uuid, p_period text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_instructor_sales_chart_data(p_instructor_id uuid, p_period text) TO service_role;

-- Function: get_instructor_student_demographics
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.get_instructor_student_demographics(p_instructor_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_result json;
BEGIN
    -- Security: verify caller is the instructor or an admin
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Authentication required';
    END IF;
    IF auth.uid() != p_instructor_id AND NOT EXISTS (SELECT 1 FROM admin_auth WHERE id = auth.uid()) THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    SELECT json_agg(
        json_build_object(
            'country', COALESCE(p.country, 'Unknown'),
            'count', cnt
        ) ORDER BY cnt DESC
    ) INTO v_result
    FROM (
        SELECT 
            p.country,
            COUNT(DISTINCT e.student_id) AS cnt
        FROM enrollments e
        JOIN courses c ON e.course_id = c.id
        JOIN profiles p ON e.student_id = p.id
        WHERE c.instructor_id = p_instructor_id
        GROUP BY p.country
        HAVING COUNT(DISTINCT e.student_id) > 0
    ) sub
    JOIN profiles p ON true
    -- use a different alias to avoid conflict
    ;

    -- Simpler version without the alias confusion
    SELECT json_agg(
        json_build_object(
            'country', COALESCE(student_country, 'Unknown'),
            'count', student_count
        ) ORDER BY student_count DESC
    ) INTO v_result
    FROM (
        SELECT 
            prof.country AS student_country,
            COUNT(DISTINCT e.student_id) AS student_count
        FROM enrollments e
        JOIN courses c ON e.course_id = c.id
        JOIN profiles prof ON e.student_id = prof.id
        WHERE c.instructor_id = p_instructor_id
        GROUP BY prof.country
    ) demographics;

    RETURN COALESCE(v_result, '[]'::json);
END;
$function$


-- Grants for get_instructor_student_demographics:
GRANT EXECUTE ON FUNCTION public.get_instructor_student_demographics(p_instructor_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_instructor_student_demographics(p_instructor_id uuid) TO service_role;

-- Function: get_or_create_course_revision
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.get_or_create_course_revision(p_course_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_family_id      UUID;
  v_root_id        UUID;
  v_next_version   INTEGER;
  v_new_course_id  UUID;
  v_old_section_id UUID;
  v_new_section_id UUID;
  v_old_lesson_id  UUID;
  v_new_lesson_id  UUID;
  v_old_quiz_id    UUID;
  v_new_quiz_id    UUID;
  v_old_q_id       UUID;
  v_new_q_id       UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required';
  END IF;

  -- Critical IDOR guard: the requested course must belong to the authenticated instructor.
  SELECT COALESCE(root_course_id, id)
    INTO v_family_id
  FROM public.courses
  WHERE id = p_course_id
    AND instructor_id = auth.uid();

  IF v_family_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: course does not belong to the current user';
  END IF;

  -- Return existing uncommitted revision if one already exists in this family.
  SELECT id INTO v_new_course_id
  FROM public.courses
  WHERE COALESCE(root_course_id, id) = v_family_id
    AND instructor_id = auth.uid()
    AND version_status IN ('draft', 'pending_review', 'rejected')
  LIMIT 1;

  IF v_new_course_id IS NOT NULL THEN
    RETURN v_new_course_id;
  END IF;

  -- Find the published version to clone, still scoped to the authenticated instructor.
  SELECT id INTO v_root_id
  FROM public.courses
  WHERE COALESCE(root_course_id, id) = v_family_id
    AND instructor_id = auth.uid()
    AND is_latest_published = true
  LIMIT 1;

  IF v_root_id IS NULL THEN
    RAISE EXCEPTION 'No published version found for course family %', v_family_id;
  END IF;

  SELECT COALESCE(MAX(version_number), 1) + 1 INTO v_next_version
  FROM public.courses
  WHERE COALESCE(root_course_id, id) = v_family_id
    AND instructor_id = auth.uid();

  INSERT INTO public.courses (
    instructor_id, title, slug, description, thumbnail_url, price,
    status, subtitle, category_id, level, intro_video_url, price_type,
    currency, is_public, total_duration_minutes,
    root_course_id, version_number, is_latest_published, version_status
  )
  SELECT
    instructor_id, title, slug || '-rev-' || v_next_version,
    description, thumbnail_url, price,
    'draft'::course_status,
    subtitle, category_id, level, intro_video_url, price_type,
    currency, is_public, total_duration_minutes,
    v_family_id, v_next_version, false, 'draft'
  FROM public.courses WHERE id = v_root_id
  RETURNING id INTO v_new_course_id;

  FOR v_old_section_id IN
    SELECT id FROM public.course_sections
    WHERE course_id = v_root_id AND deleted_at IS NULL
    ORDER BY order_index
  LOOP
    INSERT INTO public.course_sections (course_id, title, order_index)
    SELECT v_new_course_id, title, order_index
    FROM public.course_sections WHERE id = v_old_section_id
    RETURNING id INTO v_new_section_id;

    FOR v_old_lesson_id IN
      SELECT id FROM public.course_lessons
      WHERE section_id = v_old_section_id AND deleted_at IS NULL
      ORDER BY order_index
    LOOP
      INSERT INTO public.course_lessons (
        section_id, title, video_url, is_preview, order_index,
        content_type, description, media_asset_id
      )
      SELECT v_new_section_id, title, video_url, is_preview, order_index,
             content_type, description, media_asset_id
      FROM public.course_lessons WHERE id = v_old_lesson_id
      RETURNING id INTO v_new_lesson_id;

      INSERT INTO public.lesson_resources (lesson_id, title, file_url, file_type)
      SELECT v_new_lesson_id, title, file_url, file_type
      FROM public.lesson_resources WHERE lesson_id = v_old_lesson_id;

      FOR v_old_quiz_id IN
        SELECT id FROM public.quizzes WHERE lesson_id = v_old_lesson_id
      LOOP
        INSERT INTO public.quizzes (lesson_id, title, description, passing_score_percentage)
        SELECT v_new_lesson_id, title, description, passing_score_percentage
        FROM public.quizzes WHERE id = v_old_quiz_id
        RETURNING id INTO v_new_quiz_id;

        FOR v_old_q_id IN
          SELECT id FROM public.quiz_questions
          WHERE quiz_id = v_old_quiz_id ORDER BY order_index
        LOOP
          INSERT INTO public.quiz_questions (quiz_id, question_text, order_index)
          SELECT v_new_quiz_id, question_text, order_index
          FROM public.quiz_questions WHERE id = v_old_q_id
          RETURNING id INTO v_new_q_id;

          INSERT INTO public.quiz_options (question_id, option_text, is_correct, order_index)
          SELECT v_new_q_id, option_text, is_correct, order_index
          FROM public.quiz_options WHERE question_id = v_old_q_id;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;

  INSERT INTO public.course_coupons (
    course_id, code, discount_percent, is_active, expires_at, starts_at, coupon_type
  )
  SELECT v_new_course_id, code, discount_percent, is_active, expires_at, starts_at, 'general'
  FROM public.course_coupons
  WHERE course_id = v_root_id AND coupon_type = 'general';

  RETURN v_new_course_id;
END;
$function$


-- Grants for get_or_create_course_revision:
GRANT EXECUTE ON FUNCTION public.get_or_create_course_revision(p_course_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_course_revision(p_course_id uuid) TO service_role;

-- Function: get_pending_courses_admin
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres
CREATE OR REPLACE FUNCTION public.get_pending_courses_admin()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE courses_data json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_auth WHERE id=auth.uid() AND COALESCE(is_suspended,false)=false) THEN RAISE EXCEPTION 'Unauthorized: Not a valid admin'; END IF;
  SELECT json_agg(c) INTO courses_data FROM (SELECT co.id,co.title,co.subtitle,co.thumbnail_url,co.category_id,co.level,co.created_at,co.instructor_id,co.root_course_id,co.version_number,co.version_status,co.rejection_reason,(co.root_course_id IS NOT NULL) is_revision,json_build_object('id',p.id,'full_name',p.full_name,'email',p.email,'avatar_url',p.avatar_url) instructor,json_build_object('name',cat.name) category FROM courses co LEFT JOIN profiles p ON co.instructor_id=p.id LEFT JOIN course_categories cat ON co.category_id=cat.id WHERE co.status='pending_review' ORDER BY co.created_at DESC) c;
  RETURN COALESCE(courses_data,'[]'::json);
END; $function$


-- Grants for get_pending_courses_admin:
GRANT EXECUTE ON FUNCTION public.get_pending_courses_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_courses_admin() TO service_role;

-- Function: handle_course_appeal_admin
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres
CREATE OR REPLACE FUNCTION public.handle_course_appeal_admin(p_course_id uuid, p_decision text, p_moderator_id uuid, p_notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role TEXT;
BEGIN
  -- Auth check: caller must be a course manager or superadmin
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required';
  END IF;

  SELECT role INTO v_caller_role FROM public.admin_auth WHERE id = auth.uid();

  IF v_caller_role NOT IN ('course_manager', 'superadmin') THEN
    RAISE EXCEPTION 'Unauthorized: course-manager privileges required';
  END IF;

  IF p_decision = 'approve' THEN
    UPDATE courses SET status = 'pending_review' WHERE id = p_course_id AND status = 'appealed';
    INSERT INTO course_moderation_logs (course_id, moderator_id, decision, notes)
    VALUES (p_course_id, auth.uid(), 'approved', p_notes);

  ELSIF p_decision = 'reject' THEN
    DELETE FROM courses WHERE id = p_course_id;
  END IF;
END;
$function$


-- Grants for handle_course_appeal_admin:
GRANT EXECUTE ON FUNCTION public.handle_course_appeal_admin(p_course_id uuid, p_decision text, p_moderator_id uuid, p_notes text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.handle_course_appeal_admin(p_course_id uuid, p_decision text, p_moderator_id uuid, p_notes text) TO service_role;

-- Function: mentor_reschedule_session
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.mentor_reschedule_session(p_mentor_id uuid, p_session_id uuid, p_new_scheduled_at timestamp with time zone, p_new_duration_minutes integer, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_total_sessions integer;
    v_completed integer;
    v_mentorship_type text;
    v_remaining integer;
    v_new_end_date timestamptz;
    v_previous_scheduled_at timestamptz;
    v_previous_duration integer;
    v_meetings_held integer;
    v_current_candidate timestamptz;
    v_candidate_end timestamptz;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: not authenticated';
    END IF;

    SELECT total_sessions, COALESCE(completed_sessions_count, 0), mentorship_type, scheduled_at, duration_minutes
    INTO v_total_sessions, v_completed, v_mentorship_type, v_previous_scheduled_at, v_previous_duration
    FROM public.mentorship_sessions
    WHERE id = p_session_id AND mentor_id = auth.uid();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unauthorized or session not found';
    END IF;

    IF v_mentorship_type = 'program' THEN
        v_meetings_held := 0;
        v_current_candidate := v_previous_scheduled_at;
        WHILE true LOOP
            v_candidate_end := v_current_candidate + (v_previous_duration || ' minutes')::interval;
            IF v_current_candidate > now() THEN
                EXIT;
            END IF;
            IF now() >= v_candidate_end THEN
                v_meetings_held := v_meetings_held + 1;
            END IF;
            v_current_candidate := v_current_candidate + interval '24 hours';
        END LOOP;

        v_completed := v_completed + v_meetings_held;
        v_remaining := GREATEST(v_total_sessions - v_completed, 1);
        v_new_end_date := p_new_scheduled_at + ((v_remaining - 1) || ' days')::interval;

        UPDATE public.mentorship_sessions
        SET scheduled_at = p_new_scheduled_at,
            duration_minutes = COALESCE(p_new_duration_minutes, duration_minutes),
            end_date = v_new_end_date,
            completed_sessions_count = v_completed,
            reschedule_requested_by = 'mentor',
            reschedule_note = p_note,
            reschedule_history = COALESCE(reschedule_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                'previous_scheduled_at', v_previous_scheduled_at,
                'previous_duration', v_previous_duration,
                'note', p_note,
                'requested_by', 'mentor',
                'rescheduled_at', now()
            ))
        WHERE id = p_session_id;
    ELSE
        UPDATE public.mentorship_sessions
        SET scheduled_at = p_new_scheduled_at,
            duration_minutes = COALESCE(p_new_duration_minutes, duration_minutes),
            reschedule_requested_by = 'mentor',
            reschedule_note = p_note,
            reschedule_history = COALESCE(reschedule_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                'previous_scheduled_at', v_previous_scheduled_at,
                'previous_duration', v_previous_duration,
                'note', p_note,
                'requested_by', 'mentor',
                'rescheduled_at', now()
            ))
        WHERE id = p_session_id;
    END IF;
END;
$function$


-- Grants for mentor_reschedule_session:
GRANT EXECUTE ON FUNCTION public.mentor_reschedule_session(p_mentor_id uuid, p_session_id uuid, p_new_scheduled_at timestamp with time zone, p_new_duration_minutes integer, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mentor_reschedule_session(p_mentor_id uuid, p_session_id uuid, p_new_scheduled_at timestamp with time zone, p_new_duration_minutes integer, p_note text) TO service_role;

-- Function: reject_course_admin
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres
CREATE OR REPLACE FUNCTION public.reject_course_admin(p_course_id uuid, p_instructor_id uuid, p_moderator_id uuid, p_notes text DEFAULT 'Rejected based on review.'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required';
  END IF;

  SELECT role INTO v_caller_role
  FROM public.admin_auth
  WHERE id = auth.uid();

  IF v_caller_role NOT IN ('course_manager', 'superadmin') THEN
    RAISE EXCEPTION 'Unauthorized: course-manager privileges required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.courses WHERE id = p_course_id) THEN
    RAISE EXCEPTION 'Course not found';
  END IF;

  UPDATE public.courses
  SET status = 'rejected',
      version_status = 'rejected',
      rejection_reason = COALESCE(p_notes, 'Rejected based on review.')
  WHERE id = p_course_id;

  INSERT INTO public.course_moderation_logs (course_id, moderator_id, decision, notes)
  VALUES (p_course_id, auth.uid(), 'rejected', COALESCE(p_notes, 'Rejected based on review.'));
END;
$function$


-- Grants for reject_course_admin:
GRANT EXECUTE ON FUNCTION public.reject_course_admin(p_course_id uuid, p_instructor_id uuid, p_moderator_id uuid, p_notes text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_course_admin(p_course_id uuid, p_instructor_id uuid, p_moderator_id uuid, p_notes text) TO service_role;

-- Function: sync_course_curriculum
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.sync_course_curriculum(p_course_id uuid, p_curriculum jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    section_item JSONB;
    lesson_item JSONB;
    resource_item JSONB;
    quiz_item JSONB;
    question_item JSONB;
    option_item JSONB;
    v_section_id UUID;
    v_lesson_id UUID;
    v_quiz_id UUID;
    v_question_id UUID;
    v_saved_section_ids UUID[] := '{}';
    v_saved_lesson_ids UUID[] := '{}';
BEGIN
    -- SECURITY: Verify the authenticated user owns this course
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: authentication required';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.courses
        WHERE id = p_course_id AND instructor_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Unauthorized: course does not belong to the current user';
    END IF;

    -- 1. Sync Sections
    FOR section_item IN SELECT * FROM jsonb_array_elements(p_curriculum)
    LOOP
        INSERT INTO course_sections (id, course_id, title, order_index)
        VALUES (
            COALESCE((section_item->>'id')::UUID, gen_random_uuid()),
            p_course_id,
            section_item->>'title',
            (section_item->>'order_index')::INT
        )
        ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            order_index = EXCLUDED.order_index
        RETURNING id INTO v_section_id;

        v_saved_section_ids := array_append(v_saved_section_ids, v_section_id);

        -- 2. Sync Lessons
        FOR lesson_item IN SELECT * FROM jsonb_array_elements(section_item->'items')
        LOOP
            INSERT INTO course_lessons (id, section_id, title, description, content_type, video_url, is_preview, order_index)
            VALUES (
                COALESCE((lesson_item->>'id')::UUID, gen_random_uuid()),
                v_section_id,
                lesson_item->>'title',
                COALESCE(lesson_item->>'description', ''),
                COALESCE(lesson_item->>'content_type', 'text'),
                lesson_item->>'video_url',
                COALESCE((lesson_item->>'is_preview')::BOOLEAN, false),
                (lesson_item->>'order_index')::INT
            )
            ON CONFLICT (id) DO UPDATE SET
                title = EXCLUDED.title,
                description = EXCLUDED.description,
                content_type = EXCLUDED.content_type,
                video_url = EXCLUDED.video_url,
                is_preview = EXCLUDED.is_preview,
                order_index = EXCLUDED.order_index
            RETURNING id INTO v_lesson_id;

            v_saved_lesson_ids := array_append(v_saved_lesson_ids, v_lesson_id);

            -- 3. Sync Resources (Clear and Rebuild for the lesson)
            DELETE FROM lesson_resources WHERE lesson_id = v_lesson_id;
            IF lesson_item ? 'resources' THEN
                FOR resource_item IN SELECT * FROM jsonb_array_elements(lesson_item->'resources')
                LOOP
                    INSERT INTO lesson_resources (lesson_id, title, file_url, file_type)
                    VALUES (
                        v_lesson_id,
                        resource_item->>'title',
                        resource_item->>'file_url',
                        COALESCE(resource_item->>'file_type', 'unknown')
                    );
                END LOOP;
            END IF;

            -- 4. Sync Quizzes (Clear and Rebuild for the lesson)
            DELETE FROM quizzes WHERE lesson_id = v_lesson_id;
            IF lesson_item ? 'quiz' AND jsonb_array_length(lesson_item->'quiz') > 0 THEN
                quiz_item := (lesson_item->'quiz')->0;
                INSERT INTO quizzes (lesson_id, title, description)
                VALUES (v_lesson_id, quiz_item->>'title', quiz_item->>'description')
                RETURNING id INTO v_quiz_id;

                IF quiz_item ? 'questions' THEN
                    FOR question_item IN SELECT * FROM jsonb_array_elements(quiz_item->'questions')
                    LOOP
                        INSERT INTO quiz_questions (quiz_id, question_text, order_index)
                        VALUES (v_quiz_id, question_item->>'text', (question_item->>'order_index')::INT)
                        RETURNING id INTO v_question_id;

                        IF question_item ? 'options' THEN
                            FOR option_item IN SELECT * FROM jsonb_array_elements(question_item->'options')
                            LOOP
                                INSERT INTO quiz_options (question_id, option_text, is_correct, order_index)
                                VALUES (
                                    v_question_id,
                                    option_item->>'text',
                                    (option_item->>'correct')::BOOLEAN,
                                    (option_item->>'order_index')::INT
                                );
                            END LOOP;
                        END IF;
                    END LOOP;
                END IF;
            END IF;
        END LOOP;
    END LOOP;

    -- 5. Cleanup DELETED Lessons
    DELETE FROM course_lessons
    WHERE section_id IN (SELECT id FROM course_sections WHERE course_id = p_course_id)
      AND id <> ALL(v_saved_lesson_ids);

    -- 6. Cleanup DELETED Sections
    DELETE FROM course_sections
    WHERE course_id = p_course_id
      AND id <> ALL(v_saved_section_ids);

    RETURN jsonb_build_object('status', 'success', 'sections_synced', array_length(v_saved_section_ids, 1));
END;
$function$


-- Grants for sync_course_curriculum:
GRANT EXECUTE ON FUNCTION public.sync_course_curriculum(p_course_id uuid, p_curriculum jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_course_curriculum(p_course_id uuid, p_curriculum jsonb) TO service_role;

-- ============================================================
-- STUDENT FUNCTIONS
-- ============================================================

-- Function: check_course_enrollment
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=True, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.check_course_enrollment(p_course_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM enrollments
    WHERE course_id = p_course_id AND student_id = auth.uid()
  );
$function$


-- Grants for check_course_enrollment:
GRANT EXECUTE ON FUNCTION public.check_course_enrollment(p_course_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.check_course_enrollment(p_course_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_course_enrollment(p_course_id uuid) TO service_role;

-- Function: check_lesson_enrollment
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=True, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.check_lesson_enrollment(p_lesson_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 
    FROM course_lessons cl
    JOIN course_sections cs ON cs.id = cl.section_id
    JOIN enrollments e ON e.course_id = cs.course_id
    WHERE cl.id = p_lesson_id AND e.student_id = auth.uid()
  );
$function$


-- Grants for check_lesson_enrollment:
GRANT EXECUTE ON FUNCTION public.check_lesson_enrollment(p_lesson_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.check_lesson_enrollment(p_lesson_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_lesson_enrollment(p_lesson_id uuid) TO service_role;

-- Function: check_section_enrollment
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=True, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.check_section_enrollment(p_section_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 
    FROM course_sections cs
    JOIN enrollments e ON e.course_id = cs.course_id
    WHERE cs.id = p_section_id AND e.student_id = auth.uid()
  );
$function$


-- Grants for check_section_enrollment:
GRANT EXECUTE ON FUNCTION public.check_section_enrollment(p_section_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.check_section_enrollment(p_section_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_section_enrollment(p_section_id uuid) TO service_role;

-- Function: generate_certificate
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.generate_certificate(p_student_id uuid, p_course_id uuid)
 RETURNS certificates
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing       public.certificates;
  v_new            public.certificates;
  v_completed_at   TIMESTAMPTZ;
  v_cert_enabled   BOOLEAN;
  v_code           TEXT;
  v_score          NUMERIC;
BEGIN
  -- SECURITY: The caller may only generate a certificate for themselves.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required';
  END IF;
  IF auth.uid() != p_student_id THEN
    RAISE EXCEPTION 'Unauthorized: you may only generate a certificate for your own account';
  END IF;

  SELECT
      COALESCE(e.completed_at, CASE WHEN e.progress_percentage = 100 THEN e.updated_at ELSE NULL END),
      c.certificate_enabled
    INTO v_completed_at, v_cert_enabled
  FROM enrollments e
  JOIN courses c ON c.id = e.course_id
  WHERE e.student_id = p_student_id AND e.course_id = p_course_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not enrolled in this course';
  END IF;
  IF v_completed_at IS NULL THEN
    RAISE EXCEPTION 'Course not yet completed';
  END IF;
  IF NOT v_cert_enabled THEN
    RAISE EXCEPTION 'Certificates are not enabled for this course';
  END IF;

  -- Idempotent: return existing certificate if already issued
  SELECT * INTO v_existing FROM certificates
  WHERE student_id = p_student_id AND course_id = p_course_id;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  v_score := public.get_course_quiz_score(p_student_id, p_course_id);
  v_code := 'CERT-' || upper(substr(md5(gen_random_uuid()::text), 1, 4))
            || '-' || upper(substr(md5(random()::text), 1, 4));

  INSERT INTO certificates (student_id, course_id, verification_code, quiz_score_snapshot, completed_at_snapshot)
  VALUES (p_student_id, p_course_id, v_code, v_score, v_completed_at)
  RETURNING * INTO v_new;

  RETURN v_new;
END;
$function$


-- Grants for generate_certificate:
GRANT EXECUTE ON FUNCTION public.generate_certificate(p_student_id uuid, p_course_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_certificate(p_student_id uuid, p_course_id uuid) TO service_role;

-- ============================================================
-- ANALYTICS FUNCTIONS
-- ============================================================

-- Function: get_finance_analytics
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres
CREATE OR REPLACE FUNCTION public.get_finance_analytics()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_total_revenue numeric;
    v_total_platform_fees numeric;
    v_total_instructor_payouts numeric;
    v_total_withdrawals_paid numeric;
    v_total_withdrawals_pending numeric;
    v_total_refunds numeric;
    v_monthly_revenue numeric;
    v_course_revenue numeric;
    v_mentorship_revenue numeric;
    v_boost_revenue numeric;
BEGIN
    -- Check admin
    IF NOT EXISTS (SELECT 1 FROM public.admin_auth WHERE id = auth.uid()) THEN
        RETURN jsonb_build_object('error', 'Unauthorized');
    END IF;

    -- Total revenue (all paid payments)
    SELECT COALESCE(SUM(p.amount), 0)
    INTO v_total_revenue
    FROM public.payments p
    WHERE p.payment_status = 'paid';

    -- Platform fees and instructor payouts
    SELECT COALESCE(SUM(ie.platform_fee), 0),
           COALESCE(SUM(ie.instructor_share), 0)
    INTO v_total_platform_fees, v_total_instructor_payouts
    FROM public.instructor_earnings ie
    JOIN public.payments p ON p.id = ie.payment_id
    WHERE p.payment_status = 'paid';

    -- Withdrawals
    SELECT COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0)
    INTO v_total_withdrawals_paid, v_total_withdrawals_pending
    FROM public.withdrawal_requests;

    -- Refunds
    SELECT COALESCE(SUM(rr.amount), 0)
    INTO v_total_refunds
    FROM public.refund_requests rr
    WHERE rr.status = 'approved';

    -- Monthly revenue
    SELECT COALESCE(SUM(p.amount), 0)
    INTO v_monthly_revenue
    FROM public.payments p
    WHERE p.payment_status = 'paid'
      AND p.created_at >= date_trunc('month', now());

    -- Course revenue
    SELECT COALESCE(SUM(p.amount), 0)
    INTO v_course_revenue
    FROM public.payments p
    WHERE p.payment_status = 'paid'
      AND p.course_id IS NOT NULL
      AND p.gateway NOT IN ('internal_boost_purchase', 'internal_banner_purchase');

    -- Mentorship revenue
    SELECT COALESCE(SUM(p.amount), 0)
    INTO v_mentorship_revenue
    FROM public.payments p
    WHERE p.payment_status = 'paid'
      AND p.mentorship_session_id IS NOT NULL
      AND p.gateway NOT IN ('internal_boost_purchase', 'internal_banner_purchase');

    -- Boost revenue
    SELECT COALESCE(SUM(p.amount), 0)
    INTO v_boost_revenue
    FROM public.payments p
    WHERE p.payment_status = 'paid'
      AND p.gateway IN ('internal_boost_purchase', 'internal_banner_purchase');

    RETURN jsonb_build_object(
        'total_revenue', v_total_revenue,
        'platform_fees', v_total_platform_fees,
        'instructor_payouts', v_total_instructor_payouts,
        'withdrawals_paid', v_total_withdrawals_paid,
        'withdrawals_pending', v_total_withdrawals_pending,
        'refunds', v_total_refunds,
        'monthly_revenue', v_monthly_revenue,
        'course_revenue', v_course_revenue,
        'mentorship_revenue', v_mentorship_revenue,
        'boost_revenue', v_boost_revenue
    );
END;
$function$


-- Grants for get_finance_analytics:
GRANT EXECUTE ON FUNCTION public.get_finance_analytics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_finance_analytics() TO service_role;

-- Function: track_search
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.track_search(p_keyword text, p_marketplace_type text, p_results_count integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_keyword text;
BEGIN
  v_keyword := lower(trim(p_keyword));
  IF v_keyword = '' THEN
    RETURN;
  END IF;
  
  INSERT INTO public.search_opportunities (keyword, marketplace_type, results_count, search_count, updated_at)
  VALUES (v_keyword, p_marketplace_type, p_results_count, 1, timezone('utc'::text, now()))
  ON CONFLICT (keyword, marketplace_type)
  DO UPDATE SET 
    search_count = public.search_opportunities.search_count + 1,
    results_count = p_results_count,
    updated_at = timezone('utc'::text, now());
END;
$function$


-- Grants for track_search:
GRANT EXECUTE ON FUNCTION public.track_search(p_keyword text, p_marketplace_type text, p_results_count integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.track_search(p_keyword text, p_marketplace_type text, p_results_count integer) TO service_role;

-- ============================================================
-- UTILITY / SYSTEM FUNCTIONS
-- ============================================================

-- Function: check_phone_unique
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.check_phone_unique(p_phone text, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    is_duplicate boolean;
    core_phone text;
    caller_id uuid;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: not authenticated';
    END IF;
    caller_id := auth.uid();

    IF p_phone IS NULL OR p_phone = '' THEN
        RETURN false;
    END IF;

    core_phone := regexp_replace(p_phone, '\D', '', 'g');
    core_phone := regexp_replace(core_phone, '^(252|254|253|256|250|255|0+)', '');

    IF length(core_phone) < 6 THEN
        RETURN false;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM payout_methods
        WHERE instructor_id != caller_id
        AND (
            regexp_replace(regexp_replace(phone_mobile_money, '\D', '', 'g'), '^(252|254|253|256|250|255|0+)', '') = core_phone
            OR
            regexp_replace(regexp_replace(phone_cash_on_delivery, '\D', '', 'g'), '^(252|254|253|256|250|255|0+)', '') = core_phone
        )
    ) INTO is_duplicate;

    RETURN is_duplicate;
END;
$function$


-- Grants for check_phone_unique:
GRANT EXECUTE ON FUNCTION public.check_phone_unique(p_phone text, p_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_phone_unique(p_phone text, p_user_id uuid) TO service_role;

-- Function: get_all_users_admin
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=True, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres
CREATE OR REPLACE FUNCTION public.get_all_users_admin()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE users_data json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_auth WHERE id=auth.uid() AND COALESCE(is_suspended,false)=false) THEN RAISE EXCEPTION 'Unauthorized: Not a valid admin'; END IF;
  SELECT json_agg(u) INTO users_data FROM (SELECT id,role,full_name,email,avatar_url,created_at,profile_completed FROM profiles ORDER BY created_at DESC) u;
  RETURN COALESCE(users_data,'[]'::json);
END; $function$


-- Grants for get_all_users_admin:
GRANT EXECUTE ON FUNCTION public.get_all_users_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_all_users_admin() TO service_role;

-- Function: get_orphaned_media_assets
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=False, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.get_orphaned_media_assets()
 RETURNS TABLE(id uuid, storage_provider text, storage_path text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.id, m.storage_provider, m.storage_path
  FROM course_media_assets m
  WHERE NOT EXISTS (
    SELECT 1 FROM course_lessons l WHERE l.media_asset_id = m.id
  )
  AND m.created_at < now() - INTERVAL '30 days';
$function$


-- Grants for get_orphaned_media_assets:
GRANT EXECUTE ON FUNCTION public.get_orphaned_media_assets() TO service_role;

-- Function: get_platform_settings
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=True, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.get_platform_settings()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
        'self_hosted_video_uploads_enabled', ps.self_hosted_video_uploads_enabled,
        'updated_at', ps.updated_at
    ) INTO result
    FROM public.platform_settings ps
    LIMIT 1;

    RETURN COALESCE(result, '{"commission_enabled":false,"instructor_percentage":100,"platform_percentage":0,"min_withdrawal_amount":10,"show_refund_request":true,"self_hosted_video_uploads_enabled":false}'::jsonb);
END;
$function$


-- Grants for get_platform_settings:
GRANT EXECUTE ON FUNCTION public.get_platform_settings() TO anon;
GRANT EXECUTE ON FUNCTION public.get_platform_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_settings() TO service_role;

-- Function: handle_new_user
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=False, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    new.id, 
    new.raw_user_meta_data->>'full_name', 
    COALESCE(new.raw_user_meta_data->>'role', 'student')::public.user_role
  );
  RETURN new;
END;
$function$


-- Grants for handle_new_user:
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

-- Function: prune_old_course_versions
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=False, authenticated=False, service_role=True
-- Raw ACL: postgres=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.prune_old_course_versions()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.courses c
  WHERE c.version_status = 'archived'
    AND c.root_course_id IS NOT NULL
    AND c.id NOT IN (
      SELECT id FROM courses c2
      WHERE c2.root_course_id = c.root_course_id
        AND c2.version_status = 'archived'
      ORDER BY c2.version_number DESC
      LIMIT 3
    )
    AND c.id NOT IN (
      SELECT from_version_id FROM course_update_offers
      WHERE redeemed_at IS NULL AND from_version_id IS NOT NULL
      UNION ALL
      SELECT to_version_id FROM course_update_offers
      WHERE redeemed_at IS NULL AND to_version_id IS NOT NULL
    );
END;
$function$


-- Grants for prune_old_course_versions:
GRANT EXECUTE ON FUNCTION public.prune_old_course_versions() TO service_role;

-- Function: update_updated_at_column
-- SECURITY DEFINER: False
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=True, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$


-- Grants for update_updated_at_column:
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO anon;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;

-- Function: verify_certificate
-- SECURITY DEFINER: True
-- search_path: public
-- Owner: postgres
-- EXECUTE: public=True, anon=True, authenticated=True, service_role=True
-- Raw ACL: =X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres
CREATE OR REPLACE FUNCTION public.verify_certificate(p_code text)
 RETURNS TABLE(student_name text, course_title text, instructor_name text, issued_at timestamp with time zone, completed_at_snapshot timestamp with time zone, quiz_score_snapshot numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.full_name, c.title, ip.full_name, cert.issued_at, cert.completed_at_snapshot, cert.quiz_score_snapshot
  FROM certificates cert
  JOIN profiles p ON p.id = cert.student_id
  JOIN courses c ON c.id = cert.course_id
  JOIN profiles ip ON ip.id = c.instructor_id
  WHERE cert.verification_code = p_code;
$function$


-- Grants for verify_certificate:
GRANT EXECUTE ON FUNCTION public.verify_certificate(p_code text) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_certificate(p_code text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_certificate(p_code text) TO service_role;

