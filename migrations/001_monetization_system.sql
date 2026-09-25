-- ============================================================
-- MIGRATION 1: Platform Settings Table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.platform_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    commission_enabled boolean NOT NULL DEFAULT false,
    instructor_percentage numeric NOT NULL DEFAULT 100
        CHECK (instructor_percentage >= 0 AND instructor_percentage <= 100),
    platform_percentage numeric NOT NULL DEFAULT 0
        CHECK (platform_percentage >= 0 AND platform_percentage <= 100),
    min_withdrawal_amount numeric NOT NULL DEFAULT 10
        CHECK (min_withdrawal_amount >= 0),
    updated_by uuid REFERENCES public.admin_auth(id),
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT percentages_sum_to_100
        CHECK (instructor_percentage + platform_percentage = 100)
);

-- Seed default row (monetization OFF)
INSERT INTO public.platform_settings
    (commission_enabled, instructor_percentage, platform_percentage, min_withdrawal_amount)
VALUES (false, 100, 0, 10)
ON CONFLICT DO NOTHING;

-- RLS
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read platform settings"
    ON public.platform_settings FOR SELECT USING (true);

CREATE POLICY "Admins can update platform settings"
    ON public.platform_settings FOR UPDATE
    USING (EXISTS (SELECT 1 FROM public.admin_auth WHERE id = auth.uid()));

COMMENT ON TABLE public.platform_settings
    IS 'Single-row config for platform monetization and commission split.';

-- ============================================================
-- MIGRATION 2: Extend instructor_earnings with commission snapshot
-- ============================================================
ALTER TABLE public.instructor_earnings
    ADD COLUMN IF NOT EXISTS instructor_percentage_snapshot numeric DEFAULT 100,
    ADD COLUMN IF NOT EXISTS platform_percentage_snapshot numeric DEFAULT 0,
    ADD COLUMN IF NOT EXISTS earning_type text DEFAULT 'course'
        CHECK (earning_type IN ('course', 'mentorship')),
    ADD COLUMN IF NOT EXISTS mentorship_session_id uuid REFERENCES public.mentorship_sessions(id),
    ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD';

-- Make course_id nullable (mentorship earnings won't have one)
ALTER TABLE public.instructor_earnings
    ALTER COLUMN course_id DROP NOT NULL;

COMMENT ON COLUMN public.instructor_earnings.instructor_percentage_snapshot
    IS 'Snapshotted instructor % at time of payment — never changes retroactively.';
COMMENT ON COLUMN public.instructor_earnings.platform_percentage_snapshot
    IS 'Snapshotted platform % at time of payment — never changes retroactively.';

-- ============================================================
-- MIGRATION 3: Extend withdrawal_requests
-- ============================================================
-- Drop old check constraint, add extended statuses
ALTER TABLE public.withdrawal_requests
    DROP CONSTRAINT IF EXISTS withdrawal_requests_status_check;

ALTER TABLE public.withdrawal_requests
    ADD CONSTRAINT withdrawal_requests_status_check
        CHECK (status IN ('pending', 'approved', 'rejected', 'processing', 'paid'));

-- Add new columns
ALTER TABLE public.withdrawal_requests
    ADD COLUMN IF NOT EXISTS reference_number text UNIQUE,
    ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD',
    ADD COLUMN IF NOT EXISTS payout_method_snapshot jsonb,
    ADD COLUMN IF NOT EXISTS notes_to_instructor text;

COMMENT ON COLUMN public.withdrawal_requests.reference_number
    IS 'Human-readable ID like WDR-2026-000001';
COMMENT ON COLUMN public.withdrawal_requests.payout_method_snapshot
    IS 'Frozen snapshot of payout method details at withdrawal request time.';

-- ============================================================
-- MIGRATION 4: RPC — get_platform_settings()
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_platform_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result jsonb;
BEGIN
    SELECT jsonb_build_object(
        'commission_enabled', ps.commission_enabled,
        'instructor_percentage', ps.instructor_percentage,
        'platform_percentage', ps.platform_percentage,
        'min_withdrawal_amount', ps.min_withdrawal_amount,
        'updated_at', ps.updated_at
    ) INTO result
    FROM public.platform_settings ps
    LIMIT 1;

    RETURN COALESCE(result, '{"commission_enabled":false,"instructor_percentage":100,"platform_percentage":0,"min_withdrawal_amount":10}'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_platform_settings()
    IS 'Returns current platform monetization settings. Safe for public use.';

-- ============================================================
-- MIGRATION 5: RPC — request_withdrawal()
-- ============================================================
CREATE OR REPLACE FUNCTION public.request_withdrawal(
    p_amount numeric,
    p_payout_method_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_instructor_id uuid;
    v_total_earned numeric;
    v_total_withdrawn numeric;
    v_available numeric;
    v_min_withdrawal numeric;
    v_method_snapshot jsonb;
    v_ref_number text;
    v_new_id uuid;
    v_method_type text;
BEGIN
    v_instructor_id := auth.uid();
    IF v_instructor_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
    END IF;

    -- Get min withdrawal amount
    SELECT COALESCE(ps.min_withdrawal_amount, 10)
    INTO v_min_withdrawal
    FROM public.platform_settings ps LIMIT 1;

    -- Validate amount
    IF p_amount <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
    END IF;
    IF p_amount < v_min_withdrawal THEN
        RETURN jsonb_build_object('success', false, 'error',
            'Minimum withdrawal is $' || v_min_withdrawal::text);
    END IF;

    -- Calculate available balance
    SELECT COALESCE(SUM(ie.instructor_share), 0)
    INTO v_total_earned
    FROM public.instructor_earnings ie
    JOIN public.payments p ON p.id = ie.payment_id
    WHERE ie.instructor_id = v_instructor_id
      AND p.payment_status = 'paid';

    SELECT COALESCE(SUM(wr.amount), 0)
    INTO v_total_withdrawn
    FROM public.withdrawal_requests wr
    WHERE wr.instructor_id = v_instructor_id
      AND wr.status IN ('pending', 'approved', 'processing', 'paid');

    v_available := v_total_earned - v_total_withdrawn;

    IF p_amount > v_available THEN
        RETURN jsonb_build_object('success', false, 'error',
            'Insufficient balance. Available: $' || v_available::text);
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
$$;

COMMENT ON FUNCTION public.request_withdrawal(numeric, uuid)
    IS 'Instructor requests withdrawal with balance validation and payout method snapshot.';

-- ============================================================
-- MIGRATION 6: RPC — get_instructor_earnings_summary()
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_instructor_earnings_summary(p_instructor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total_earned numeric;
    v_total_platform_fees numeric;
    v_total_withdrawn numeric;
    v_pending_withdrawals numeric;
    v_available numeric;
    v_monthly numeric;
    v_weekly numeric;
    v_today numeric;
BEGIN
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

    v_available := v_total_earned - v_total_withdrawn - v_pending_withdrawals;

    -- Monthly
    SELECT COALESCE(SUM(ie.instructor_share), 0)
    INTO v_monthly
    FROM public.instructor_earnings ie
    JOIN public.payments p ON p.id = ie.payment_id
    WHERE ie.instructor_id = p_instructor_id
      AND p.payment_status = 'paid'
      AND ie.created_at >= date_trunc('month', now());

    -- Weekly
    SELECT COALESCE(SUM(ie.instructor_share), 0)
    INTO v_weekly
    FROM public.instructor_earnings ie
    JOIN public.payments p ON p.id = ie.payment_id
    WHERE ie.instructor_id = p_instructor_id
      AND p.payment_status = 'paid'
      AND ie.created_at >= date_trunc('week', now());

    -- Today
    SELECT COALESCE(SUM(ie.instructor_share), 0)
    INTO v_today
    FROM public.instructor_earnings ie
    JOIN public.payments p ON p.id = ie.payment_id
    WHERE ie.instructor_id = p_instructor_id
      AND p.payment_status = 'paid'
      AND ie.created_at >= date_trunc('day', now());

    RETURN jsonb_build_object(
        'total_earned', v_total_earned,
        'platform_fees', v_total_platform_fees,
        'net_earnings', v_total_earned,
        'total_withdrawn', v_total_withdrawn,
        'pending_withdrawals', v_pending_withdrawals,
        'available_balance', v_available,
        'monthly', v_monthly,
        'weekly', v_weekly,
        'today', v_today
    );
END;
$$;

COMMENT ON FUNCTION public.get_instructor_earnings_summary(uuid)
    IS 'Aggregates instructor earnings with time-based breakdowns.';

-- ============================================================
-- MIGRATION 7: RPC — get_finance_analytics() (admin-only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_finance_analytics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      AND p.course_id IS NOT NULL;

    -- Mentorship revenue
    SELECT COALESCE(SUM(p.amount), 0)
    INTO v_mentorship_revenue
    FROM public.payments p
    WHERE p.payment_status = 'paid'
      AND p.mentorship_session_id IS NOT NULL;

    RETURN jsonb_build_object(
        'total_revenue', v_total_revenue,
        'platform_fees', v_total_platform_fees,
        'instructor_payouts', v_total_instructor_payouts,
        'withdrawals_paid', v_total_withdrawals_paid,
        'withdrawals_pending', v_total_withdrawals_pending,
        'refunds', v_total_refunds,
        'monthly_revenue', v_monthly_revenue,
        'course_revenue', v_course_revenue,
        'mentorship_revenue', v_mentorship_revenue
    );
END;
$$;

COMMENT ON FUNCTION public.get_finance_analytics()
    IS 'Admin-only platform-wide financial analytics aggregation.';
