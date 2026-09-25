-- ============================================================
-- Phase 2B: Belt-and-Suspenders Anon EXECUTE Revoke
-- Date: 2026-08-26
-- Vulnerability: None (defense-in-depth improvement)
-- Rationale: Four functions have PUBLIC/anon EXECUTE privilege via Postgres
--   default inheritance. Their bodies enforce auth.uid() IS NULL guards,
--   so no exploit is possible. However, an explicit REVOKE adds a clean
--   outer privilege gate before the function body is entered.
--
-- Pattern applied to each function:
--   1. REVOKE ALL FROM PUBLIC  (removes the =X/postgres default grant)
--   2. REVOKE ALL FROM anon    (belt-and-suspenders)
--   3. Re-GRANT EXECUTE to authenticated and service_role only
--
-- DO NOT remove or alter function bodies.
-- DO NOT change SECURITY DEFINER or search_path settings.
-- ============================================================

-- -----------------------------------------------
-- 1. create_update_offer
-- -----------------------------------------------
REVOKE ALL ON FUNCTION public.create_update_offer(uuid, uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_update_offer(uuid, uuid, uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_update_offer(uuid, uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_update_offer(uuid, uuid, uuid, boolean) TO service_role;

-- -----------------------------------------------
-- 2. get_course_quiz_score
-- -----------------------------------------------
REVOKE ALL ON FUNCTION public.get_course_quiz_score(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_course_quiz_score(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_course_quiz_score(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_quiz_score(uuid, uuid) TO service_role;

-- -----------------------------------------------
-- 3. get_instructor_courses_refined
-- -----------------------------------------------
REVOKE ALL ON FUNCTION public.get_instructor_courses_refined(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_instructor_courses_refined(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_instructor_courses_refined(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_instructor_courses_refined(uuid) TO service_role;

-- -----------------------------------------------
-- 4. get_instructor_sales_chart_data
-- -----------------------------------------------
REVOKE ALL ON FUNCTION public.get_instructor_sales_chart_data(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_instructor_sales_chart_data(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_instructor_sales_chart_data(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_instructor_sales_chart_data(uuid, text) TO service_role;
