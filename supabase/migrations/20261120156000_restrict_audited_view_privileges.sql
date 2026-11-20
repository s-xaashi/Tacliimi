-- Views are read projections, not write surfaces. Remove inherited/default
-- DML grants from every audited view and expose only the views consumed by the
-- public marketplace/profile/course UI. The active_boosts_view has no current
-- frontend consumer and contains payment IDs and cancellation contact data.
BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public.course_marketplace_view
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.course_marketplace_view TO anon, authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.admin_course_stats
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.admin_course_stats TO authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.mentor_profile_reviews_view
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mentor_profile_reviews_view TO anon, authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.active_boosts_view
  FROM PUBLIC, anon, authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.mentor_rating_stats
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mentor_rating_stats TO anon, authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.mentor_response_times_view
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mentor_response_times_view TO anon, authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.mentor_session_stats_view
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mentor_session_stats_view TO anon, authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.mentor_response_metrics_view
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mentor_response_metrics_view TO anon, authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.public_course_review_display
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.public_course_review_display TO anon, authenticated;

ALTER VIEW public.mentor_profile_reviews_view SET (security_barrier = true);
ALTER VIEW public.mentor_rating_stats SET (security_barrier = true);
ALTER VIEW public.mentor_response_times_view SET (security_barrier = true);
ALTER VIEW public.mentor_session_stats_view SET (security_barrier = true);
ALTER VIEW public.mentor_response_metrics_view SET (security_barrier = true);
ALTER VIEW public.public_course_review_display SET (security_barrier = true);

COMMIT;
