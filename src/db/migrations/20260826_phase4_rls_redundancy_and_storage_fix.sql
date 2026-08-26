-- ============================================================
-- Phase 4: RLS Remediation — Direct API and Storage Validation
-- Date: 2026-08-26
-- Project: Tacliimi
-- ============================================================

-- ============================================================
-- 1. admin_audit_logs — Deny arbitrary client INSERT
-- ============================================================
DROP POLICY IF EXISTS "Anyone authenticated can insert audit logs" ON public.admin_audit_logs;
CREATE POLICY "Anyone authenticated can insert audit logs"
  ON public.admin_audit_logs
  AS RESTRICTIVE
  FOR INSERT
  TO public
  WITH CHECK (false);

-- ============================================================
-- 2. mentorship_sessions — Replace permissive UPDATE without WITH CHECK
-- ============================================================
DROP POLICY IF EXISTS "Users can update their sessions" ON public.mentorship_sessions;
CREATE POLICY "Users can update their sessions"
  ON public.mentorship_sessions
  FOR UPDATE
  TO public
  USING (auth.uid() = student_id OR auth.uid() = mentor_id)
  WITH CHECK (auth.uid() = student_id OR auth.uid() = mentor_id);

-- ============================================================
-- 3. courses — Drop redundant/vulnerable permissive UPDATE policies
-- (Instructors can update their courses has WITH CHECK and covers this properly)
-- ============================================================
DROP POLICY IF EXISTS "Instructors can update own courses" ON public.courses;
DROP POLICY IF EXISTS "Admins can update all courses" ON public.courses;

CREATE POLICY "Admins can update all courses"
  ON public.courses
  FOR UPDATE
  TO public
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- ============================================================
-- 4. course_sections & course_lessons — Drop redundant permissive ALL/UPDATE policies
-- The new restrictive owner policies (sections_owner_access, lessons_owner_access) 
-- remain and provide the correct guarantees.
-- ============================================================
DROP POLICY IF EXISTS "Instructors can view/edit own sections" ON public.course_sections;
DROP POLICY IF EXISTS "Instructors can update course sections" ON public.course_sections;

DROP POLICY IF EXISTS "Instructors can view/edit own lessons" ON public.course_lessons;
DROP POLICY IF EXISTS "Instructors can update course lessons" ON public.course_lessons;

-- ============================================================
-- 5. Storage / objects — Drop loose generic authenticated policies
-- and ensure course_thumbnails, course_resources, course_videos, intro_videos
-- bind the storage.foldername(name)[1] to auth.uid().
-- ============================================================
DROP POLICY IF EXISTS "Auth Uploads course_thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Auth Update course_thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Auth Uploads course_resources" ON storage.objects;
DROP POLICY IF EXISTS "Auth Update course_resources" ON storage.objects;
DROP POLICY IF EXISTS "Auth Uploads course_videos" ON storage.objects;
DROP POLICY IF EXISTS "Auth Update course_videos" ON storage.objects;
DROP POLICY IF EXISTS "Auth Uploads intro_videos" ON storage.objects;
DROP POLICY IF EXISTS "Auth Update intro_videos" ON storage.objects;

-- Re-create safe versions ensuring identity matching:
CREATE POLICY "Auth Uploads course_thumbnails safe"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'course_thumbnails' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "Auth Update course_thumbnails safe"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'course_thumbnails' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'course_thumbnails' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "Auth Uploads course_resources safe"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'course_resources' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "Auth Update course_resources safe"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'course_resources' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'course_resources' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "Auth Uploads course_videos safe"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'course_videos' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "Auth Update course_videos safe"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'course_videos' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'course_videos' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "Auth Uploads intro_videos safe"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'intro_videos' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "Auth Update intro_videos safe"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'intro_videos' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'intro_videos' AND (auth.uid())::text = (storage.foldername(name))[1]);
