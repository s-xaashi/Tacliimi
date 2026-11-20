-- Admin course statistics are consumed only by the admin course-review page.
-- Make the view execute with caller privileges and require a trusted active admin.
BEGIN;

CREATE OR REPLACE VIEW public.admin_course_stats
WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  family_data.family_id,
  sum(family_data.enrollments_count) AS enrollments_count,
  sum(family_data.total_revenue) AS total_revenue
FROM (
  SELECT
    COALESCE(c.root_course_id, c.id) AS family_id,
    (
      SELECT count(DISTINCT e.id)
      FROM public.enrollments AS e
      WHERE e.course_id = c.id
    ) AS enrollments_count,
    (
      SELECT COALESCE(sum(p.amount), 0::numeric)
      FROM public.payments AS p
      WHERE p.course_id = c.id
        AND p.payment_status = 'paid'::public.payment_status_type
    ) AS total_revenue
  FROM public.courses AS c
) AS family_data
WHERE public.check_is_admin()
GROUP BY family_data.family_id;

REVOKE ALL PRIVILEGES ON TABLE public.admin_course_stats FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.admin_course_stats TO authenticated;

COMMIT;
