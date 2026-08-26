-- ============================================================
-- Phase 4B: Column-Level Protection & Storage Cleanup
-- Date: 2026-08-26
-- Project: Tacliimi
-- ============================================================

-- ============================================================
-- 1. DROP REST OF DANGEROUS/REDUNDANT STORAGE POLICIES
-- ============================================================
DROP POLICY IF EXISTS "Instructors upload intro videos" ON storage.objects;
DROP POLICY IF EXISTS "Public Access course_resources" ON storage.objects;
DROP POLICY IF EXISTS "Public Access course_videos" ON storage.objects;
DROP POLICY IF EXISTS "course_resources_access" ON storage.objects;
DROP POLICY IF EXISTS "course_videos_access" ON storage.objects;
-- The 'Public read storage objects' policy originally included 'course_videos' and 'course_resources'. 
-- We must recreate it without those two, leaving only truly public buckets if intended (like avatars).
DROP POLICY IF EXISTS "Public read storage objects" ON storage.objects;

-- Re-create Public read only for safe buckets (thumbnails, intro_videos).
CREATE POLICY "Public read storage objects safe" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id IN ('course_thumbnails', 'intro_videos', 'avatars'));


-- ============================================================
-- 2. TRIGGER: Prevent Mass Assignment on `courses`
-- Protects: status, approval_status, is_featured, admin_id
-- ============================================================
CREATE OR REPLACE FUNCTION protect_course_state_fields()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow system roles (service_role, postgres via SECDEF) to perform any update
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  -- Allow application Admins to perform any update
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN NEW;
  END IF;

  -- For instructors/students, block changes to sensitive fields
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Unauthorized: Cannot directly modify course status';
  END IF;
  
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    RAISE EXCEPTION 'Unauthorized: Cannot directly modify course approval_status';
  END IF;

  IF NEW.is_featured IS DISTINCT FROM OLD.is_featured THEN
    RAISE EXCEPTION 'Unauthorized: Cannot directly modify is_featured';
  END IF;

  IF NEW.admin_id IS DISTINCT FROM OLD.admin_id THEN
    RAISE EXCEPTION 'Unauthorized: Cannot directly modify admin_id';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protect_course_state ON public.courses;
CREATE TRIGGER trg_protect_course_state
  BEFORE UPDATE ON public.courses
  FOR EACH ROW
  EXECUTE FUNCTION protect_course_state_fields();

-- ============================================================
-- 3. TRIGGER: Prevent Mass Assignment on `mentorship_sessions`
-- Protects: status, booking_status, price, mentor_payout_amount
-- ============================================================
CREATE OR REPLACE FUNCTION protect_session_state_fields()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow system roles (service_role, postgres via SECDEF) to perform any update
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  -- Allow application Admins to perform any update
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN NEW;
  END IF;
  
  -- For mentors/students, block changes to sensitive state fields
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Unauthorized: Cannot directly modify session status';
  END IF;

  IF NEW.booking_status IS DISTINCT FROM OLD.booking_status THEN
    RAISE EXCEPTION 'Unauthorized: Cannot directly modify booking_status';
  END IF;

  IF NEW.price IS DISTINCT FROM OLD.price THEN
    RAISE EXCEPTION 'Unauthorized: Cannot directly modify price';
  END IF;

  IF NEW.mentor_payout_amount IS DISTINCT FROM OLD.mentor_payout_amount THEN
    RAISE EXCEPTION 'Unauthorized: Cannot directly modify mentor_payout_amount';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protect_session_state ON public.mentorship_sessions;
CREATE TRIGGER trg_protect_session_state
  BEFORE UPDATE ON public.mentorship_sessions
  FOR EACH ROW
  EXECUTE FUNCTION protect_session_state_fields();
