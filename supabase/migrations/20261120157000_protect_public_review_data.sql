-- Keep individual review records private while exposing curated public review
-- projections and aggregate mentor metrics. This also honors reviewer profile
-- visibility and only publishes metrics for active, public mentors/courses.
BEGIN;

-- Public mentor review projection: no student ID or private profile fields.
CREATE OR REPLACE VIEW public.mentor_profile_reviews_public_view
WITH (security_barrier = true)
AS
SELECT
  r.mentor_id,
  r.rating,
  r.comment,
  r.created_at,
  CASE WHEN p.is_public IS TRUE THEN p.full_name ELSE 'Student' END AS full_name,
  CASE WHEN p.is_public IS TRUE THEN p.avatar_url ELSE NULL END AS avatar_url,
  CASE WHEN p.is_public IS TRUE THEN p.avatar_storage_key ELSE NULL END AS avatar_storage_key
FROM public.mentorship_reviews AS r
JOIN public.mentorship_profiles AS mp
  ON mp.instructor_id = r.mentor_id
 AND mp.is_public IS TRUE
 AND mp.deleted_at IS NULL
LEFT JOIN public.profiles AS p ON p.id = r.student_id
WHERE public.is_public_course_owner_active(r.mentor_id);

REVOKE ALL PRIVILEGES ON TABLE public.mentor_profile_reviews_view
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.mentor_profile_reviews_public_view
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mentor_profile_reviews_public_view TO anon, authenticated;

-- Restrict all mentor aggregate views to active, publicly listed mentors.
CREATE OR REPLACE VIEW public.mentor_rating_stats
WITH (security_barrier = true)
AS
SELECT
  r.mentor_id,
  count(*)::integer AS review_count,
  round(avg(r.rating), 1) AS avg_rating
FROM public.mentorship_reviews AS r
WHERE EXISTS (
  SELECT 1
  FROM public.mentorship_profiles AS mp
  WHERE mp.instructor_id = r.mentor_id
    AND mp.is_public IS TRUE
    AND mp.deleted_at IS NULL
)
AND public.is_public_course_owner_active(r.mentor_id)
GROUP BY r.mentor_id;

CREATE OR REPLACE VIEW public.mentor_response_times_view
WITH (security_barrier = true)
AS
SELECT
  s.mentor_id,
  EXTRACT(epoch FROM avg(mentor_msg.created_at - student_msg.created_at)) / 3600::numeric AS avg_response_time_hours
FROM public.mentorship_sessions AS s
JOIN (
  SELECT booking_id, min(created_at) AS created_at
  FROM public.mentorship_booking_messages
  WHERE sender_role = 'student'::text
  GROUP BY booking_id
) AS student_msg ON student_msg.booking_id = s.id
JOIN (
  SELECT booking_id, min(created_at) AS created_at
  FROM public.mentorship_booking_messages
  WHERE sender_role = 'mentor'::text
  GROUP BY booking_id
) AS mentor_msg ON mentor_msg.booking_id = s.id
WHERE mentor_msg.created_at > student_msg.created_at
  AND EXISTS (
    SELECT 1 FROM public.mentorship_profiles AS mp
    WHERE mp.instructor_id = s.mentor_id
      AND mp.is_public IS TRUE
      AND mp.deleted_at IS NULL
  )
  AND public.is_public_course_owner_active(s.mentor_id)
GROUP BY s.mentor_id;

CREATE OR REPLACE VIEW public.mentor_session_stats_view
WITH (security_barrier = true)
AS
SELECT s.mentor_id, count(*) AS confirmed_session_count
FROM public.mentorship_sessions AS s
WHERE s.status = 'confirmed'::text
  AND s.booking_status = 'confirmed'::text
  AND EXISTS (
    SELECT 1 FROM public.mentorship_profiles AS mp
    WHERE mp.instructor_id = s.mentor_id
      AND mp.is_public IS TRUE
      AND mp.deleted_at IS NULL
  )
  AND public.is_public_course_owner_active(s.mentor_id)
GROUP BY s.mentor_id;

CREATE OR REPLACE VIEW public.mentor_response_metrics_view
WITH (security_barrier = true)
AS
WITH first_student_message AS (
  SELECT booking_id, min(created_at) AS first_student_at
  FROM public.mentorship_booking_messages
  WHERE sender_role = 'student'::text
  GROUP BY booking_id
),
booking_response AS (
  SELECT
    s.mentor_id,
    EXTRACT(epoch FROM mentor_reply.first_mentor_at - student.first_student_at) AS response_seconds
  FROM public.mentorship_sessions AS s
  JOIN first_student_message AS student ON student.booking_id = s.id
  JOIN LATERAL (
    SELECT min(m.created_at) AS first_mentor_at
    FROM public.mentorship_booking_messages AS m
    WHERE m.booking_id = s.id
      AND m.sender_role = 'mentor'::text
      AND m.created_at > student.first_student_at
  ) AS mentor_reply ON mentor_reply.first_mentor_at IS NOT NULL
  WHERE s.mentor_id IS NOT NULL
)
SELECT
  br.mentor_id,
  percentile_cont(0.5::double precision)
    WITHIN GROUP (ORDER BY br.response_seconds::double precision)::numeric AS typical_response_time_seconds,
  count(*) AS response_sample_count
FROM booking_response AS br
WHERE br.response_seconds >= 0::numeric
  AND EXISTS (
    SELECT 1 FROM public.mentorship_profiles AS mp
    WHERE mp.instructor_id = br.mentor_id
      AND mp.is_public IS TRUE
      AND mp.deleted_at IS NULL
  )
  AND public.is_public_course_owner_active(br.mentor_id)
GROUP BY br.mentor_id;

-- The public mentor aggregate/review views expose no underlying review rows.
REVOKE ALL PRIVILEGES ON TABLE public.mentor_rating_stats,
  public.mentor_response_times_view,
  public.mentor_session_stats_view,
  public.mentor_response_metrics_view
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mentor_rating_stats,
  public.mentor_response_times_view,
  public.mentor_session_stats_view,
  public.mentor_response_metrics_view
  TO anon, authenticated;

DROP POLICY IF EXISTS "Public reviews are viewable by everyone" ON public.mentorship_reviews;
DROP POLICY IF EXISTS "Students can view own mentorship reviews" ON public.mentorship_reviews;
DROP POLICY IF EXISTS "Admins can view all mentorship reviews" ON public.mentorship_reviews;
CREATE POLICY "Students can view own mentorship reviews"
ON public.mentorship_reviews
FOR SELECT TO authenticated
USING (student_id = auth.uid());
CREATE POLICY "Admins can view all mentorship reviews"
ON public.mentorship_reviews
FOR SELECT TO authenticated
USING ((SELECT public.check_is_admin()));

REVOKE SELECT ON TABLE public.mentorship_reviews FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.mentorship_reviews TO authenticated;

-- Public course review projection: safe review content and optional public
-- reviewer identity, with no student ID and no private/unpublished courses.
CREATE OR REPLACE VIEW public.public_course_reviews_public_view
WITH (security_barrier = true)
AS
SELECT
  cr.id AS review_id,
  cr.course_id,
  cr.rating,
  cr.review_text,
  cr.created_at,
  CASE WHEN p.is_public IS TRUE THEN p.full_name ELSE 'Student' END AS full_name,
  CASE WHEN p.is_public IS TRUE THEN p.avatar_url ELSE NULL END AS avatar_url,
  CASE WHEN p.is_public IS TRUE THEN p.avatar_storage_key ELSE NULL END AS avatar_storage_key
FROM public.course_reviews AS cr
JOIN public.courses AS c ON c.id = cr.course_id
LEFT JOIN public.profiles AS p ON p.id = cr.student_id
WHERE c.status = 'published'::public.course_status
  AND c.deleted_at IS NULL
  AND c.is_public IS TRUE
  AND c.is_latest_published IS TRUE
  AND c.version_status = 'published'::text
  AND public.is_public_course_owner_active(c.instructor_id);

REVOKE ALL PRIVILEGES ON TABLE public.public_course_review_display
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.public_course_reviews_public_view
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.public_course_reviews_public_view TO anon, authenticated;

DROP POLICY IF EXISTS "Reviews are public" ON public.course_reviews;
DROP POLICY IF EXISTS "Students can view own course reviews" ON public.course_reviews;
DROP POLICY IF EXISTS "Instructors can view reviews for own courses" ON public.course_reviews;
DROP POLICY IF EXISTS "Admins can view all course reviews" ON public.course_reviews;
CREATE POLICY "Students can view own course reviews"
ON public.course_reviews
FOR SELECT TO authenticated
USING (student_id = auth.uid());
CREATE POLICY "Instructors can view reviews for own courses"
ON public.course_reviews
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.courses AS c
    WHERE c.id = course_reviews.course_id
      AND c.instructor_id = auth.uid()
  )
);
CREATE POLICY "Admins can view all course reviews"
ON public.course_reviews
FOR SELECT TO authenticated
USING ((SELECT public.check_is_admin()));

REVOKE SELECT ON TABLE public.course_reviews FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.course_reviews TO authenticated;

COMMIT;
