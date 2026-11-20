-- Public review projections must not expose internal student UUIDs.
-- Keep the fields required by the existing public review cards and ensure
-- reviews are only projected for public, active mentor/course owners.
BEGIN;

CREATE OR REPLACE VIEW public.mentor_profile_reviews_view
WITH (security_barrier = true)
AS
SELECT
  r.id,
  r.mentor_id,
  r.rating,
  r.comment,
  r.created_at,
  p.full_name,
  p.avatar_url,
  p.avatar_storage_key,
  NULL::uuid AS student_id -- retained as NULL for view-schema compatibility
FROM public.mentorship_reviews AS r
LEFT JOIN public.profiles AS p ON p.id = r.student_id
JOIN public.instructors AS i ON i.user_id = r.mentor_id
JOIN public.profiles AS mentor_profile ON mentor_profile.id = r.mentor_id
WHERE i.approval_status = 'approved'
  AND mentor_profile.role = 'instructor'::public.user_role
  AND mentor_profile.account_status = 'active';

REVOKE ALL PRIVILEGES ON TABLE public.mentor_profile_reviews_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mentor_profile_reviews_view TO anon, authenticated;

CREATE OR REPLACE VIEW public.public_course_review_display
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  cr.id AS review_id,
  cr.course_id,
  NULL::uuid AS student_id, -- retained as NULL for view-schema compatibility
  p.full_name,
  p.avatar_url,
  p.avatar_storage_key
FROM public.course_reviews AS cr
JOIN public.courses AS c ON c.id = cr.course_id
LEFT JOIN public.profiles AS p ON p.id = cr.student_id
JOIN public.instructors AS i ON i.user_id = c.instructor_id
JOIN public.profiles AS instructor_profile ON instructor_profile.id = c.instructor_id
WHERE c.status = 'published'::public.course_status
  AND c.deleted_at IS NULL
  AND c.is_public IS TRUE
  AND c.is_latest_published IS TRUE
  AND c.version_status = 'published'
  AND i.approval_status = 'approved'
  AND instructor_profile.role = 'instructor'::public.user_role
  AND instructor_profile.account_status = 'active';

REVOKE ALL PRIVILEGES ON TABLE public.public_course_review_display FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.public_course_review_display TO anon, authenticated;

-- The active boosts view contains payment IDs, amounts and cancellation contact
-- details. No current application consumer was found, so it is server-only.
REVOKE ALL PRIVILEGES ON TABLE public.active_boosts_view FROM PUBLIC, anon, authenticated;

-- The remaining mentor-stat views are public aggregate projections. Preserve
-- their existing read contract but remove unnecessary mutation/table privileges.
REVOKE ALL PRIVILEGES ON TABLE public.mentor_rating_stats FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mentor_rating_stats TO anon, authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.mentor_response_times_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mentor_response_times_view TO anon, authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.mentor_session_stats_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mentor_session_stats_view TO anon, authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.mentor_response_metrics_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mentor_response_metrics_view TO anon, authenticated;

COMMIT;
