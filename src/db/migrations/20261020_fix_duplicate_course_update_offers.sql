-- Fix duplicate source rows when one student enrolled in multiple old versions.
-- course_update_offers has one row per (to_version_id, student_id), so the
-- INSERT source must choose exactly one prior version for each student.

CREATE OR REPLACE FUNCTION public.create_update_offer(
  p_root_course_id UUID,
  p_to_version_id UUID,
  p_coupon_id UUID DEFAULT NULL,
  p_notify BOOLEAN DEFAULT TRUE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_count INTEGER;
  v_family_id UUID;
  v_owner_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required';
  END IF;

  SELECT COALESCE(root_course_id, id), instructor_id
    INTO v_family_id, v_owner_id
  FROM courses
  WHERE id = p_root_course_id;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Course not found';
  END IF;

  IF v_owner_id != auth.uid()
     AND NOT EXISTS (SELECT 1 FROM admin_auth WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized: You can only create update offers for your own courses';
  END IF;

  INSERT INTO course_update_offers (
    root_course_id, from_version_id, to_version_id, coupon_id, student_id, notified_at
  )
  SELECT
    v_family_id,
    enrolled_version.course_id,
    p_to_version_id,
    p_coupon_id,
    enrolled_version.student_id,
    CASE WHEN p_notify THEN now() ELSE NULL END
  FROM (
    SELECT DISTINCT ON (e.student_id)
      e.student_id,
      e.course_id,
      c.version_number,
      e.enrolled_at,
      c.created_at
    FROM enrollments e
    JOIN courses c ON c.id = e.course_id
    WHERE COALESCE(c.root_course_id, c.id) = v_family_id
      AND c.id != p_to_version_id
    ORDER BY
      e.student_id,
      c.version_number DESC NULLS LAST,
      e.enrolled_at DESC,
      c.created_at DESC,
      e.course_id
  ) AS enrolled_version
  ON CONFLICT (to_version_id, student_id)
  DO UPDATE SET
    coupon_id = EXCLUDED.coupon_id,
    from_version_id = EXCLUDED.from_version_id,
    notified_at = COALESCE(EXCLUDED.notified_at, course_update_offers.notified_at);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
