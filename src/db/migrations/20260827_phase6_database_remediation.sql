-- migration file: 20260827_phase6_database_remediation.sql

-- 1. Fix massive INSERT REST API bypasses
DROP POLICY IF EXISTS "deny_direct_payment_insert" ON public.payments;
CREATE POLICY "deny_direct_payment_insert" ON public.payments FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "deny_direct_earnings_insert" ON public.instructor_earnings;
CREATE POLICY "deny_direct_earnings_insert" ON public.instructor_earnings FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "deny_direct_promotion_order_insert" ON public.promotion_orders;
CREATE POLICY "deny_direct_promotion_order_insert" ON public.promotion_orders FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "enrollments_student_insert" ON public.enrollments;
DROP POLICY IF EXISTS "Students can enroll themselves" ON public.enrollments;
CREATE POLICY "deny_direct_enrollment_insert" ON public.enrollments FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "instructors_insert_withdrawal" ON public.withdrawal_requests;
CREATE POLICY "deny_direct_withdrawal_insert" ON public.withdrawal_requests FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "Instructors can create courses" ON public.courses;
DROP POLICY IF EXISTS "Instructors can insert own courses" ON public.courses;
DROP POLICY IF EXISTS "courses_insert_instructor" ON public.courses;
CREATE POLICY "Instructors can create courses safely" ON public.courses FOR INSERT
WITH CHECK (
  auth.uid() = instructor_id
  AND status = 'draft'
);

DROP POLICY IF EXISTS "Students can book sessions" ON public.mentorship_sessions;
CREATE POLICY "Students can book sessions safely" ON public.mentorship_sessions FOR INSERT
WITH CHECK (
  auth.uid() = student_id
  AND booking_status = 'pending_review'
  AND status = 'upcoming'
);


-- 2. Fix SECURITY DEFINER triggers
CREATE OR REPLACE FUNCTION public.protect_course_state_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Unauthorized: Cannot directly modify course status';
  END IF;

  RETURN NEW;
END;
$$;


CREATE OR REPLACE FUNCTION public.protect_session_state_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN NEW;
  END IF;
  
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Unauthorized: Cannot directly modify session status';
  END IF;

  IF NEW.booking_status IS DISTINCT FROM OLD.booking_status THEN
    RAISE EXCEPTION 'Unauthorized: Cannot directly modify booking_status';
  END IF;

  RETURN NEW;
END;
$$;


-- 3. Fix Admin RPC IDORs and DoS
CREATE OR REPLACE FUNCTION public.admin_cancel_boost(p_boost_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM admin_auth WHERE id = auth.uid()) THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    UPDATE boosts
    SET cancelled_at = now()
    WHERE id = p_boost_id AND cancelled_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_cancel_promo_banner(p_banner_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM admin_auth WHERE id = auth.uid()) THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    UPDATE promo_banners
    SET cancelled_at = now()
    WHERE id = p_banner_id AND cancelled_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_instructor(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.admin_auth WHERE id = auth.uid() AND role = 'superadmin') THEN
        RAISE EXCEPTION 'Unauthorized: Only superadmins can delete instructors.';
    END IF;

    DELETE FROM public.courses WHERE instructor_id = p_user_id;

    DELETE FROM public.mentorship_sessions WHERE mentor_id = p_user_id;
    DELETE FROM public.mentorship_profiles WHERE instructor_id = p_user_id;

    DELETE FROM public.teaching_profiles WHERE instructor_id = p_user_id;

    DELETE FROM public.instructors WHERE user_id = p_user_id;

    DELETE FROM public.profiles WHERE id = p_user_id;
END;
$$;
