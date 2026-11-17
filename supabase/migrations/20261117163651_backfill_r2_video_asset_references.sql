UPDATE public.r2_multipart_upload_sessions s
SET status = 'committed',
    committed_at = COALESCE(s.completed_at, s.created_at)
WHERE s.status = 'completed'
  AND s.upload_type = 'lesson'
  AND EXISTS (
    SELECT 1
    FROM public.course_media_assets a
    JOIN public.course_lessons l ON l.media_asset_id = a.id
    WHERE a.storage_provider = 'r2'
      AND a.storage_path = s.object_key
  );
