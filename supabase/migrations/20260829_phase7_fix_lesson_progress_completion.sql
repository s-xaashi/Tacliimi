-- Migration: Fix Phase 7 Finding P7-12 (lesson_progress Self-Certification Bypass)

-- 1. Create the Authoritative RPC
CREATE OR REPLACE FUNCTION public.mark_lesson_complete(
    p_lesson_id UUID,
    p_progress_data JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
    v_course_id UUID;
    v_has_video BOOLEAN;
    v_has_quiz BOOLEAN;
    v_video_progress BOOLEAN;
    v_quiz_progress BOOLEAN;
    v_quizzes_complete BOOLEAN;
    v_final_completed BOOLEAN;
    v_student_id UUID;
BEGIN
    v_student_id := auth.uid();
    IF v_student_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: authentication required';
    END IF;

    -- Verify the lesson exists and belongs to a course the student is enrolled in
    SELECT cs.course_id, cl.video_url IS NOT NULL
    INTO v_course_id, v_has_video
    FROM course_lessons cl
    JOIN course_sections cs ON cl.section_id = cs.id
    WHERE cl.id = p_lesson_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Lesson not found';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM enrollments
        WHERE student_id = v_student_id AND course_id = v_course_id
    ) THEN
        RAISE EXCEPTION 'Not enrolled in this course';
    END IF;

    -- Evaluate Video Requirements
    IF v_has_video THEN
        -- We must trust the client's video playback event for now since there's no server telemetry
        v_video_progress := COALESCE((p_progress_data->>'video')::boolean, FALSE);
    ELSE
        v_video_progress := TRUE;
    END IF;

    -- Evaluate Quiz Requirements Authoritatively
    SELECT EXISTS (SELECT 1 FROM quizzes WHERE lesson_id = p_lesson_id) INTO v_has_quiz;

    IF v_has_quiz THEN
        -- Check if all questions in all quizzes for this lesson have a submission answer from this student
        -- If a quiz has 0 questions it is considered completed.
        SELECT COALESCE(BOOL_AND(
            (SELECT COUNT(*) FROM quiz_questions qq WHERE qq.quiz_id = q.id) =
            (SELECT COUNT(DISTINCT qsa.question_id)
             FROM quiz_submissions qs
             JOIN quiz_submission_answers qsa ON qs.id = qsa.submission_id
             WHERE qs.quiz_id = q.id AND qs.student_id = v_student_id)
        ), TRUE)
        INTO v_quizzes_complete
        FROM quizzes q
        WHERE q.lesson_id = p_lesson_id;

        v_quiz_progress := v_quizzes_complete;
    ELSE
        v_quiz_progress := TRUE;
    END IF;

    v_final_completed := v_video_progress AND v_quiz_progress;

    -- Sync back to progress_data to ensure frontend and backend agree
    p_progress_data := jsonb_build_object(
        'video', v_video_progress,
        'quiz', v_quiz_progress
    );

    -- UPSERT into lesson_progress idempotently
    INSERT INTO lesson_progress (student_id, lesson_id, completed, completed_at, progress_data)
    VALUES (
        v_student_id,
        p_lesson_id,
        v_final_completed,
        CASE WHEN v_final_completed THEN now() ELSE NULL END,
        p_progress_data
    )
    ON CONFLICT (student_id, lesson_id) DO UPDATE SET
        completed = EXCLUDED.completed,
        completed_at = CASE 
            WHEN EXCLUDED.completed AND lesson_progress.completed_at IS NULL THEN now()
            WHEN EXCLUDED.completed THEN lesson_progress.completed_at
            ELSE NULL 
        END,
        progress_data = EXCLUDED.progress_data;
END;
$$;

-- Secure the RPC grants
REVOKE EXECUTE ON FUNCTION public.mark_lesson_complete(UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_lesson_complete(UUID, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_lesson_complete(UUID, JSONB) TO authenticated;

-- 2. Restrict Direct Writes to lesson_progress
DROP POLICY IF EXISTS "students_manage_own_progress" ON public.lesson_progress;
DROP POLICY IF EXISTS "students_read_own_progress" ON public.lesson_progress;

-- Allow students to read their own progress
CREATE POLICY "students_read_own_progress" ON public.lesson_progress
FOR SELECT TO authenticated
USING (auth.uid() = student_id);

-- Explicitly, there is no INSERT, UPDATE, or DELETE policy for students anymore.
-- They must go through the SECURITY DEFINER RPC.

-- Allow service_role to manage all if needed
DROP POLICY IF EXISTS "service_role_manage_progress" ON public.lesson_progress;
CREATE POLICY "service_role_manage_progress" ON public.lesson_progress
FOR ALL TO service_role
USING (true) WITH CHECK (true);
