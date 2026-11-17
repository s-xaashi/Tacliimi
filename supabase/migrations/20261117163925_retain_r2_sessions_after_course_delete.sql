-- Upload session records must outlive a draft course/lesson deletion so the
-- orphan cleanup worker can still find and remove their staged R2 objects.
ALTER TABLE public.r2_multipart_upload_sessions
  DROP CONSTRAINT IF EXISTS r2_multipart_upload_sessions_course_id_fkey;

ALTER TABLE public.r2_multipart_upload_sessions
  DROP CONSTRAINT IF EXISTS r2_multipart_upload_sessions_lesson_id_fkey;

ALTER TABLE public.r2_image_upload_sessions
  DROP CONSTRAINT IF EXISTS r2_image_upload_sessions_course_id_fkey;
