-- ========================================================
-- REQUIRED: Run this in Supabase SQL Editor ONCE
-- This fixes RLS policies so instructors can save sections & lessons
-- ========================================================

-- 1. Enable RLS
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_lessons ENABLE ROW LEVEL SECURITY;

-- 2. Courses: Instructors manage their own
DROP POLICY IF EXISTS "Instructors can read all courses" ON public.courses;
CREATE POLICY "Instructors can read all courses"
    ON public.courses FOR SELECT
    USING (true); -- Public read

DROP POLICY IF EXISTS "Instructors can create courses" ON public.courses;
CREATE POLICY "Instructors can create courses"
    ON public.courses FOR INSERT
    WITH CHECK (auth.uid() = instructor_id);

DROP POLICY IF EXISTS "Instructors can update their courses" ON public.courses;
CREATE POLICY "Instructors can update their courses"
    ON public.courses FOR UPDATE
    USING (auth.uid() = instructor_id)
    WITH CHECK (auth.uid() = instructor_id);

DROP POLICY IF EXISTS "Instructors can delete their courses" ON public.courses;
CREATE POLICY "Instructors can delete their courses"
    ON public.courses FOR DELETE
    USING (auth.uid() = instructor_id);

-- 3. Course Sections: Scoped by course ownership
DROP POLICY IF EXISTS "Instructors can read their course sections" ON public.course_sections;
CREATE POLICY "Instructors can read their course sections"
    ON public.course_sections FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.courses
            WHERE id = course_sections.course_id
            AND instructor_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Instructors can insert course sections" ON public.course_sections;
CREATE POLICY "Instructors can insert course sections"
    ON public.course_sections FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.courses
            WHERE id = course_sections.course_id
            AND instructor_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Instructors can update course sections" ON public.course_sections;
CREATE POLICY "Instructors can update course sections"
    ON public.course_sections FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.courses
            WHERE id = course_sections.course_id
            AND instructor_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Instructors can delete course sections" ON public.course_sections;
CREATE POLICY "Instructors can delete course sections"
    ON public.course_sections FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.courses
            WHERE id = course_sections.course_id
            AND instructor_id = auth.uid()
        )
    );

-- 4. Course Lessons: Scoped via section -> course ownership
DROP POLICY IF EXISTS "Instructors can read course lessons" ON public.course_lessons;
CREATE POLICY "Instructors can read course lessons"
    ON public.course_lessons FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.course_sections
            JOIN public.courses ON course_sections.course_id = courses.id
            WHERE course_sections.id = course_lessons.section_id
            AND courses.instructor_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Instructors can insert course lessons" ON public.course_lessons;
CREATE POLICY "Instructors can insert course lessons"
    ON public.course_lessons FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.course_sections
            JOIN public.courses ON course_sections.course_id = courses.id
            WHERE course_sections.id = course_lessons.section_id
            AND courses.instructor_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Instructors can update course lessons" ON public.course_lessons;
CREATE POLICY "Instructors can update course lessons"
    ON public.course_lessons FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.course_sections
            JOIN public.courses ON course_sections.course_id = courses.id
            WHERE course_sections.id = course_lessons.section_id
            AND courses.instructor_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Instructors can delete course lessons" ON public.course_lessons;
CREATE POLICY "Instructors can delete course lessons"
    ON public.course_lessons FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.course_sections
            JOIN public.courses ON course_sections.course_id = courses.id
            WHERE course_sections.id = course_lessons.section_id
            AND courses.instructor_id = auth.uid()
        )
    );

-- 5. Storage Buckets
INSERT INTO storage.buckets (id, name, public)
VALUES 
    ('course_thumbnails', 'course_thumbnails', true),
    ('intro_videos', 'intro_videos', true),
    ('course_videos', 'course_videos', true),
    ('course_resources', 'course_resources', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Instructors upload thumbnails" ON storage.objects;
CREATE POLICY "Instructors upload thumbnails" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (bucket_id = 'course_thumbnails');

DROP POLICY IF EXISTS "Instructors upload intro videos" ON storage.objects;
CREATE POLICY "Instructors upload intro videos" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (bucket_id = 'intro_videos');

DROP POLICY IF EXISTS "Instructors upload lesson videos" ON storage.objects;
CREATE POLICY "Instructors upload lesson videos" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (bucket_id = 'course_videos');

DROP POLICY IF EXISTS "Instructors upload resources" ON storage.objects;
CREATE POLICY "Instructors upload resources" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (bucket_id = 'course_resources');

DROP POLICY IF EXISTS "Public read storage objects" ON storage.objects;
CREATE POLICY "Public read storage objects" ON storage.objects
    FOR SELECT TO public USING (
        bucket_id IN ('course_thumbnails', 'intro_videos', 'course_videos', 'course_resources')
    );
