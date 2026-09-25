-- ============================================================
-- Phase 7 Medium Findings Remediation
-- P7-04: refund_requests INSERT — No Payment Ownership Check
-- P7-06: Storage DELETE — Missing Bucket Scope  
-- P7-08: protect_course_state_fields — profiles.role='admin' Bypass
-- P7-11: admin_cancel_boost/promo_banner — Missing Role Hierarchy
-- ============================================================

-- ===== P7-04: refund_requests — Enforce Payment Ownership on INSERT =====
DROP POLICY IF EXISTS "students_insert_refund" ON public.refund_requests;
CREATE POLICY "students_insert_refund" ON public.refund_requests
FOR INSERT TO authenticated
WITH CHECK (
    student_id = auth.uid()
    AND status = 'pending'
    AND EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.id = refund_requests.payment_id
          AND p.student_id = auth.uid()
          AND p.amount >= refund_requests.amount
    )
);

-- ===== P7-06: Storage DELETE — Add bucket_id Scope =====
DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
CREATE POLICY "Users can delete their own avatar" ON storage.objects
FOR DELETE TO authenticated
USING (
    bucket_id = 'avatars'
    AND (auth.uid())::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Users can delete their own intro video" ON storage.objects;
CREATE POLICY "Users can delete their own intro video" ON storage.objects
FOR DELETE TO authenticated
USING (
    bucket_id = 'intro_videos'
    AND (auth.uid())::text = (storage.foldername(name))[1]
);

-- ===== P7-08: Fix protect_course_state_fields — Replace profiles.role bypass with admin_auth =====
CREATE OR REPLACE FUNCTION public.protect_course_state_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
    -- Allow service_role callers (identified via JWT claim)
    IF current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role' THEN
        RETURN NEW;
    END IF;

    -- Allow authenticated admins verified against admin_auth (not profiles.role which is user-injectable)
    IF auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.admin_auth WHERE id = auth.uid()
    ) THEN
        RETURN NEW;
    END IF;

    -- Block direct mutation of system-controlled workflow fields
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'Unauthorized: Cannot directly modify course status';
    END IF;

    IF NEW.version_status IS DISTINCT FROM OLD.version_status THEN
        RAISE EXCEPTION 'Unauthorized: Cannot directly modify course version_status';
    END IF;

    IF NEW.is_latest_published IS DISTINCT FROM OLD.is_latest_published THEN
        RAISE EXCEPTION 'Unauthorized: Cannot directly modify course is_latest_published';
    END IF;

    RETURN NEW;
END;
$$;

-- ===== P7-11: admin_cancel_boost — Restrict to superadmin/finance_manager =====
CREATE OR REPLACE FUNCTION public.admin_cancel_boost(p_boost_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.admin_auth
        WHERE id = auth.uid() AND role IN ('superadmin', 'finance_manager')
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Only superadmins or finance managers can cancel boosts';
    END IF;

    UPDATE public.boosts
    SET cancelled_at = now()
    WHERE id = p_boost_id AND cancelled_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_cancel_boost(p_boost_id UUID, p_note TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.admin_auth
        WHERE id = auth.uid() AND role IN ('superadmin', 'finance_manager')
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Only superadmins or finance managers can cancel boosts';
    END IF;

    UPDATE public.boosts
    SET cancelled_at = now()
    WHERE id = p_boost_id AND cancelled_at IS NULL;

    IF p_note IS NOT NULL THEN
        INSERT INTO public.admin_audit_logs (admin_id, action, entity_id, details)
        VALUES (auth.uid(), 'cancel_boost', p_boost_id, jsonb_build_object('note', p_note))
        ON CONFLICT DO NOTHING;
    END IF;
END;
$$;

-- ===== P7-11: admin_cancel_promo_banner — Restrict to superadmin/finance_manager =====
CREATE OR REPLACE FUNCTION public.admin_cancel_promo_banner(p_banner_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.admin_auth
        WHERE id = auth.uid() AND role IN ('superadmin', 'finance_manager')
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Only superadmins or finance managers can cancel promo banners';
    END IF;

    UPDATE public.promo_banners
    SET cancelled_at = now()
    WHERE id = p_banner_id AND cancelled_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_cancel_promo_banner(p_banner_id UUID, p_note TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.admin_auth
        WHERE id = auth.uid() AND role IN ('superadmin', 'finance_manager')
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Only superadmins or finance managers can cancel promo banners';
    END IF;

    UPDATE public.promo_banners
    SET cancelled_at = now()
    WHERE id = p_banner_id AND cancelled_at IS NULL;

    IF p_note IS NOT NULL THEN
        INSERT INTO public.admin_audit_logs (admin_id, action, entity_id, details)
        VALUES (auth.uid(), 'cancel_promo_banner', p_banner_id, jsonb_build_object('note', p_note))
        ON CONFLICT DO NOTHING;
    END IF;
END;
$$;
