-- Allow instructors to withdraw their own pending course submissions safely.
-- Course workflow fields are protected by trg_protect_course_state, so this must
-- run through a trusted SECURITY DEFINER RPC rather than a direct client update.
CREATE OR REPLACE FUNCTION public.withdraw_course_review(p_course_id UUID)
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

    IF v_status <> 'pending_review' THEN
        RAISE EXCEPTION 'Only courses pending review can be withdrawn (current status: %)', v_status;
    END IF;

    -- Required by protect_course_state_fields() for trusted workflow transitions.
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

REVOKE ALL ON FUNCTION public.withdraw_course_review(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.withdraw_course_review(UUID) TO authenticated;
