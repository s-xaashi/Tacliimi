-- ============================================================
-- Phase 3: HIGH-3 Remediation (Storage Object Restrictions)
-- Date: 2026-08-26
-- Project: jboruccxbgdqntrggslz (Tacliimi)
-- ============================================================
-- Adds file_size_limit and allowed_mime_types to unconstrained public buckets.
-- Mitigates storage exhaustion and XSS (via SVG/HTML direct links).
-- ============================================================

UPDATE storage.buckets SET 
  file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/gif']
WHERE name = 'avatars';

UPDATE storage.buckets SET 
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
WHERE name = 'course_thumbnails';

UPDATE storage.buckets SET 
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain','application/zip','image/jpeg','image/png']
WHERE name = 'course_resources';

UPDATE storage.buckets SET 
  file_size_limit = 524288000,
  allowed_mime_types = ARRAY['video/mp4','video/webm','video/ogg','video/quicktime']
WHERE name = 'course_videos';

UPDATE storage.buckets SET 
  file_size_limit = 524288000,
  allowed_mime_types = ARRAY['video/mp4','video/webm','video/ogg','video/quicktime']
WHERE name = 'intro_videos';
