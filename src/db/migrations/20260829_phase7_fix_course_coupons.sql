-- Migration: Phase 7 - Finding #3 Remediation
-- Fixes course coupon logic by enforcing maximum discount limits,
-- allowing 100% discounts only for system-level migration/promotion coupons,
-- and restricting instructors from inserting/updating system coupon types.

BEGIN;

-- Add safely-bounded constraints on coupon generation
ALTER TABLE public.course_coupons
  ADD CONSTRAINT course_coupons_discount_limit 
    CHECK (
      (coupon_type = 'general' AND discount_percent >= 0 AND discount_percent <= 99) 
      OR 
      (coupon_type != 'general' AND discount_percent >= 0 AND discount_percent <= 100)
    ),
  ADD CONSTRAINT course_coupons_valid_types 
    CHECK (coupon_type IN ('general', 'update_migration', 'promotion'));

-- Replace instructor INSERT policy to restrict to 'general' coupons
DROP POLICY IF EXISTS "Instructors can insert course coupons" ON public.course_coupons;
CREATE POLICY "Instructors can insert course coupons" ON public.course_coupons
FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM courses WHERE courses.id = course_coupons.course_id AND courses.instructor_id = auth.uid())
  AND coupon_type = 'general'
);

-- Replace instructor UPDATE policy to similarly restrict
DROP POLICY IF EXISTS "Instructors can update course coupons" ON public.course_coupons;
CREATE POLICY "Instructors can update course coupons" ON public.course_coupons
FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM courses WHERE courses.id = course_coupons.course_id AND courses.instructor_id = auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM courses WHERE courses.id = course_coupons.course_id AND courses.instructor_id = auth.uid())
  AND coupon_type = 'general'
);

COMMIT;
