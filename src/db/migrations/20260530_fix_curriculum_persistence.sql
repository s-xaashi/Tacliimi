-- ========================================================
-- Migration: Production-Grade Curriculum Persistence
-- Location: src/db/migrations/20260530_fix_curriculum_persistence.sql
-- ========================================================

-- 1. Ensure RLS is enabled on all relevant tables
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_lessons ENABLE ROW LEVEL SECURITY;

-- 2. Validate/Create RLS Policies for COURSES
-- Only the instructor can modify their own course
DROP POLICY IF EXISTS "Instructors can modify their own courses" ON public.courses;
CREATE POLICY "Instructors can modify their own courses"
    ON public.courses
    FOR ALL
    USING (auth.uid() = instructor_id)
    WITH CHECK (auth.uid() = instructor_id);

-- 3. Validate/Create RLS Policies for COURSE_SECTIONS
-- Sections are tied to course ownership
DROP POLICY IF EXISTS "Instructors can manage their course sections" ON public.course_sections;
CREATE POLICY "Instructors can manage their course sections"
    ON public.course_sections
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.courses
            WHERE id = course_sections.course_id
            AND instructor_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.courses
            WHERE id = course_sections.course_id
            AND instructor_id = auth.uid()
        )
    );

-- 4. Validate/Create RLS Policies for COURSE_LESSONS
-- Lessons are tied to section which is tied to course ownership
DROP POLICY IF EXISTS "Instructors can manage their course lessons" ON public.course_lessons;
CREATE POLICY "Instructors can manage their course lessons"
    ON public.course_lessons
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.course_sections
            JOIN public.courses ON course_sections.course_id = courses.id
            WHERE course_sections.id = course_lessons.section_id
            AND courses.instructor_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.course_sections
            JOIN public.courses ON course_sections.course_id = courses.id
            WHERE course_sections.id = course_lessons.section_id
            AND courses.instructor_id = auth.uid()
        )
    );

-- 5. Create the Atomic Curriculum Sync RPC
CREATE OR REPLACE FUNCTION public.sync_course_curriculum(
    p_course_id UUID,
    p_curriculum JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- Required to perform the atomic sync despite child-table RLS
SET search_path = '' -- Harden SECURITY DEFINER against search_path hijacking
AS $$
DECLARE
    v_instructor_id UUID;
    v_section_item JSONB;
    v_lesson_item JSONB;
    v_section_id UUID;
    v_lesson_id UUID;
    v_processed_section_ids UUID[] := '{}';
    v_processed_lesson_ids UUID[] := '{}';
    v_sections_count INT := 0;
    v_lessons_count INT := 0;
BEGIN
    -- A. Ownership Verification
    SELECT instructor_id INTO v_instructor_id FROM public.courses WHERE id = p_course_id;
    IF v_instructor_id IS NULL THEN
        RAISE EXCEPTION 'Course not found' USING ERRCODE = 'P0002';
    END IF;
    
    IF v_instructor_id != auth.uid() THEN
        RAISE EXCEPTION 'Unauthorized: You do not own this course' USING ERRCODE = '42501';
    END IF;

    -- B. Concurrency Lock (Row-level lock on course)
    PERFORM 1 FROM public.courses WHERE id = p_course_id FOR UPDATE;

    -- C. Sync Sections and Lessons
    FOR v_section_item IN SELECT * FROM jsonb_array_elements(p_curriculum)
    LOOP
        -- Upsert Section
        INSERT INTO public.course_sections (
            id, 
            course_id, 
            title, 
            order_index
        )
        VALUES (
            COALESCE((v_section_item->>'id')::UUID, extensions.gen_random_uuid()),
            p_course_id,
            v_section_item->>'title',
            COALESCE((v_section_item->>'order_index')::INT, v_sections_count)
        )
        ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            order_index = EXCLUDED.order_index
        RETURNING id INTO v_section_id;

        v_processed_section_ids := array_append(v_processed_section_ids, v_section_id);
        v_sections_count := v_sections_count + 1;

        -- D. Sync Lessons within Section
        IF v_section_item ? 'course_lessons' AND jsonb_typeof(v_section_item->'course_lessons') = 'array' THEN
            FOR v_lesson_item IN SELECT * FROM jsonb_array_elements(v_section_item->'course_lessons')
            LOOP
                -- Upsert Lesson
                INSERT INTO public.course_lessons (
                    id,
                    section_id,
                    title,
                    video_url,
                    is_preview,
                    order_index
                )
                VALUES (
                    COALESCE((v_lesson_item->>'id')::UUID, gen_random_uuid()),
                    v_section_id,
                    v_lesson_item->>'title',
                    COALESCE(v_lesson_item->>'video_url', ''),
                    COALESCE((v_lesson_item->>'is_preview')::BOOLEAN, false),
                    COALESCE((v_lesson_item->>'order_index')::INT, v_lessons_count)
                )
                ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title,
                    video_url = EXCLUDED.video_url,
                    is_preview = EXCLUDED.is_preview,
                    order_index = EXCLUDED.order_index
                RETURNING id INTO v_lesson_id;

                v_processed_lesson_ids := array_append(v_processed_lesson_ids, v_lesson_id);
                v_lessons_count := v_lessons_count + 1;
            END LOOP;
        END IF;
    END LOOP;

    -- E. Cleanup Removed Items (Staged Replacement)
    -- Remove lessons that are no longer in the curriculum but belong to this course's sections
    DELETE FROM public.course_lessons
    WHERE section_id IN (SELECT id FROM public.course_sections WHERE course_id = p_course_id)
      AND id != ALL(v_processed_lesson_ids);

    -- Remove sections that are no longer in the curriculum
    DELETE FROM public.course_sections
    WHERE course_id = p_course_id
      AND id != ALL(v_processed_section_ids);

    -- F. Return Structured Result
    RETURN jsonb_build_object(
        'success', true,
        'sections_synced', v_sections_count,
        'lessons_synced', v_lessons_count
    );
EXCEPTION 
    WHEN OTHERS THEN
        -- PostgreSQL functions inside a transaction will automatically rollback on EXCEPTION
        RAISE EXCEPTION 'Failed to sync curriculum: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_course_curriculum(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_course_curriculum(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.sync_course_curriculum(uuid, jsonb) TO authenticated;

-- 6. Ensure Storage Buckets exist
-- Note: inserting into storage.buckets if they don't exist
INSERT INTO storage.buckets (id, name, public)
VALUES 
    ('course_thumbnails', 'course_thumbnails', true),
    ('intro_videos', 'intro_videos', true),
    ('course_videos', 'course_videos', true),
    ('course_resources', 'course_resources', true)
ON CONFLICT (id) DO NOTHING;

-- 7. Storage Policies for course_thumbnails
DROP POLICY IF EXISTS "Public View Course Thumbnails" ON storage.objects;
CREATE POLICY "Public View Course Thumbnails" ON storage.objects
    FOR SELECT TO public USING (bucket_id = 'course_thumbnails');

DROP POLICY IF EXISTS "Instructors can upload course thumbnails" ON storage.objects;
CREATE POLICY "Instructors can upload course thumbnails" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (bucket_id = 'course_thumbnails');

-- 8. Storage Policies for intro_videos
DROP POLICY IF EXISTS "Public View Intro Videos" ON storage.objects;
CREATE POLICY "Public View Intro Videos" ON storage.objects
    FOR SELECT TO public USING (bucket_id = 'intro_videos');

DROP POLICY IF EXISTS "Instructors can upload intro videos" ON storage.objects;
CREATE POLICY "Instructors can upload intro videos" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (bucket_id = 'intro_videos');

-- 9. Storage Policies for course_videos
DROP POLICY IF EXISTS "Public View Course Videos" ON storage.objects;
CREATE POLICY "Public View Course Videos" ON storage.objects
    FOR SELECT TO public USING (bucket_id = 'course_videos');

DROP POLICY IF EXISTS "Instructors can upload course videos" ON storage.objects;
CREATE POLICY "Instructors can upload course videos" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (bucket_id = 'course_videos');

-- 10. Storage Policies for course_resources
DROP POLICY IF EXISTS "Public View Course Resources" ON storage.objects;
CREATE POLICY "Public View Course Resources" ON storage.objects
    FOR SELECT TO public USING (bucket_id = 'course_resources');

DROP POLICY IF EXISTS "Instructors can upload course resources" ON storage.objects;
CREATE POLICY "Instructors can upload course resources" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (bucket_id = 'course_resources');
