-- ============================================================
-- Phase 3: RLS Remediation — Critical & High Findings
-- Date: 2026-08-26
-- Project: jboruccxbgdqntrggslz (Tacliimi)
-- ============================================================
-- BEFORE APPLYING:
--   This file is idempotent: DROP POLICY IF EXISTS before CREATE.
--   DO NOT execute the Phase 2A baseline file as part of this migration.
--   DO NOT modify function bodies or SECURITY DEFINER settings.
-- ============================================================

-- ============================================================
-- CRITICAL-2: promotion_orders — Block direct client INSERT
-- Exploit: Attacker inserts a row with self-chosen canonical_amount,
-- pays it, calls consume_promotion_order → boost granted at attacker price.
-- Fix: RESTRICTIVE policy denying all direct INSERT from client roles.
-- Only create_promotion_order (SECURITY DEFINER, service_role path) can insert.
-- ============================================================
DROP POLICY IF EXISTS "deny_direct_promotion_order_insert" ON public.promotion_orders;
CREATE POLICY "deny_direct_promotion_order_insert"
  ON public.promotion_orders
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

-- ============================================================
-- CRITICAL-1: payments — Explicit defensive INSERT policy
-- Current state: no INSERT policy → implicit deny via RLS default.
-- Protection is implicit, not designed. Make it explicit + add WITH CHECK
-- so any future policy addition cannot accidentally open INSERT.
-- ============================================================
DROP POLICY IF EXISTS "deny_direct_payment_insert" ON public.payments;
CREATE POLICY "deny_direct_payment_insert"
  ON public.payments
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

-- ============================================================
-- HIGH-1: instructor_earnings — Block direct client INSERT
-- Attacker could fabricate earnings records for any instructor_id.
-- All legitimate inserts go through createDirectPayment edge fn (service_role).
-- ============================================================
DROP POLICY IF EXISTS "deny_direct_earnings_insert" ON public.instructor_earnings;
CREATE POLICY "deny_direct_earnings_insert"
  ON public.instructor_earnings
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

-- ============================================================
-- HIGH-2: payments "Finance access only" — Add WITH CHECK
-- The ALL policy has USING but no WITH CHECK. Finance admins can currently
-- UPDATE any field (amount, student_id, status) without write constraint.
-- WITH CHECK mirrors USING to ensure they can only write rows they can read.
-- ============================================================
DROP POLICY IF EXISTS "Finance access only" ON public.payments;
CREATE POLICY "Finance access only"
  ON public.payments
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM admin_auth
      WHERE admin_auth.id = auth.uid()
        AND admin_auth.role IN ('superadmin', 'finance_manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_auth
      WHERE admin_auth.id = auth.uid()
        AND admin_auth.role IN ('superadmin', 'finance_manager')
    )
  );
