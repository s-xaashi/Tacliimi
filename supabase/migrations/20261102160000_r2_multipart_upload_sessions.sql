-- Bind every R2 multipart upload ID to its authenticated owner and exact target.
CREATE TABLE IF NOT EXISTS public.r2_multipart_upload_sessions (
  upload_id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  instructor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  lesson_id UUID REFERENCES public.course_lessons(id) ON DELETE SET NULL,
  upload_type TEXT NOT NULL CHECK (upload_type IN ('lesson', 'intro')),
  content_type TEXT NOT NULL CHECK (content_type IN ('video/mp4', 'video/quicktime')),
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 5368709120),
  part_size_bytes INTEGER NOT NULL CHECK (part_size_bytes >= 5242880),
  part_count INTEGER NOT NULL CHECK (part_count BETWEEN 1 AND 10000),
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'aborted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  CONSTRAINT r2_multipart_target_consistency CHECK (
    (upload_type = 'intro' AND lesson_id IS NULL) OR
    (upload_type = 'lesson' AND lesson_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS r2_multipart_upload_owner_status_idx
  ON public.r2_multipart_upload_sessions (instructor_id, status, expires_at);
ALTER TABLE public.r2_multipart_upload_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.r2_multipart_upload_sessions FROM anon, authenticated;
GRANT ALL ON TABLE public.r2_multipart_upload_sessions TO service_role;
