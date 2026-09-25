-- Migration: Phase 7 - Finding #2 Remediation
-- Prevents Enrollment self-certification / certificate fraud via UPDATE manipulation.
-- Adds a BEFORE UPDATE trigger that calculates the true progress on the server-side,
-- overwriting any spoofed client values while permitting the legitimate progression flow.

BEGIN;

CREATE OR REPLACE FUNCTION public.protect_enrollment_progress()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_lessons INT;
  v_completed_lessons INT;
  v_actual_progress INT;
BEGIN
  -- 1. Service_role bypasses checks (for manual admin updates or backend scripts)
  IF current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- 2. Intercept ONLY if protected completion fields are being modified
  IF NEW.progress_percentage IS DISTINCT FROM OLD.progress_percentage OR
     NEW.completed_at IS DISTINCT FROM OLD.completed_at OR
     NEW.status IS DISTINCT FROM OLD.status THEN

    -- Calculate total lessons in course
    SELECT COUNT(*) INTO v_total_lessons
    FROM course_lessons cl
    JOIN course_sections cs ON cl.section_id = cs.id
    WHERE cs.course_id = NEW.course_id;

    -- Calculate completed lessons for this student in this course
    SELECT COUNT(*) INTO v_completed_lessons
    FROM lesson_progress lp
    JOIN course_lessons cl ON lp.lesson_id = cl.id
    JOIN course_sections cs ON cl.section_id = cs.id
    WHERE cs.course_id = NEW.course_id
      AND lp.student_id = NEW.student_id
      AND lp.completed = true;

    -- Compute actual server-side progress
    IF v_total_lessons > 0 THEN
      v_actual_progress := LEAST(100, ROUND((v_completed_lessons::numeric / v_total_lessons::numeric) * 100));
    ELSE
      v_actual_progress := 100;
    END IF;

    -- Force the NEW progress to exactly match server reality
    NEW.progress_percentage := v_actual_progress;

    IF v_actual_progress = 100 THEN
      -- If they legitimately reached 100%, allow completion
      NEW.status := 'completed';
      IF OLD.completed_at IS NULL THEN
        NEW.completed_at := timezone('utc'::text, now());
      ELSE
        NEW.completed_at := OLD.completed_at; -- preserve existing
      END IF;
    ELSE
      -- If they spoofed 100%, forcefully revert/ignore the spoofing attempts
      IF NEW.status = 'completed' THEN
        NEW.status := OLD.status;
      END IF;
      -- Ensure they cannot spoof a completed_at timestamp
      NEW.completed_at := OLD.completed_at;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_enrollment_progress ON public.enrollments;
CREATE TRIGGER enforce_enrollment_progress
BEFORE UPDATE ON public.enrollments
FOR EACH ROW EXECUTE FUNCTION public.protect_enrollment_progress();

COMMIT;
