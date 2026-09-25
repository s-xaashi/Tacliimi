-- Migration: Add R2 storage fields to teaching_profiles
-- Date: 2026-09-16
-- Description: Supports Cloudflare R2 multipart upload for instructor intro videos
--              while maintaining backwards compatibility with existing Supabase Storage URLs.

ALTER TABLE teaching_profiles
  ADD COLUMN IF NOT EXISTS introduction_video_storage_key TEXT,
  ADD COLUMN IF NOT EXISTS introduction_video_provider TEXT DEFAULT 'supabase';

-- Optional index for fast lookup during playback
CREATE INDEX IF NOT EXISTS idx_teaching_profiles_video_provider
  ON teaching_profiles(introduction_video_provider)
  WHERE introduction_video_provider IS NOT NULL;

COMMENT ON COLUMN teaching_profiles.introduction_video_storage_key IS
  'Cloudflare R2 object key when provider = r2 (e.g. instructors/{uid}/intro/{uuid}.mp4)';

COMMENT ON COLUMN teaching_profiles.introduction_video_provider IS
  'Storage provider: ''r2'' for Cloudflare R2 uploads, ''supabase'' for legacy Supabase Storage uploads (default)';
