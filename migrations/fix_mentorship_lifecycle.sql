-- 1. Add duration_minutes column to mentorship_sessions
ALTER TABLE public.mentorship_sessions ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 60;

-- 2. Update RLS policies for mentorship_sessions to allow deletion of cancelled sessions
-- Students can delete their own cancelled sessions
DROP POLICY IF EXISTS "Students can delete their own cancelled sessions" ON public.mentorship_sessions;
CREATE POLICY "Students can delete their own cancelled sessions"
    ON public.mentorship_sessions FOR DELETE
    USING (
        auth.uid() = student_id 
        AND (booking_status = 'cancelled' OR status = 'cancelled')
    );

-- Mentors can delete their own cancelled sessions
DROP POLICY IF EXISTS "Mentors can delete their own cancelled sessions" ON public.mentorship_sessions;
CREATE POLICY "Mentors can delete their own cancelled sessions"
    ON public.mentorship_sessions FOR DELETE
    USING (
        auth.uid() = mentor_id 
        AND (booking_status = 'cancelled' OR status = 'cancelled')
    );

-- Admins can delete any session (if not already covered by service role/admin policies)
DROP POLICY IF EXISTS "Admins can delete any session" ON public.mentorship_sessions;
CREATE POLICY "Admins can delete any session"
    ON public.mentorship_sessions FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );
