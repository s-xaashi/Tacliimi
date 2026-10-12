-- Let an instructor acknowledge their own rejection and return the course to draft.
-- Use a trusted SECURITY DEFINER workflow because course state is protected by
-- trg_protect_course_state; do not weaken the trigger or allow direct client updates.
CREATE OR REPLACE FUNCTION public.confirm_course_rejection(p_course_id UUID)
RETURNS public.courses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
    v_instructor_id UUID;
    v_status TEXT;
    v_course public.courses%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: authentication required';
    END IF;

    SELECT instructor_id, status
      INTO v_instructor_id, v_status
      FROM public.courses
     WHERE id = p_course_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Course not found';
    END IF;

    IF v_instructor_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Forbidden: you do not own this course';
    END IF;

    IF v_status <> 'rejected' THEN
        RAISE EXCEPTION 'Only rejected courses can be acknowledged (current status: %)', v_status;
    END IF;

    PERFORM set_config('app.trusted_internal_call', 'true', true);

    UPDATE public.courses
       SET status = 'draft',
           version_status = 'draft',
           updated_at = NOW()
     WHERE id = p_course_id
     RETURNING * INTO v_course;

    PERFORM set_config('app.trusted_internal_call', 'false', true);

    RETURN v_course;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_course_rejection(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_course_rejection(UUID) TO authenticated;
