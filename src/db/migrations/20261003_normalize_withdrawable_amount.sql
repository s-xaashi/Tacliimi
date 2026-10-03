-- Normalize the final instructor withdrawable amount to the same two-decimal
-- precision used by the withdrawal UI and transaction history.
--
-- This preserves the existing reserve calculation and accounting balances.
-- Only the final amount that can be requested is normalized, so when the
-- reserve setting is disabled a balance such as 0.118 becomes a withdrawable
-- amount of 0.12, matching what the instructor sees and can request.

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
    v_reserve_enabled      boolean;
    v_reserve_percent      numeric;
    v_reserve              numeric;
    v_withdrawable         numeric;
    v_monthly              numeric;
    v_weekly               numeric;
    v_today                numeric;
BEGIN
    IF auth.uid() != p_instructor_id AND NOT check_is_finance_admin() AND NOT check_is_superadmin() THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    SELECT COALESCE(SUM(ie.instructor_share), 0),
           COALESCE(SUM(ie.platform_fee), 0)
    INTO v_total_earned, v_total_platform_fees
    FROM public.instructor_earnings ie
    JOIN public.payments p ON p.id = ie.payment_id
    WHERE ie.instructor_id = p_instructor_id
      AND p.payment_status = 'paid';

    SELECT COALESCE(SUM(wr.amount), 0)
    INTO v_total_withdrawn
    FROM public.withdrawal_requests wr
    WHERE wr.instructor_id = p_instructor_id
      AND wr.status IN ('approved', 'processing', 'paid');

    SELECT COALESCE(SUM(wr.amount), 0)
    INTO v_pending_withdrawals
    FROM public.withdrawal_requests wr
    WHERE wr.instructor_id = p_instructor_id
      AND wr.status = 'pending';

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

    v_cleared_earnings := v_total_earned - v_held_balance;
    v_available := v_cleared_earnings - v_total_withdrawn - v_pending_withdrawals;

    SELECT
        COALESCE(ps.min_withdrawal_amount, 10),
        COALESCE(ps.withdrawal_reserve_enabled, true),
        COALESCE(ps.withdrawal_reserve_percent, 50)
    INTO
        v_min_withdrawal, v_reserve_enabled, v_reserve_percent
    FROM public.platform_settings ps LIMIT 1;

    IF v_reserve_enabled IS FALSE THEN
        v_reserve := 0;
    ELSE
        v_reserve := (v_min_withdrawal * COALESCE(v_reserve_percent, 50)) / 100.0;
    END IF;

    -- Keep the final requestable amount aligned with the application's
    -- two-decimal monetary display without changing the underlying balance.
    v_withdrawable := ROUND(GREATEST(0, v_available - v_reserve), 2);

    SELECT COALESCE(SUM(ie.instructor_share), 0)
    INTO v_monthly
    FROM public.instructor_earnings ie
    JOIN public.payments p ON p.id = ie.payment_id
    WHERE ie.instructor_id = p_instructor_id
      AND p.payment_status = 'paid'
      AND ie.created_at >= date_trunc('month', now());

    SELECT COALESCE(SUM(ie.instructor_share), 0)
    INTO v_weekly
    FROM public.instructor_earnings ie
    JOIN public.payments p ON p.id = ie.payment_id
    WHERE ie.instructor_id = p_instructor_id
      AND p.payment_status = 'paid'
      AND ie.created_at >= date_trunc('week', now());

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
        'min_withdrawal_amount', v_min_withdrawal,
        'withdrawal_reserve_enabled', COALESCE(v_reserve_enabled, true),
        'withdrawal_reserve_percent', COALESCE(v_reserve_percent, 50),
        'withdrawable_amount',   v_withdrawable,
        'reserve_amount',        v_reserve,
        'monthly',               v_monthly,
        'weekly',                v_weekly,
        'today',                 v_today
    );
END;
$function$;
