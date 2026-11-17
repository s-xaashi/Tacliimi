-- Separate staged R2 uploads from media already committed to course records.
ALTER TABLE public.r2_multipart_upload_sessions
  DROP CONSTRAINT IF EXISTS r2_multipart_upload_sessions_status_check;

ALTER TABLE public.r2_multipart_upload_sessions
  ADD CONSTRAINT r2_multipart_upload_sessions_status_check
  CHECK (status IN ('in_progress', 'completed', 'committed', 'discarding', 'aborted', 'discarded'));

ALTER TABLE public.r2_multipart_upload_sessions
  ADD COLUMN IF NOT EXISTS committed_at timestamptz;

CREATE INDEX IF NOT EXISTS r2_multipart_completed_cleanup_idx
  ON public.r2_multipart_upload_sessions (status, completed_at)
  WHERE status IN ('completed', 'in_progress');

-- Existing completed uploads that are already referenced are committed media.
UPDATE public.r2_multipart_upload_sessions s
SET status = 'committed',
    committed_at = COALESCE(s.completed_at, s.created_at)
WHERE s.status = 'completed'
  AND (
    (s.upload_type = 'intro' AND EXISTS (
      SELECT 1 FROM public.courses c WHERE c.intro_video_storage_key = s.object_key
    ))
    OR
    (s.upload_type = 'lesson' AND EXISTS (
      SELECT 1 FROM public.course_lessons l WHERE l.video_storage_key = s.object_key
    ))
  );

-- Thumbnail uploads are single PUTs, so they have their own lightweight session
-- table rather than pretending to be multipart uploads.
CREATE TABLE IF NOT EXISTS public.r2_image_upload_sessions (
  upload_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_key text NOT NULL UNIQUE,
  instructor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  upload_type text NOT NULL CHECK (upload_type = 'thumbnail'),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'committed', 'discarding', 'discarded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  committed_at timestamptz
);

CREATE INDEX IF NOT EXISTS r2_image_upload_owner_status_idx
  ON public.r2_image_upload_sessions (instructor_id, status, expires_at);

ALTER TABLE public.r2_image_upload_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.r2_image_upload_sessions FROM anon, authenticated;
GRANT ALL ON TABLE public.r2_image_upload_sessions TO service_role;

CREATE OR REPLACE FUNCTION public.commit_r2_video_upload(
  p_course_id uuid,
  p_lesson_id uuid,
  p_upload_type text,
  p_object_key text,
  p_file_size bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_instructor_id uuid;
  v_expected_prefix text;
  v_asset_id uuid;
  v_section_course_id uuid;
  v_upload_id text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Not authenticated';
  END IF;

  IF p_upload_type NOT IN ('lesson', 'intro') THEN
    RAISE EXCEPTION 'INVALID_TYPE: upload_type must be lesson or intro';
  END IF;

  SELECT instructor_id INTO v_instructor_id
  FROM courses
  WHERE id = p_course_id AND deleted_at IS NULL;

  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Course not found'; END IF;
  IF v_instructor_id <> v_user_id THEN RAISE EXCEPTION 'FORBIDDEN: You do not own this course'; END IF;

  IF p_upload_type = 'intro' THEN
    IF p_lesson_id IS NOT NULL THEN RAISE EXCEPTION 'INVALID_TARGET: Intro upload cannot include a lesson'; END IF;
    v_expected_prefix := 'courses/' || p_course_id::text || '/introduction/';
    IF p_object_key NOT LIKE v_expected_prefix || '%.mp4'
       AND p_object_key NOT LIKE v_expected_prefix || '%.mov' THEN
      RAISE EXCEPTION 'INVALID_KEY: object_key does not match expected intro pattern for this course';
    END IF;
  ELSE
    IF p_lesson_id IS NULL THEN RAISE EXCEPTION 'MISSING: lesson_id is required for lesson type'; END IF;
    SELECT cs.course_id INTO v_section_course_id
    FROM course_lessons cl
    JOIN course_sections cs ON cs.id = cl.section_id
    WHERE cl.id = p_lesson_id AND cl.deleted_at IS NULL;

    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Lesson not found'; END IF;
    IF v_section_course_id <> p_course_id THEN RAISE EXCEPTION 'FORBIDDEN: Lesson does not belong to this course'; END IF;

    v_expected_prefix := 'courses/' || p_course_id::text || '/lessons/' || p_lesson_id::text || '/video/';
    IF p_object_key NOT LIKE v_expected_prefix || '%.mp4'
       AND p_object_key NOT LIKE v_expected_prefix || '%.mov' THEN
      RAISE EXCEPTION 'INVALID_KEY: object_key does not match expected lesson pattern';
    END IF;
  END IF;

  IF p_file_size IS NULL OR p_file_size <= 0 OR p_file_size > 629145600 THEN
    RAISE EXCEPTION 'INVALID_SIZE: file_size must be between 1 and 629145600 bytes';
  END IF;

  -- Lock the exact completed staging session. This makes commit mutually exclusive
  -- with the discard endpoint, which first moves the same row to 'discarding'.
  SELECT upload_id INTO v_upload_id
  FROM r2_multipart_upload_sessions
  WHERE course_id = p_course_id
    AND instructor_id = v_user_id
    AND upload_type = p_upload_type
    AND object_key = p_object_key
    AND file_size_bytes = p_file_size
    AND status = 'completed'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'STAGED_UPLOAD_NOT_FOUND: This upload is not complete or is no longer available to commit';
  END IF;

  IF p_upload_type = 'lesson' THEN
    INSERT INTO course_media_assets (storage_provider, storage_path, file_size_bytes)
    VALUES ('r2', p_object_key, p_file_size)
    RETURNING id INTO v_asset_id;

    UPDATE course_lessons
    SET video_provider = 'r2',
        video_storage_key = p_object_key,
        media_asset_id = v_asset_id
    WHERE id = p_lesson_id;
  ELSE
    UPDATE courses
    SET intro_video_provider = 'r2',
        intro_video_storage_key = p_object_key
    WHERE id = p_course_id;
  END IF;

  UPDATE r2_multipart_upload_sessions
  SET status = 'committed', committed_at = now()
  WHERE upload_id = v_upload_id AND status = 'completed';

  RETURN jsonb_build_object('success', true, 'asset_id', v_asset_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_r2_intro_upload_committed(
  p_course_id uuid,
  p_upload_id text,
  p_object_key text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_session_id text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED: Not authenticated'; END IF;

  PERFORM 1 FROM courses
  WHERE id = p_course_id
    AND instructor_id = v_user_id
    AND intro_video_provider = 'r2'
    AND intro_video_storage_key = p_object_key
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COURSE_MEDIA_MISMATCH: Course does not reference this introduction upload'; END IF;

  SELECT upload_id INTO v_session_id
  FROM r2_multipart_upload_sessions
  WHERE upload_id = p_upload_id
    AND course_id = p_course_id
    AND instructor_id = v_user_id
    AND upload_type = 'intro'
    AND object_key = p_object_key
    AND status IN ('completed', 'committed')
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STAGED_UPLOAD_NOT_FOUND: Introduction upload session not found'; END IF;

  UPDATE r2_multipart_upload_sessions
  SET status = 'committed', committed_at = COALESCE(committed_at, now())
  WHERE upload_id = v_session_id;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_r2_thumbnail_upload_committed(
  p_course_id uuid,
  p_upload_id uuid,
  p_object_key text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED: Not authenticated'; END IF;

  PERFORM 1 FROM courses
  WHERE id = p_course_id
    AND instructor_id = v_user_id
    AND thumbnail_storage_key = p_object_key
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COURSE_MEDIA_MISMATCH: Course does not reference this thumbnail upload'; END IF;

  UPDATE r2_image_upload_sessions
  SET status = 'committed', committed_at = COALESCE(committed_at, now())
  WHERE upload_id = p_upload_id
    AND course_id = p_course_id
    AND instructor_id = v_user_id
    AND object_key = p_object_key
    AND status IN ('completed', 'committed');

  IF NOT FOUND THEN RAISE EXCEPTION 'STAGED_UPLOAD_NOT_FOUND: Thumbnail upload session not found'; END IF;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.commit_r2_video_upload(uuid, uuid, text, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_r2_video_upload(uuid, uuid, text, text, bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_r2_intro_upload_committed(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_r2_intro_upload_committed(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_r2_thumbnail_upload_committed(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_r2_thumbnail_upload_committed(uuid, uuid, text) TO authenticated;
