-- Migration: Add reschedule_history JSONB column and update reschedule RPCs

ALTER TABLE public.mentorship_sessions
ADD COLUMN IF NOT EXISTS reschedule_history jsonb DEFAULT '[]'::jsonb;

-- Mentor Reschedule Session RPC
CREATE OR REPLACE FUNCTION public.mentor_reschedule_session(p_mentor_id uuid, p_session_id uuid, p_new_scheduled_at timestamp with time zone, p_new_duration_minutes integer, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_total_sessions integer;
    v_completed integer;
    v_mentorship_type text;
    v_remaining integer;
    v_new_end_date timestamptz;
    v_previous_scheduled_at timestamptz;
    v_previous_duration integer;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: not authenticated';
    END IF;

    SELECT total_sessions, completed_sessions_count, mentorship_type, scheduled_at, duration_minutes
    INTO v_total_sessions, v_completed, v_mentorship_type, v_previous_scheduled_at, v_previous_duration
    FROM public.mentorship_sessions
    WHERE id = p_session_id AND mentor_id = auth.uid();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unauthorized or session not found';
    END IF;

    IF v_mentorship_type = 'program' THEN
        v_remaining := GREATEST(v_total_sessions - v_completed, 1);
        v_new_end_date := p_new_scheduled_at + ((v_remaining - 1) || ' days')::interval;

        UPDATE public.mentorship_sessions
        SET scheduled_at = p_new_scheduled_at,
            duration_minutes = COALESCE(p_new_duration_minutes, duration_minutes),
            end_date = v_new_end_date,
            reschedule_requested_by = 'mentor',
            reschedule_note = p_note,
            reschedule_history = COALESCE(reschedule_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                'previous_scheduled_at', v_previous_scheduled_at,
                'previous_duration', v_previous_duration,
                'note', p_note,
                'requested_by', 'mentor',
                'rescheduled_at', now()
            ))
        WHERE id = p_session_id;
    ELSE
        UPDATE public.mentorship_sessions
        SET scheduled_at = p_new_scheduled_at,
            duration_minutes = COALESCE(p_new_duration_minutes, duration_minutes),
            reschedule_requested_by = 'mentor',
            reschedule_note = p_note,
            reschedule_history = COALESCE(reschedule_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                'previous_scheduled_at', v_previous_scheduled_at,
                'previous_duration', v_previous_duration,
                'note', p_note,
                'requested_by', 'mentor',
                'rescheduled_at', now()
            ))
        WHERE id = p_session_id;
    END IF;
END;
$function$;

-- Admin Reschedule Session RPC
CREATE OR REPLACE FUNCTION public.admin_reschedule_session(p_admin_id uuid, p_session_id uuid, p_new_scheduled_at timestamp with time zone, p_new_duration_minutes integer, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_is_admin boolean;
    v_total_sessions integer;
    v_completed integer;
    v_mentorship_type text;
    v_remaining integer;
    v_new_end_date timestamptz;
    v_previous_scheduled_at timestamptz;
    v_previous_duration integer;
BEGIN
    SELECT EXISTS (SELECT 1 FROM public.admin_auth WHERE id = auth.uid() AND COALESCE(is_suspended, false) = false) INTO v_is_admin;
    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'Unauthorized: not a valid admin';
    END IF;

    SELECT total_sessions, completed_sessions_count, mentorship_type, scheduled_at, duration_minutes
    INTO v_total_sessions, v_completed, v_mentorship_type, v_previous_scheduled_at, v_previous_duration
    FROM public.mentorship_sessions WHERE id = p_session_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF v_mentorship_type = 'program' THEN
        v_remaining := GREATEST(v_total_sessions - v_completed, 1);
        v_new_end_date := p_new_scheduled_at + ((v_remaining - 1) || ' days')::interval;

        UPDATE public.mentorship_sessions
        SET scheduled_at = p_new_scheduled_at,
            duration_minutes = COALESCE(p_new_duration_minutes, duration_minutes),
            end_date = v_new_end_date,
            reschedule_requested_by = 'admin',
            reschedule_note = p_note,
            reschedule_history = COALESCE(reschedule_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                'previous_scheduled_at', v_previous_scheduled_at,
                'previous_duration', v_previous_duration,
                'note', p_note,
                'requested_by', 'admin',
                'rescheduled_at', now()
            ))
        WHERE id = p_session_id;
    ELSE
        UPDATE public.mentorship_sessions
        SET scheduled_at = p_new_scheduled_at,
            duration_minutes = COALESCE(p_new_duration_minutes, duration_minutes),
            reschedule_requested_by = 'admin',
            reschedule_note = p_note,
            reschedule_history = COALESCE(reschedule_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                'previous_scheduled_at', v_previous_scheduled_at,
                'previous_duration', v_previous_duration,
                'note', p_note,
                'requested_by', 'admin',
                'rescheduled_at', now()
            ))
        WHERE id = p_session_id;
    END IF;
END;
$function$;
