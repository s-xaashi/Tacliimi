-- =============================================================================
-- MIGRATION: Course Revision Workflow (v2 Hardened)
-- Created: 2026-07-04
-- Description: Implements snapshot versioning, copy-on-write media assets,
--              update notification offers, and scheduled orphan cleanup.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- STEP 0: Enable required extensions (pg_cron + pg_net for scheduled cleanup)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------------------------------------------------------------------------
-- STEP 1: course_media_assets — provider-agnostic video asset registry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.course_media_assets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_provider TEXT NOT NULL DEFAULT 'supabase'
    CHECK (storage_provider IN ('supabase', 's3', 'r2')),
  storage_path     TEXT NOT NULL,
  public_url       TEXT,
  file_size_bytes  BIGINT,
  duration_seconds INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.course_media_assets ENABLE ROW LEVEL SECURITY;

-- Instructors: full control over assets linked to their courses
CREATE POLICY "instructor_manage_assets" ON public.course_media_assets
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.course_lessons cl
      JOIN public.course_sections cs ON cs.id = cl.section_id
      JOIN public.courses c ON c.id = cs.course_id
      WHERE cl.media_asset_id = course_media_assets.id
        AND c.instructor_id = auth.uid()
    )
  );

-- Enrolled students: read-only (to stream video)
CREATE POLICY "student_read_enrolled_assets" ON public.course_media_assets
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.course_lessons cl
      JOIN public.course_sections cs ON cs.id = cl.section_id
      JOIN public.enrollments e ON e.course_id = cs.course_id
      WHERE cl.media_asset_id = course_media_assets.id
        AND e.student_id = auth.uid()
    )
  );

-- Link existing lessons to asset registry (nullable, existing rows keep video_url)
ALTER TABLE public.course_lessons
  ADD COLUMN IF NOT EXISTS media_asset_id UUID
    REFERENCES public.course_media_assets(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- STEP 2: Alter courses — versioning columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS root_course_id      UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version_number      INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_latest_published BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS version_status      TEXT NOT NULL DEFAULT 'published'
    CHECK (version_status IN ('draft','pending_review','published','archived','rejected'));

-- Set all currently published courses as the latest published (they are their own root)
UPDATE public.courses
SET is_latest_published = true, version_status = 'published'
WHERE status = 'published' AND root_course_id IS NULL;

-- Update draft courses to correct version_status
UPDATE public.courses SET version_status = 'draft' WHERE status = 'draft' AND root_course_id IS NULL;
UPDATE public.courses SET version_status = 'pending_review' WHERE status = 'pending_review' AND root_course_id IS NULL;
UPDATE public.courses SET version_status = 'rejected' WHERE status = 'rejected' AND root_course_id IS NULL;

-- Hard constraint: exactly one latest-published per course family
CREATE UNIQUE INDEX IF NOT EXISTS one_latest_published_per_family
  ON public.courses (COALESCE(root_course_id, id))
  WHERE is_latest_published = true;

-- ---------------------------------------------------------------------------
-- STEP 3: course_coupons — add coupon_type
-- ---------------------------------------------------------------------------
ALTER TABLE public.course_coupons
  ADD COLUMN IF NOT EXISTS coupon_type TEXT NOT NULL DEFAULT 'general'
    CHECK (coupon_type IN ('general', 'update_migration'));

-- ---------------------------------------------------------------------------
-- STEP 4: course_update_offers — instructor-initiated update notifications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.course_update_offers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  root_course_id  UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  -- ON DELETE SET NULL keeps the offer record when old versions are pruned
  from_version_id UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  to_version_id   UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  coupon_id       UUID REFERENCES public.course_coupons(id) ON DELETE SET NULL,
  student_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notified_at     TIMESTAMPTZ,
  redeemed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (to_version_id, student_id)
);

ALTER TABLE public.course_update_offers ENABLE ROW LEVEL SECURITY;

-- Students: read only their own rows
CREATE POLICY "student_read_own_offers" ON public.course_update_offers
  FOR SELECT USING (student_id = auth.uid());

-- Instructors: manage offers for courses they own
CREATE POLICY "instructor_manage_offers" ON public.course_update_offers
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.courses c
      WHERE c.id = course_update_offers.root_course_id
        AND c.instructor_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- STEP 5: get_or_create_course_revision — copy-on-write draft creation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_or_create_course_revision(p_course_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_root_id       UUID;
  v_family_id     UUID;
  v_next_version  INTEGER;
  v_new_course_id UUID;
  v_section_map   JSONB := '{}'::JSONB;
  v_lesson_map    JSONB := '{}'::JSONB;
  v_old_section_id UUID;
  v_new_section_id UUID;
  v_old_lesson_id  UUID;
  v_new_lesson_id  UUID;
BEGIN
  -- Get the root course id
  SELECT COALESCE(root_course_id, id) INTO v_family_id FROM courses WHERE id = p_course_id;

  -- Check if an active (non-archived, non-published) revision already exists
  SELECT id INTO v_new_course_id
  FROM courses
  WHERE COALESCE(root_course_id, id) = v_family_id
    AND version_status IN ('draft', 'pending_review', 'rejected')
  LIMIT 1;

  IF v_new_course_id IS NOT NULL THEN
    RETURN v_new_course_id; -- Return existing draft
  END IF;

  -- Find the current latest published version to clone
  SELECT id INTO v_root_id
  FROM courses
  WHERE COALESCE(root_course_id, id) = v_family_id
    AND is_latest_published = true
  LIMIT 1;

  IF v_root_id IS NULL THEN
    RAISE EXCEPTION 'No published version found for course family %', v_family_id;
  END IF;

  -- Determine next version number
  SELECT COALESCE(MAX(version_number), 1) + 1 INTO v_next_version
  FROM courses
  WHERE COALESCE(root_course_id, id) = v_family_id;

  -- Clone the courses row
  INSERT INTO courses (
    instructor_id, title, slug, description, thumbnail_url, price,
    status, subtitle, category_id, level, intro_video_url, price_type,
    currency, is_public, total_duration_minutes,
    root_course_id, version_number, is_latest_published, version_status
  )
  SELECT
    instructor_id, title,
    slug || '-v' || v_next_version,  -- temporary slug; not public-facing
    description, thumbnail_url, price,
    'draft'::course_status, subtitle, category_id, level, intro_video_url, price_type,
    currency, is_public, total_duration_minutes,
    v_family_id, v_next_version, false, 'draft'
  FROM courses WHERE id = v_root_id
  RETURNING id INTO v_new_course_id;

  -- Clone sections
  FOR v_old_section_id IN
    SELECT id FROM course_sections WHERE course_id = v_root_id AND deleted_at IS NULL
    ORDER BY order_index
  LOOP
    INSERT INTO course_sections (course_id, title, order_index)
    SELECT v_new_course_id, title, order_index
    FROM course_sections WHERE id = v_old_section_id
    RETURNING id INTO v_new_section_id;

    v_section_map := v_section_map || jsonb_build_object(v_old_section_id::TEXT, v_new_section_id);

    -- Clone lessons — copy media_asset_id by reference (copy-on-write)
    FOR v_old_lesson_id IN
      SELECT id FROM course_lessons WHERE section_id = v_old_section_id AND deleted_at IS NULL
      ORDER BY order_index
    LOOP
      INSERT INTO course_lessons (section_id, title, video_url, is_preview, order_index, content_type, description, media_asset_id)
      SELECT v_new_section_id, title, video_url, is_preview, order_index, content_type, description, media_asset_id
      FROM course_lessons WHERE id = v_old_lesson_id
      RETURNING id INTO v_new_lesson_id;

      v_lesson_map := v_lesson_map || jsonb_build_object(v_old_lesson_id::TEXT, v_new_lesson_id);

      -- Clone lesson resources
      INSERT INTO lesson_resources (lesson_id, title, file_url, file_type)
      SELECT v_new_lesson_id, title, file_url, file_type
      FROM lesson_resources WHERE lesson_id = v_old_lesson_id;

      -- Clone quizzes + questions + options
      DECLARE
        v_old_quiz_id UUID;
        v_new_quiz_id UUID;
        v_old_q_id UUID;
        v_new_q_id UUID;
      BEGIN
        FOR v_old_quiz_id IN SELECT id FROM quizzes WHERE lesson_id = v_old_lesson_id LOOP
          INSERT INTO quizzes (lesson_id, title, description, passing_score_percentage)
          SELECT v_new_lesson_id, title, description, passing_score_percentage
          FROM quizzes WHERE id = v_old_quiz_id
          RETURNING id INTO v_new_quiz_id;

          FOR v_old_q_id IN SELECT id FROM quiz_questions WHERE quiz_id = v_old_quiz_id ORDER BY order_index LOOP
            INSERT INTO quiz_questions (quiz_id, question_text, order_index)
            SELECT v_new_quiz_id, question_text, order_index
            FROM quiz_questions WHERE id = v_old_q_id
            RETURNING id INTO v_new_q_id;

            INSERT INTO quiz_options (question_id, option_text, is_correct, order_index)
            SELECT v_new_q_id, option_text, is_correct, order_index
            FROM quiz_options WHERE question_id = v_old_q_id;
          END LOOP;
        END LOOP;
      END;
    END LOOP;
  END LOOP;

  -- Clone coupons (general type only; update_migration coupons are created separately)
  INSERT INTO course_coupons (course_id, code, discount_percent, is_active, expires_at, starts_at, coupon_type)
  SELECT v_new_course_id, code, discount_percent, is_active, expires_at, starts_at, 'general'
  FROM course_coupons
  WHERE course_id = v_root_id AND coupon_type = 'general';

  RETURN v_new_course_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- STEP 6: approve_course_revision — replaces approve_course_admin
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_course_admin(
  p_course_id    UUID,
  p_instructor_id UUID,
  p_moderator_id  UUID,
  p_notes        TEXT DEFAULT 'Approved by Admin'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_family_id UUID;
  v_is_revision BOOLEAN;
BEGIN
  SELECT COALESCE(root_course_id, id), (root_course_id IS NOT NULL)
  INTO v_family_id, v_is_revision
  FROM courses WHERE id = p_course_id;

  IF v_is_revision THEN
    -- Archive the currently published version
    UPDATE courses
    SET version_status = 'archived', is_latest_published = false, status = 'approved'
    WHERE COALESCE(root_course_id, id) = v_family_id
      AND is_latest_published = true;

    -- Promote this revision to the live version
    UPDATE courses
    SET status = 'published',
        version_status = 'published',
        is_latest_published = true,
        rejection_reason = NULL
    WHERE id = p_course_id;
  ELSE
    -- First-time publish (no prior published version in family)
    UPDATE courses
    SET status = 'published',
        version_status = 'published',
        is_latest_published = true,
        rejection_reason = NULL
    WHERE id = p_course_id;
  END IF;

  INSERT INTO course_moderation_logs (course_id, moderator_id, decision, notes)
  VALUES (p_course_id, p_moderator_id, 'approved', p_notes);
END;
$$;

-- ---------------------------------------------------------------------------
-- STEP 7: reject_course_admin — preserves live version when rejecting revision
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_course_admin(
  p_course_id     UUID,
  p_instructor_id UUID,
  p_moderator_id  UUID,
  p_notes         TEXT DEFAULT 'Rejected based on review.'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Mark this version as rejected — do NOT touch any other version in the family
  UPDATE courses
  SET status = 'rejected',
      version_status = 'rejected',
      rejection_reason = p_notes
  WHERE id = p_course_id;

  INSERT INTO course_moderation_logs (course_id, moderator_id, decision, notes)
  VALUES (p_course_id, p_moderator_id, 'rejected', p_notes);
END;
$$;

-- ---------------------------------------------------------------------------
-- STEP 8: get_pending_courses_admin — surface revision context to admin
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_pending_courses_admin()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  courses_data json;
BEGIN
  SELECT json_agg(c) INTO courses_data
  FROM (
    SELECT
      co.id,
      co.title,
      co.subtitle,
      co.thumbnail_url,
      co.category_id,
      co.level,
      co.created_at,
      co.instructor_id,
      co.root_course_id,
      co.version_number,
      co.version_status,
      (co.root_course_id IS NOT NULL) AS is_revision,
      json_build_object(
        'id', p.id,
        'full_name', p.full_name,
        'email', p.email,
        'avatar_url', p.avatar_url
      ) AS instructor,
      json_build_object('name', cat.name) AS category
    FROM courses co
    LEFT JOIN profiles p ON co.instructor_id = p.id
    LEFT JOIN course_categories cat ON co.category_id = cat.id
    WHERE co.status = 'pending_review'
    ORDER BY co.created_at DESC
  ) c;

  RETURN COALESCE(courses_data, '[]'::json);
END;
$$;

-- ---------------------------------------------------------------------------
-- STEP 9: validate_course_coupon — add update_migration restriction
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_course_coupon(
  p_course_id UUID,
  p_code      TEXT,
  p_student_id UUID DEFAULT NULL
)
RETURNS TABLE(discount_percent NUMERIC, valid BOOLEAN, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_coupon course_coupons%ROWTYPE;
  v_family_id UUID;
BEGIN
  -- Resolve the canonical family so coupons on the root still validate against any version URL
  SELECT COALESCE(root_course_id, id) INTO v_family_id FROM courses WHERE id = p_course_id;

  SELECT * INTO v_coupon
  FROM course_coupons
  WHERE course_id IN (
    SELECT id FROM courses WHERE COALESCE(root_course_id, id) = v_family_id
  )
    AND code = UPPER(p_code)
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::NUMERIC, false, 'Invalid coupon code';
    RETURN;
  END IF;

  IF v_coupon.starts_at IS NOT NULL AND v_coupon.starts_at > now() THEN
    RETURN QUERY SELECT NULL::NUMERIC, false, 'Coupon not active yet';
    RETURN;
  END IF;

  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at < now() THEN
    RETURN QUERY SELECT NULL::NUMERIC, false, 'Coupon has expired';
    RETURN;
  END IF;

  -- update_migration coupons: only valid if the student has a pending offer
  IF v_coupon.coupon_type = 'update_migration' THEN
    IF p_student_id IS NULL THEN
      RETURN QUERY SELECT NULL::NUMERIC, false, 'This coupon requires a student account';
      RETURN;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM course_update_offers
      WHERE coupon_id = v_coupon.id
        AND student_id = p_student_id
        AND redeemed_at IS NULL
    ) THEN
      RETURN QUERY SELECT NULL::NUMERIC, false, 'This coupon is not available for your account';
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT v_coupon.discount_percent::NUMERIC, true, 'Valid';
END;
$$;

-- ---------------------------------------------------------------------------
-- STEP 10: create_update_offer — notify enrolled students of new version
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_update_offer(
  p_root_course_id UUID,
  p_to_version_id  UUID,
  p_coupon_id      UUID DEFAULT NULL,
  p_notify         BOOLEAN DEFAULT true
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_count INTEGER;
  v_family_id UUID;
BEGIN
  -- Use family expression consistently
  SELECT COALESCE(root_course_id, id) INTO v_family_id
  FROM courses WHERE id = p_root_course_id;

  INSERT INTO course_update_offers (
    root_course_id, from_version_id, to_version_id, coupon_id, student_id, notified_at
  )
  SELECT
    v_family_id,
    e.course_id,
    p_to_version_id,
    p_coupon_id,
    e.student_id,
    CASE WHEN p_notify THEN now() ELSE NULL END
  FROM enrollments e
  JOIN courses c ON c.id = e.course_id
  WHERE COALESCE(c.root_course_id, c.id) = v_family_id
    AND c.id != p_to_version_id
  ON CONFLICT (to_version_id, student_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- STEP 11: prune_old_course_versions — safe retention (keeps last 3 archived)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prune_old_course_versions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.courses c
  WHERE c.version_status = 'archived'
    AND c.root_course_id IS NOT NULL  -- never prune root rows
    AND c.id NOT IN (
      -- Keep 3 most recent archived per family
      SELECT id FROM courses c2
      WHERE c2.root_course_id = c.root_course_id
        AND c2.version_status = 'archived'
      ORDER BY c2.version_number DESC
      LIMIT 3
    )
    -- FK safety: never prune versions with unredeemed update offers
    AND c.id NOT IN (
      SELECT from_version_id FROM course_update_offers
      WHERE redeemed_at IS NULL AND from_version_id IS NOT NULL
      UNION ALL
      SELECT to_version_id FROM course_update_offers
      WHERE redeemed_at IS NULL AND to_version_id IS NOT NULL
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- STEP 12: get_orphaned_media_assets — find unreferenced video files
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_orphaned_media_assets()
RETURNS TABLE(id UUID, storage_provider TEXT, storage_path TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT m.id, m.storage_provider, m.storage_path
  FROM course_media_assets m
  WHERE NOT EXISTS (
    SELECT 1 FROM course_lessons l WHERE l.media_asset_id = m.id
  )
  AND m.created_at < now() - INTERVAL '30 days';
$$;

-- ---------------------------------------------------------------------------
-- STEP 13: Update course_marketplace_view — family-aware, no slug swap needed
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.course_marketplace_view;

CREATE VIEW public.course_marketplace_view AS
SELECT
  c.id,
  c.instructor_id,
  c.title,
  -- Public slug always resolved from the root row of the family
  COALESCE(root.slug, c.slug) AS slug,
  c.description,
  c.thumbnail_url,
  c.price,
  c.status,
  c.created_at,
  c.updated_at,
  c.deleted_at,
  c.subtitle,
  c.category_id,
  c.level,
  c.intro_video_url,
  c.price_type,
  c.currency,
  c.is_public,
  c.total_duration_minutes,
  COALESCE(c.root_course_id, c.id) AS family_id,
  c.version_number,
  p.full_name      AS instructor_name,
  p.avatar_url     AS instructor_avatar,
  cc.name          AS category_name,
  -- Aggregate reviews across the whole course family
  COALESCE(fam_agg.avg_rating, 0)         AS average_rating,
  COALESCE(fam_agg.review_count, 0)       AS review_count,
  COALESCE(fam_agg.enrollments_count, 0)  AS enrollments_count,
  COALESCE(l.lessons_count, 0)            AS total_lessons,
  COALESCE(q.quizzes_count, 0)            AS total_quizzes,
  COALESCE(res.resources_count, 0)        AS total_resources
FROM courses c
JOIN profiles p ON c.instructor_id = p.id
JOIN instructors i ON c.instructor_id = i.user_id
LEFT JOIN course_categories cc ON c.category_id = cc.id
-- Root course row for slug resolution
LEFT JOIN courses root ON root.id = c.root_course_id
-- Family-wide review + enrollment aggregates
LEFT JOIN (
  SELECT
    COALESCE(c2.root_course_id, c2.id)  AS family_id,
    AVG(cr.rating)::NUMERIC(3,1)        AS avg_rating,
    COUNT(DISTINCT cr.id)               AS review_count,
    COUNT(DISTINCT e.id)                AS enrollments_count
  FROM courses c2
  LEFT JOIN course_reviews cr ON cr.course_id = c2.id
  LEFT JOIN enrollments e ON e.course_id = c2.id
  GROUP BY 1
) fam_agg ON fam_agg.family_id = COALESCE(c.root_course_id, c.id)
-- Lesson / quiz / resource counts for THIS version only
LEFT JOIN (
  SELECT s.course_id, COUNT(ls.id) AS lessons_count
  FROM course_sections s JOIN course_lessons ls ON ls.section_id = s.id
  WHERE ls.deleted_at IS NULL
  GROUP BY 1
) l ON l.course_id = c.id
LEFT JOIN (
  SELECT s.course_id, COUNT(qz.id) AS quizzes_count
  FROM course_sections s
  JOIN course_lessons ls ON ls.section_id = s.id
  JOIN quizzes qz ON qz.lesson_id = ls.id
  WHERE ls.deleted_at IS NULL
  GROUP BY 1
) q ON q.course_id = c.id
LEFT JOIN (
  SELECT s.course_id, COUNT(rs.id) AS resources_count
  FROM course_sections s
  JOIN course_lessons ls ON ls.section_id = s.id
  JOIN lesson_resources rs ON rs.lesson_id = ls.id
  WHERE ls.deleted_at IS NULL
  GROUP BY 1
) res ON res.course_id = c.id
WHERE c.is_latest_published = true
  AND c.deleted_at IS NULL
  AND i.approval_status = 'approved'
  AND p.account_status = 'active';

-- ---------------------------------------------------------------------------
-- STEP 14: Schedule monthly cleanup via pg_cron + pg_net
-- (Substitute <project-ref> with the actual Supabase project ref at setup time.
--  Use vault.decrypted_secret for the service key in production.)
-- ---------------------------------------------------------------------------
-- SELECT cron.schedule(
--   'monthly-media-cleanup',
--   '0 3 1 * *',
--   $$
--   SELECT net.http_post(
--     url := 'https://<project-ref>.supabase.co/functions/v1/cleanup-orphaned-media',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
--       'Content-Type', 'application/json'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
-- NOTE: Uncomment and run separately once vault secret 'service_role_key' is configured.
