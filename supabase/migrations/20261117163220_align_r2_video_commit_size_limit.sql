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
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED: Not authenticated'; END IF;
  IF p_upload_type NOT IN ('lesson', 'intro') THEN RAISE EXCEPTION 'INVALID_TYPE: upload_type must be lesson or intro'; END IF;

  SELECT instructor_id INTO v_instructor_id FROM courses
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
    FROM course_lessons cl JOIN course_sections cs ON cs.id = cl.section_id
    WHERE cl.id = p_lesson_id AND cl.deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Lesson not found'; END IF;
    IF v_section_course_id <> p_course_id THEN RAISE EXCEPTION 'FORBIDDEN: Lesson does not belong to this course'; END IF;
    v_expected_prefix := 'courses/' || p_course_id::text || '/lessons/' || p_lesson_id::text || '/video/';
    IF p_object_key NOT LIKE v_expected_prefix || '%.mp4'
       AND p_object_key NOT LIKE v_expected_prefix || '%.mov' THEN
      RAISE EXCEPTION 'INVALID_KEY: object_key does not match expected lesson pattern';
    END IF;
  END IF;

  IF p_file_size IS NULL OR p_file_size <= 0 OR p_file_size > 5368709120 THEN
    RAISE EXCEPTION 'INVALID_SIZE: file_size must be between 1 and 5368709120 bytes';
  END IF;

  SELECT upload_id INTO v_upload_id
  FROM r2_multipart_upload_sessions
  WHERE course_id = p_course_id AND instructor_id = v_user_id
    AND upload_type = p_upload_type AND object_key = p_object_key
    AND file_size_bytes = p_file_size AND status = 'completed'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STAGED_UPLOAD_NOT_FOUND: This upload is not complete or is no longer available to commit';
  END IF;

  IF p_upload_type = 'lesson' THEN
    INSERT INTO course_media_assets (storage_provider, storage_path, file_size_bytes)
    VALUES ('r2', p_object_key, p_file_size)
    RETURNING id INTO v_asset_id;
    UPDATE course_lessons
    SET video_provider = 'r2', video_storage_key = p_object_key, media_asset_id = v_asset_id
    WHERE id = p_lesson_id;
  ELSE
    UPDATE courses
    SET intro_video_provider = 'r2', intro_video_storage_key = p_object_key
    WHERE id = p_course_id;
  END IF;

  UPDATE r2_multipart_upload_sessions
  SET status = 'committed', committed_at = now()
  WHERE upload_id = v_upload_id AND status = 'completed';

  RETURN jsonb_build_object('success', true, 'asset_id', v_asset_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.commit_r2_video_upload(uuid, uuid, text, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_r2_video_upload(uuid, uuid, text, text, bigint) TO authenticated;
