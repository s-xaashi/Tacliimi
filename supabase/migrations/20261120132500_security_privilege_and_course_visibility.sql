-- Tacliimi security migration 01: privilege escalation and public course visibility
-- Revised after live-schema review on 2026-11-20.
-- Apply only after the matching frontend/Edge Function patch is deployed.
-- The active Superadmin already exists in admin_auth; no legacy admin promotion is included.

BEGIN;

-- 1. Signup metadata is untrusted: only student/instructor are self-selectable.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_role text;
BEGIN
  v_role := lower(COALESCE(new.raw_user_meta_data->>'role', 'student'));
  IF v_role NOT IN ('student', 'instructor') THEN
    v_role := 'student';
  END IF;

  INSERT INTO public.profiles (id, full_name, role)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', v_role::public.user_role);
  RETURN new;
END;
$function$;

-- 2. Prevent direct changes to identity/privilege fields. Trusted SECURITY DEFINER
-- RPCs run as their owner and can still perform authorized status changes.
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'profiles.id cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'profiles.role cannot be changed directly' USING ERRCODE = '42501';
  END IF;
  IF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
    RAISE EXCEPTION 'profiles.account_status cannot be changed directly' USING ERRCODE = '42501';
  END IF;
  IF NEW.serial_id IS DISTINCT FROM OLD.serial_id THEN
    RAISE EXCEPTION 'profiles.serial_id cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_protect_profile_privileged_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_privileged_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileged_fields();

ALTER POLICY "Users can insert their own profile" ON public.profiles
WITH CHECK (
  auth.uid() = id
  AND role IN ('student', 'instructor')
  AND COALESCE(account_status, 'active') = 'active'
);

-- 3. Harden the existing student status RPC instead of introducing a duplicate
-- account-status RPC. Existing student-management UI already calls this function.
CREATE OR REPLACE FUNCTION public.admin_update_student_status(
  p_admin_id uuid, p_user_id uuid, p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
BEGIN
  IF v_caller_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_auth
    WHERE id = v_caller_id AND role IN ('superadmin', 'course_manager')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Not a valid admin' USING ERRCODE = '42501';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('active', 'suspended', 'blocked') THEN
    RAISE EXCEPTION 'Invalid account status';
  END IF;

  UPDATE public.profiles
  SET account_status = p_status, updated_at = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND role = 'student') THEN
    INSERT INTO public.students (user_id, account_status)
    VALUES (p_user_id, p_status)
    ON CONFLICT (user_id) DO UPDATE SET account_status = EXCLUDED.account_status;
  END IF;

  INSERT INTO public.admin_audit_logs (admin_id, action, entity_type, entity_id, details)
  VALUES (v_caller_id, 'update_status', 'student', p_user_id,
          jsonb_build_object('new_status', p_status));
END;
$function$;

-- The instructor page also used direct profile updates for block/unblock and
-- approve/unsuspend. Move those updates into its existing atomic SECURITY DEFINER RPC.
CREATE OR REPLACE FUNCTION public.admin_update_instructor_status(
  p_admin_id uuid,
  p_user_id uuid,
  p_approval_status text DEFAULT NULL,
  p_verification_status text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_auth
    WHERE id = auth.uid() AND role IN ('superadmin', 'course_manager')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Not a valid admin' USING ERRCODE = '42501';
  END IF;

  IF p_approval_status IS NOT NULL
     AND p_approval_status NOT IN ('approved', 'suspended', 'blocked') THEN
    RAISE EXCEPTION 'Invalid instructor approval status';
  END IF;

  INSERT INTO public.instructors (user_id, approval_status, verification_status)
  VALUES (p_user_id, p_approval_status, p_verification_status)
  ON CONFLICT (user_id) DO UPDATE SET
    approval_status = COALESCE(EXCLUDED.approval_status, instructors.approval_status),
    verification_status = COALESCE(EXCLUDED.verification_status, instructors.verification_status);

  -- Preserve current UI semantics: approve/unsuspend reactivate the account;
  -- block disables it; instructor-only suspension remains an instructor status.
  IF p_approval_status IN ('approved', 'blocked') THEN
    UPDATE public.profiles
    SET account_status = CASE
      WHEN p_approval_status = 'blocked' THEN 'blocked'
      ELSE 'active'
    END,
    updated_at = now()
    WHERE id = p_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Instructor profile not found';
    END IF;
  END IF;
END;
$function$;

-- 4. Close SQL NULL authorization bypasses in all moderation entry points.
CREATE OR REPLACE FUNCTION public.approve_course_admin(
  p_course_id uuid, p_moderator_id uuid, p_notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_family_id uuid;
  v_is_revision boolean;
  v_caller_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_caller_role FROM public.admin_auth WHERE id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('course_manager', 'superadmin') THEN
    RAISE EXCEPTION 'Unauthorized: course-manager privileges required' USING ERRCODE = '42501';
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
$function$;

CREATE OR REPLACE FUNCTION public.reject_course_admin(
  p_course_id uuid, p_instructor_id uuid, p_moderator_id uuid,
  p_notes text DEFAULT 'Rejected based on review.'::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_caller_role FROM public.admin_auth WHERE id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('course_manager', 'superadmin') THEN
    RAISE EXCEPTION 'Unauthorized: course-manager privileges required' USING ERRCODE = '42501';
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
$function$;

CREATE OR REPLACE FUNCTION public.handle_course_appeal_admin(
  p_course_id uuid, p_decision text, p_moderator_id uuid, p_notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_caller_role FROM public.admin_auth WHERE id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('course_manager', 'superadmin') THEN
    RAISE EXCEPTION 'Unauthorized: course-manager privileges required' USING ERRCODE = '42501';
  END IF;

  IF p_decision = 'approve' THEN
    UPDATE public.courses SET status = 'pending_review'
    WHERE id = p_course_id AND status = 'appealed';
    INSERT INTO public.course_moderation_logs (course_id, moderator_id, decision, notes)
    VALUES (p_course_id, auth.uid(), 'approved', p_notes);
  ELSIF p_decision = 'reject' THEN
    DELETE FROM public.courses WHERE id = p_course_id;
  ELSE
    RAISE EXCEPTION 'Invalid appeal decision';
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.approve_course_admin(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.approve_course_admin(uuid, uuid, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_course_admin(uuid, uuid, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_course_appeal_admin(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_course_admin(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_course_admin(uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_course_admin(uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.handle_course_appeal_admin(uuid, text, uuid, text) TO authenticated;

-- Use an empty search_path in this SECURITY DEFINER authorization helper.
CREATE OR REPLACE FUNCTION public.check_is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_auth
    WHERE id = auth.uid()
  );
$function$;

-- 5. Replace all 19 profile.role-based admin policy checks with admin_auth.
ALTER POLICY "Admins can view all payout methods" ON public.payout_methods
USING ((SELECT public.check_is_admin()));

ALTER POLICY "Admins can view all courses" ON public.courses
USING ((SELECT public.check_is_admin()));

ALTER POLICY "Admins can update all courses" ON public.courses
USING ((SELECT public.check_is_admin()))
WITH CHECK ((SELECT public.check_is_admin()));

ALTER POLICY "Admins can view all payments" ON public.payments
USING ((SELECT public.check_is_admin()));

ALTER POLICY "Admins can view audit logs" ON public.audit_logs
USING ((SELECT public.check_is_admin()));

ALTER POLICY "Admins can manage other admins" ON public.admin_accounts
USING (EXISTS (
  SELECT 1 FROM public.admin_auth a
  WHERE a.id = auth.uid() AND a.role = 'superadmin'
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.admin_auth a
  WHERE a.id = auth.uid() AND a.role = 'superadmin'
));

ALTER POLICY "course_categories_admin_write" ON public.course_categories
USING ((SELECT public.check_is_admin()))
WITH CHECK ((SELECT public.check_is_admin()));

ALTER POLICY "Admins can delete any session" ON public.mentorship_sessions
USING ((SELECT public.check_is_admin()));

ALTER POLICY "Admins can view course sections" ON public.course_sections
USING ((SELECT public.check_is_admin()));

ALTER POLICY "Admins can view course lessons" ON public.course_lessons
USING ((SELECT public.check_is_admin()));

ALTER POLICY "Admins can view lesson resources" ON public.lesson_resources
USING ((SELECT public.check_is_admin()));

ALTER POLICY "Admins and instructors can view course coupons" ON public.course_coupons
USING (
  auth.uid() IN (
    SELECT c.instructor_id FROM public.courses c WHERE c.id = course_coupons.course_id
  )
  OR (SELECT public.check_is_admin())
);

ALTER POLICY "Admins can insert course coupons" ON public.course_coupons
WITH CHECK ((SELECT public.check_is_admin()));

ALTER POLICY "Admins can delete course coupons" ON public.course_coupons
USING ((SELECT public.check_is_admin()));

ALTER POLICY "Allow admin to view moderation logs" ON public.course_moderation_logs
USING ((SELECT public.check_is_admin()));

ALTER POLICY "Anyone can view active categories" ON public.mentor_categories
USING (is_active = true OR (SELECT public.check_is_admin()));

ALTER POLICY "Admins have full access to mentor_categories" ON public.mentor_categories
USING ((SELECT public.check_is_admin()))
WITH CHECK ((SELECT public.check_is_admin()));

ALTER POLICY "Admins have full access to search_opportunities" ON public.search_opportunities
USING ((SELECT public.check_is_admin()))
WITH CHECK ((SELECT public.check_is_admin()));

ALTER POLICY "Admins can view all enrollments" ON public.enrollments
USING ((SELECT public.check_is_admin()));

-- 6. Course visibility: no broad instructor SELECT and no legacy public
-- published-only policy may remain, because permissive policies are ORed.
CREATE OR REPLACE FUNCTION public.user_is_enrolled(p_course_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.enrollments e
    WHERE e.course_id = p_course_id AND e.student_id = auth.uid()
  );
$function$;

REVOKE ALL ON FUNCTION public.user_is_enrolled(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_is_enrolled(uuid) TO authenticated;

DROP POLICY IF EXISTS "Instructors can read all courses" ON public.courses;
DROP POLICY IF EXISTS "Courses are viewable by everyone if published" ON public.courses;

ALTER POLICY courses_select_public ON public.courses
USING (
  (
    is_public = true
    AND status = 'published'
    AND version_status = 'published'
    AND is_latest_published = true
    AND deleted_at IS NULL
  )
  OR (auth.uid() = instructor_id AND deleted_at IS NULL)
);

DROP POLICY IF EXISTS "Enrolled students can view their courses" ON public.courses;
CREATE POLICY "Enrolled students can view their courses"
ON public.courses FOR SELECT TO authenticated
USING (deleted_at IS NULL AND public.user_is_enrolled(id));

-- Keep the existing marketplace view contract, but make its public filter
-- match the same public-course definition. It is intentionally a curated
-- SECURITY DEFINER view, so the filter must be explicit here as well.
CREATE OR REPLACE VIEW public.course_marketplace_view AS
SELECT
  c.id,
  c.instructor_id,
  c.title,
  COALESCE(root.slug, c.slug) AS slug,
  c.description,
  c.thumbnail_url,
  c.price,
  c.status,
  c.created_at,
  c.updated_at,
  c.deleted_at,
  c.subtitle,
  c.category_id,
  c.level,
  c.intro_video_url,
  c.price_type,
  c.currency,
  c.is_public,
  c.total_duration_minutes,
  COALESCE(c.root_course_id, c.id) AS family_id,
  c.version_number,
  p.full_name AS instructor_name,
  p.avatar_url AS instructor_avatar,
  cc.name AS category_name,
  COALESCE(fam_agg.avg_rating, 0::numeric) AS average_rating,
  COALESCE(fam_agg.review_count, 0::bigint) AS review_count,
  COALESCE(fam_agg.enrollments_count, 0::bigint) AS enrollments_count,
  COALESCE(l.lessons_count, 0::bigint) AS total_lessons,
  COALESCE(q.quizzes_count, 0::bigint) AS total_quizzes,
  COALESCE(res.resources_count, 0::bigint) AS total_resources,
  c.thumbnail_storage_key,
  p.avatar_storage_key AS instructor_avatar_storage_key
FROM public.courses c
JOIN public.profiles p ON c.instructor_id = p.id
JOIN public.instructors i ON c.instructor_id = i.user_id
LEFT JOIN public.course_categories cc ON c.category_id = cc.id
LEFT JOIN public.courses root ON root.id = c.root_course_id
LEFT JOIN (
  SELECT
    COALESCE(c2.root_course_id, c2.id) AS family_id,
    avg(cr.rating)::numeric(3,1) AS avg_rating,
    count(DISTINCT cr.id) AS review_count,
    count(DISTINCT e.id) AS enrollments_count
  FROM public.courses c2
  LEFT JOIN public.course_reviews cr ON cr.course_id = c2.id
  LEFT JOIN public.enrollments e ON e.course_id = c2.id
  GROUP BY COALESCE(c2.root_course_id, c2.id)
) fam_agg ON fam_agg.family_id = COALESCE(c.root_course_id, c.id)
LEFT JOIN (
  SELECT s.course_id, count(ls.id) AS lessons_count
  FROM public.course_sections s
  JOIN public.course_lessons ls ON ls.section_id = s.id
  WHERE ls.deleted_at IS NULL
  GROUP BY s.course_id
) l ON l.course_id = c.id
LEFT JOIN (
  SELECT s.course_id, count(qz.id) AS quizzes_count
  FROM public.course_sections s
  JOIN public.course_lessons ls ON ls.section_id = s.id
  JOIN public.quizzes qz ON qz.lesson_id = ls.id
  WHERE ls.deleted_at IS NULL
  GROUP BY s.course_id
) q ON q.course_id = c.id
LEFT JOIN (
  SELECT s.course_id, count(rs.id) AS resources_count
  FROM public.course_sections s
  JOIN public.course_lessons ls ON ls.section_id = s.id
  JOIN public.lesson_resources rs ON rs.lesson_id = ls.id
  WHERE ls.deleted_at IS NULL
  GROUP BY s.course_id
) res ON res.course_id = c.id
WHERE c.is_latest_published = true
  AND c.status = 'published'
  AND c.version_status = 'published'
  AND c.is_public = true
  AND c.deleted_at IS NULL
  AND i.approval_status = 'approved'
  AND p.account_status = 'active';

COMMIT;
