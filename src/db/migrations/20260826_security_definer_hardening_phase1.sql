-- ====================================================================
-- PHASE 1: SECURITY DEFINER HARDENING
-- Target: public.get_course_details_admin(uuid)
-- Vulnerability: IDOR / Privilege Escalation (no authorization checks)
-- ====================================================================

-- 1. Create or replace the function with identical logic but an added authorization check.
CREATE OR REPLACE FUNCTION public.get_course_details_admin(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_course_data jsonb;
BEGIN
    -- [SECURITY ENFORCEMENT]: Admin authorization check
    IF NOT EXISTS (
        SELECT 1
        FROM public.admin_auth
        WHERE id = auth.uid()
          AND COALESCE(is_suspended, false) = false
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Not a valid admin';
    END IF;

    -- [EXISTING LOGIC PRESERVED]: Fetch all course details
    SELECT 
        jsonb_build_object(
            'id', c.id,
            'title', c.title,
            'subtitle', c.subtitle,
            'description', c.description,
            'thumbnail_url', c.thumbnail_url,
            'price', c.price,
            'price_type', c.price_type,
            'currency', c.currency,
            'status', c.status,
            'is_public', c.is_public,
            'intro_video_url', c.intro_video_url,
            'created_at', c.created_at,
            'updated_at', c.updated_at,
            'category_id', c.category_id,
            'level', c.level,
            'instructor', jsonb_build_object(
                'id', p.id,
                'full_name', p.full_name,
                'email', p.email,
                'avatar_url', p.avatar_url,
                'phone', p.phone_number
            ),
            'category', jsonb_build_object('name', cat.name),
            'sections', (
                SELECT COALESCE(jsonb_agg(
                    jsonb_build_object(
                        'id', s.id,
                        'title', s.title,
                        'order_index', s.order_index,
                        'lessons', (
                            SELECT COALESCE(jsonb_agg(
                                jsonb_build_object(
                                    'id', l.id,
                                    'title', l.title,
                                    'video_url', l.video_url,
                                    'content_type', l.content_type,
                                    'description', l.description,
                                    'order_index', l.order_index,
                                    'lesson_resources', (
                                        SELECT COALESCE(jsonb_agg(lr.*), '[]'::jsonb)
                                        FROM lesson_resources lr
                                        WHERE lr.lesson_id = l.id
                                    ),
                                    'quizzes', (
                                        SELECT COALESCE(jsonb_agg(
                                            jsonb_build_object(
                                                'id', q.id,
                                                'title', q.title,
                                                'description', q.description,
                                                'passing_score_percentage', q.passing_score_percentage,
                                                'questions', (
                                                    SELECT COALESCE(jsonb_agg(
                                                        jsonb_build_object(
                                                            'id', qq.id,
                                                            'question_text', qq.question_text,
                                                            'order_index', qq.order_index,
                                                            'options', (
                                                                SELECT COALESCE(jsonb_agg(qo.*), '[]'::jsonb)
                                                                FROM quiz_options qo
                                                                WHERE qo.question_id = qq.id
                                                            )
                                                        )
                                                    ), '[]'::jsonb)
                                                    FROM quiz_questions qq
                                                    WHERE qq.quiz_id = q.id
                                                )
                                            )
                                        ), '[]'::jsonb)
                                        FROM quizzes q
                                        WHERE q.lesson_id = l.id
                                    )
                                )
                            ), '[]'::jsonb)
                            FROM course_lessons l
                            WHERE l.section_id = s.id
                        )
                    )
                ), '[]'::jsonb)
                FROM course_sections s
                WHERE s.course_id = c.id
            ),
            'moderation_history', (
                SELECT COALESCE(jsonb_agg(h.* ORDER BY h.created_at DESC), '[]'::jsonb)
                FROM course_moderation_logs h
                WHERE h.course_id = c.id
            )
        ) INTO v_course_data
    FROM courses c
    LEFT JOIN profiles p ON c.instructor_id = p.id
    LEFT JOIN course_categories cat ON c.category_id = cat.id
    WHERE c.id = p_course_id;

    RETURN v_course_data;
END;
$function$;

-- 2. Secure Grants
REVOKE ALL ON FUNCTION public.get_course_details_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_course_details_admin(uuid) FROM anon;

-- Note: 'authenticated' must have EXECUTE since the Frontend authenticates admins via standard JWTs.
-- The authorization guard inside the function is the definitive check.
GRANT EXECUTE ON FUNCTION public.get_course_details_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_details_admin(uuid) TO service_role;
