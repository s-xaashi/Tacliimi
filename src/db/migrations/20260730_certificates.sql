-- =============================================================================
-- MIGRATION: Certificates of Completion
-- =============================================================================

-- 1. Course-level toggle
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS certificate_enabled BOOLEAN NOT NULL DEFAULT false;

-- 2. certificates table — created once per (student, course), never regenerated
CREATE TABLE IF NOT EXISTS public.certificates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id           UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  verification_code   TEXT NOT NULL UNIQUE,
  quiz_score_snapshot NUMERIC(5,2) NOT NULL DEFAULT 100,
  completed_at_snapshot TIMESTAMPTZ NOT NULL,
  issued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, course_id)
);

ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;

-- Students can only read their own certificates directly (no public SELECT policy —
-- public verification goes through the verify_certificate() RPC below instead,
-- so the table itself never needs to be exposed to anon reads).
CREATE POLICY "student_read_own_certificates" ON public.certificates
  FOR SELECT
  USING (student_id = auth.uid());

-- 3. get_course_quiz_score — aggregate correctness across every quiz question
--    in the course for a given student. Reuses the same join chain as
--    course_marketplace_view (section -> lesson -> quiz).
CREATE OR REPLACE FUNCTION public.get_course_quiz_score(p_student_id UUID, p_course_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_total_questions INTEGER;
  v_correct_answers INTEGER;
BEGIN
  SELECT COUNT(qq.id) INTO v_total_questions
  FROM course_sections cs
  JOIN course_lessons cl ON cl.section_id = cs.id
  JOIN quizzes qz ON qz.lesson_id = cl.id
  JOIN quiz_questions qq ON qq.quiz_id = qz.id
  WHERE cs.course_id = p_course_id AND cl.deleted_at IS NULL;

  IF v_total_questions IS NULL OR v_total_questions = 0 THEN
    RETURN 100; -- no quizzes in this course: full marks by default
  END IF;

  SELECT COUNT(qsa.id) INTO v_correct_answers
  FROM course_sections cs
  JOIN course_lessons cl ON cl.section_id = cs.id
  JOIN quizzes qz ON qz.lesson_id = cl.id
  JOIN quiz_submissions qs ON qs.quiz_id = qz.id AND qs.student_id = p_student_id
  JOIN quiz_submission_answers qsa ON qsa.submission_id = qs.id AND qsa.is_correct = true
  WHERE cs.course_id = p_course_id AND cl.deleted_at IS NULL;

  RETURN ROUND((v_correct_answers::NUMERIC / v_total_questions::NUMERIC) * 100, 2);
END;
$$;

-- 4. generate_certificate — idempotent: creates the row only the first time,
--    otherwise returns the existing snapshot untouched (score/code stay stable).
CREATE OR REPLACE FUNCTION public.generate_certificate(p_student_id UUID, p_course_id UUID)
RETURNS public.certificates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_existing public.certificates;
  v_new      public.certificates;
  v_completed_at TIMESTAMPTZ;
  v_cert_enabled BOOLEAN;
  v_code TEXT;
  v_score NUMERIC;
BEGIN
  SELECT e.completed_at, c.certificate_enabled
    INTO v_completed_at, v_cert_enabled
  FROM enrollments e
  JOIN courses c ON c.id = e.course_id
  WHERE e.student_id = p_student_id AND e.course_id = p_course_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not enrolled in this course';
  END IF;
  IF v_completed_at IS NULL THEN
    RAISE EXCEPTION 'Course not yet completed';
  END IF;
  IF NOT v_cert_enabled THEN
    RAISE EXCEPTION 'Certificates are not enabled for this course';
  END IF;

  SELECT * INTO v_existing FROM certificates
  WHERE student_id = p_student_id AND course_id = p_course_id;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  v_score := public.get_course_quiz_score(p_student_id, p_course_id);
  v_code := 'CERT-' || upper(substr(md5(gen_random_uuid()::text), 1, 4))
            || '-' || upper(substr(md5(random()::text), 1, 4));

  INSERT INTO certificates (student_id, course_id, verification_code, quiz_score_snapshot, completed_at_snapshot)
  VALUES (p_student_id, p_course_id, v_code, v_score, v_completed_at)
  RETURNING * INTO v_new;

  RETURN v_new;
END;
$$;

-- 5. verify_certificate — public lookup by code, no table access needed.
--    Returns only what the verification page should ever show.
CREATE OR REPLACE FUNCTION public.verify_certificate(p_code TEXT)
RETURNS TABLE (
  student_name TEXT,
  course_title TEXT,
  instructor_name TEXT,
  issued_at TIMESTAMPTZ,
  completed_at_snapshot TIMESTAMPTZ,
  quiz_score_snapshot NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT p.full_name, c.title, ip.full_name, cert.issued_at, cert.completed_at_snapshot, cert.quiz_score_snapshot
  FROM certificates cert
  JOIN profiles p ON p.id = cert.student_id
  JOIN courses c ON c.id = cert.course_id
  JOIN profiles ip ON ip.id = c.instructor_id
  WHERE cert.verification_code = p_code;
$$;

GRANT EXECUTE ON FUNCTION public.get_course_quiz_score(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_certificate(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_certificate(TEXT) TO anon, authenticated;
