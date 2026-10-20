-- Improve the query paths used by course curriculum saves and ownership RLS policies.
-- These columns are repeatedly filtered/joined during lesson, resource, quiz and media
-- persistence. Existing production schema inspection showed only primary-key indexes
-- on these tables; this migration does not change data, policies, or authorization.
CREATE INDEX IF NOT EXISTS idx_course_sections_course_id
    ON public.course_sections (course_id);

CREATE INDEX IF NOT EXISTS idx_course_lessons_section_id
    ON public.course_lessons (section_id);

CREATE INDEX IF NOT EXISTS idx_course_lessons_media_asset_id
    ON public.course_lessons (media_asset_id);

CREATE INDEX IF NOT EXISTS idx_course_media_assets_public_url
    ON public.course_media_assets (public_url);

CREATE INDEX IF NOT EXISTS idx_lesson_resources_lesson_id
    ON public.lesson_resources (lesson_id);

CREATE INDEX IF NOT EXISTS idx_quizzes_lesson_id
    ON public.quizzes (lesson_id);

CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz_id
    ON public.quiz_questions (quiz_id);

CREATE INDEX IF NOT EXISTS idx_quiz_options_question_id
    ON public.quiz_options (question_id);
