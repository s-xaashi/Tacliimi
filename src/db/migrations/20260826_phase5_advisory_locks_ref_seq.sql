-- ============================================================
-- Phase 5: Concurrency and Race Condition Remediation
-- Date: 2026-08-26
-- Project: Tacliimi
-- ============================================================

-- 1. Create atomic sequence for withdrawal reference generation
CREATE SEQUENCE IF NOT EXISTS withdrawal_ref_seq START 1;

-- 2. Refactor request_withdrawal to use transaction-level advisory locks
CREATE OR REPLACE FUNCTION request_withdrawal (p_amount numeric, p_payout_method_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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

    -- ============================================================
    -- CRITICAL REMEDIATION: Concurrency Race Condition 
    -- Acquire transaction-level advisory lock using a 64-bit integer
    -- representation of the instructor UUID hash to block concurrent insertions.
    -- ============================================================
    IF NOT pg_try_advisory_xact_lock(hashtext(v_instructor_id::text)) THEN
        RETURN jsonb_build_object(
            'success', false, 
            'error', 'A withdrawal is currently being processed. Please wait a moment before trying again.'
        );
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

    -- Generate reference number atomically
    v_ref_number := 'WDR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('withdrawal_ref_seq')::text, 6, '0');

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
