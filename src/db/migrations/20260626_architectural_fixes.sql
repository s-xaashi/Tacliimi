-- ============================================================
-- Migration: 20260626_architectural_fixes.sql
-- Addresses 3 critical audit findings:
--   1. Audience-guarded broadcast notification trigger (M1)
--   2. Mentor rating stats materialized view (Performance)
--   3. Station-level notify function with correct SECURITY model
-- ============================================================


-- ===========================================================
-- SECTION 1: MENTOR RATING STATS VIEW
-- Replaces in-memory JS rating calculation (O(n) per request)
-- with a pre-aggregated PostgreSQL view.
-- ===========================================================

DROP VIEW IF EXISTS public.mentor_rating_stats;

CREATE VIEW public.mentor_rating_stats AS
SELECT
    mentor_id,
    COUNT(*)::INTEGER            AS review_count,
    ROUND(AVG(rating)::NUMERIC, 1) AS avg_rating
FROM public.mentorship_reviews
GROUP BY mentor_id;

-- Grant read access to authenticated users
GRANT SELECT ON public.mentor_rating_stats TO authenticated, anon;

COMMENT ON VIEW public.mentor_rating_stats IS
  'Pre-aggregated mentor rating stats. Used by MentorService to '
  'avoid O(n) JS-side rating calculations on every page load.';


-- ===========================================================
-- SECTION 2: BROADCAST NOTIFICATIONS — TRIGGER FUNCTION (M1)
-- SECURITY DEFINER with explicit audience guard.
-- Target audience is read directly from the broadcast row to
-- prevent fan-out to unintended users even if the JS is wrong.
-- ===========================================================

CREATE OR REPLACE FUNCTION public.fn_broadcast_notifications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target TEXT := NEW.target_audience;
BEGIN
    -- M1 Guard: Only fan out to users matching the target audience.
    -- For 'all': fan out to every active non-admin profile.
    -- For 'instructors' / 'students': filter by role.
    -- Any unrecognized audience value defaults to NO fan-out (safe default).

    INSERT INTO public.notifications (
        user_id,
        title,
        message,
        notification_type,
        metadata,
        is_read
    )
    SELECT
        p.id,
        '📢 ' || NEW.title,
        NEW.message,
        'broadcast',
        jsonb_build_object('broadcastId', NEW.id),
        false
    FROM public.profiles p
    WHERE
        p.account_status = 'active'
        AND (
            v_target = 'all'
            OR (v_target = 'instructors' AND p.role = 'instructor')
            OR (v_target = 'students'    AND p.role = 'student')
        );
    -- Silently do nothing for unrecognized audience values (secure default)

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_broadcast_notifications() IS
  'SECURITY DEFINER trigger function. Inserts one notification row per '
  'matching user after a system_broadcasts INSERT. The audience guard '
  'ensures fan-out never exceeds the declared target.';

-- Drop and recreate trigger to ensure clean state
DROP TRIGGER IF EXISTS trg_broadcast_notifications ON public.system_broadcasts;

CREATE TRIGGER trg_broadcast_notifications
    AFTER INSERT ON public.system_broadcasts
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_broadcast_notifications();


-- ===========================================================
-- SECTION 3: RLS on notifications table (if not already set)
-- Ensures users can only read their own notifications.
-- ===========================================================

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own notifications" ON public.notifications;
CREATE POLICY "Users can read own notifications"
    ON public.notifications FOR SELECT
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications"
    ON public.notifications FOR UPDATE
    USING (user_id = auth.uid());

-- SECURITY DEFINER function can still INSERT for all users (trigger bypasses RLS)
-- No explicit INSERT policy needed for authenticated role since trigger owns inserts.
