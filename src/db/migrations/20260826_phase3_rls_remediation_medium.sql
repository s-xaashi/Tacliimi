-- ============================================================
-- Phase 3: MEDIUM-4 Remediation (Missing WITH CHECK)
-- Date: 2026-08-26
-- Project: jboruccxbgdqntrggslz (Tacliimi)
-- ============================================================
-- Adds missing WITH CHECK constraint to the profiles UPDATE policy.
-- Ensures malicious users cannot swap their profile 'id' while updating,
-- which would break the USING filter guarantees.
-- ============================================================

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO public
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
