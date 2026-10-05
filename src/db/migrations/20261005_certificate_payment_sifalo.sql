-- Certificate payment + generation policy
-- Keeps existing certificate design/generator and adds server-side access enforcement.

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS certificate_payment_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS certificate_price numeric(10,2) NOT NULL DEFAULT 1.00,
  ADD COLUMN IF NOT EXISTS certificate_free_generation_limit integer NOT NULL DEFAULT 3;

ALTER TABLE public.platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_certificate_price_check;
ALTER TABLE public.platform_settings
  ADD CONSTRAINT platform_settings_certificate_price_check CHECK (certificate_price >= 0);

ALTER TABLE public.platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_certificate_free_generation_limit_check;
ALTER TABLE public.platform_settings
  ADD CONSTRAINT platform_settings_certificate_free_generation_limit_check CHECK (certificate_free_generation_limit >= 0);

CREATE TABLE IF NOT EXISTS public.certificate_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'USD',
  order_id text NOT NULL UNIQUE,
  sifalo_sid text,
  payment_status text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','paid','failed')),
  verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified','verified','failed','needs_manual_grant')),
  gateway_response jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  paid_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS certificate_orders_student_course_idx
  ON public.certificate_orders(student_id, course_id);
CREATE INDEX IF NOT EXISTS certificate_orders_order_id_idx
  ON public.certificate_orders(order_id);

ALTER TABLE public.certificates
  ADD COLUMN IF NOT EXISTS generation_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_unlocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_unlocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_order_id uuid;

ALTER TABLE public.certificates
  DROP CONSTRAINT IF EXISTS certificates_generation_count_check;
ALTER TABLE public.certificates
  ADD CONSTRAINT certificates_generation_count_check CHECK (generation_count >= 0);

ALTER TABLE public.certificates
  DROP CONSTRAINT IF EXISTS certificates_payment_order_id_fkey;
ALTER TABLE public.certificates
  ADD CONSTRAINT certificates_payment_order_id_fkey
  FOREIGN KEY (payment_order_id) REFERENCES public.certificate_orders(id) ON DELETE SET NULL;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS certificate_order_id uuid;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_certificate_order_id_fkey;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_certificate_order_id_fkey
  FOREIGN KEY (certificate_order_id) REFERENCES public.certificate_orders(id) ON DELETE SET NULL;

ALTER TABLE public.certificate_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can view own certificate orders" ON public.certificate_orders;
CREATE POLICY "Students can view own certificate orders"
  ON public.certificate_orders
  FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins can view certificate orders" ON public.certificate_orders;
CREATE POLICY "Admins can view certificate orders"
  ON public.certificate_orders
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_auth
      WHERE public.admin_auth.id = (SELECT auth.uid())
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.certificate_orders FROM anon, authenticated;
GRANT SELECT ON public.certificate_orders TO authenticated;

CREATE OR REPLACE FUNCTION public.get_certificate_generation_status(p_student_id uuid, p_course_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_completed_at timestamptz;
  v_cert_enabled boolean;
  v_cert public.certificates;
  v_payment_required boolean;
  v_price numeric;
  v_limit integer;
  v_paid boolean := false;
  v_remaining integer;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required';
  END IF;
  IF (SELECT auth.uid()) <> p_student_id THEN
    RAISE EXCEPTION 'Unauthorized: you may only check certificate access for your own account';
  END IF;

  SELECT COALESCE(e.completed_at, CASE WHEN e.progress_percentage = 100 THEN e.updated_at ELSE NULL END),
         c.certificate_enabled
  INTO v_completed_at, v_cert_enabled
  FROM public.enrollments e
  JOIN public.courses c ON c.id = e.course_id
  WHERE e.student_id = p_student_id AND e.course_id = p_course_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Not enrolled in this course'; END IF;

  IF v_completed_at IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'course_not_completed');
  END IF;

  IF NOT v_cert_enabled THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'certificate_disabled');
  END IF;

  SELECT * INTO v_cert
  FROM public.certificates
  WHERE student_id = p_student_id AND course_id = p_course_id;

  SELECT COALESCE(ps.certificate_payment_enabled, false),
         COALESCE(ps.certificate_price, 1),
         COALESCE(ps.certificate_free_generation_limit, 3)
  INTO v_payment_required, v_price, v_limit
  FROM public.platform_settings ps
  LIMIT 1;

  IF v_cert.payment_unlocked THEN
    v_paid := true;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.certificate_orders co
      WHERE co.student_id = p_student_id
        AND co.course_id = p_course_id
        AND co.payment_status = 'paid'
        AND co.verification_status = 'verified'
    ) INTO v_paid;
  END IF;

  v_remaining := GREATEST(v_limit - COALESCE(v_cert.generation_count, 0), 0);

  RETURN jsonb_build_object(
    'eligible', true,
    'payment_enabled', v_payment_required,
    'certificate_price', v_price,
    'currency', 'USD',
    'free_generation_limit', v_limit,
    'generation_count', COALESCE(v_cert.generation_count, 0),
    'free_generations_remaining', v_remaining,
    'payment_unlocked', v_paid,
    'requires_payment', CASE
      WHEN v_payment_required THEN NOT v_paid
      ELSE v_remaining <= 0 AND NOT v_paid
    END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_certificate(p_student_id uuid, p_course_id uuid)
RETURNS public.certificates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_existing public.certificates;
  v_new public.certificates;
  v_completed_at timestamptz;
  v_cert_enabled boolean;
  v_payment_enabled boolean := false;
  v_price numeric := 1;
  v_free_limit integer := 3;
  v_paid_order public.certificate_orders;
  v_code text;
  v_score numeric;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Unauthorized: authentication required'; END IF;
  IF (SELECT auth.uid()) <> p_student_id THEN
    RAISE EXCEPTION 'Unauthorized: you may only generate a certificate for your own account';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_student_id::text || ':' || p_course_id::text, 0)
  );

  SELECT COALESCE(e.completed_at, CASE WHEN e.progress_percentage = 100 THEN e.updated_at ELSE NULL END),
         c.certificate_enabled
  INTO v_completed_at, v_cert_enabled
  FROM public.enrollments e
  JOIN public.courses c ON c.id = e.course_id
  WHERE e.student_id = p_student_id AND e.course_id = p_course_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Not enrolled in this course'; END IF;
  IF v_completed_at IS NULL THEN RAISE EXCEPTION 'Course not yet completed'; END IF;
  IF NOT v_cert_enabled THEN RAISE EXCEPTION 'Certificates are not enabled for this course'; END IF;

  SELECT COALESCE(ps.certificate_payment_enabled, false),
         COALESCE(ps.certificate_price, 1),
         COALESCE(ps.certificate_free_generation_limit, 3)
  INTO v_payment_enabled, v_price, v_free_limit
  FROM public.platform_settings ps
  LIMIT 1;

  SELECT * INTO v_existing
  FROM public.certificates
  WHERE student_id = p_student_id AND course_id = p_course_id
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT * INTO v_paid_order
    FROM public.certificate_orders
    WHERE student_id = p_student_id AND course_id = p_course_id
      AND payment_status = 'paid' AND verification_status = 'verified'
    ORDER BY paid_at DESC NULLS LAST, created_at DESC
    LIMIT 1;

    IF v_payment_enabled AND v_paid_order.id IS NULL THEN
      RAISE EXCEPTION 'Certificate payment required. Price: $%', to_char(v_price, 'FM999999990.00');
    END IF;

    IF NOT v_payment_enabled AND v_paid_order.id IS NULL AND v_free_limit <= 0 THEN
      RAISE EXCEPTION 'Certificate generation limit reached. Payment required. Price: $%', to_char(v_price, 'FM999999990.00');
    END IF;

    v_score := public.get_course_quiz_score(p_student_id, p_course_id);
    v_code := 'CERT-' || upper(substr(md5(public.gen_random_uuid()::text), 1, 4))
              || '-' || upper(substr(md5(random()::text), 1, 4));

    INSERT INTO public.certificates (
      student_id, course_id, verification_code, quiz_score_snapshot,
      completed_at_snapshot, generation_count, payment_unlocked,
      payment_unlocked_at, payment_order_id
    )
    VALUES (
      p_student_id, p_course_id, v_code, v_score, v_completed_at, 1,
      v_paid_order.id IS NOT NULL,
      CASE WHEN v_paid_order.id IS NOT NULL THEN COALESCE(v_paid_order.paid_at, now()) ELSE NULL END,
      v_paid_order.id
    )
    RETURNING * INTO v_new;

    RETURN v_new;
  END IF;

  IF NOT v_existing.payment_unlocked THEN
    SELECT * INTO v_paid_order
    FROM public.certificate_orders
    WHERE student_id = p_student_id AND course_id = p_course_id
      AND payment_status = 'paid' AND verification_status = 'verified'
    ORDER BY paid_at DESC NULLS LAST, created_at DESC
    LIMIT 1;

    IF v_paid_order.id IS NOT NULL THEN
      v_existing.payment_unlocked := true;
      v_existing.payment_unlocked_at := COALESCE(v_paid_order.paid_at, now());
      v_existing.payment_order_id := v_paid_order.id;
    END IF;
  END IF;

  IF v_payment_enabled AND NOT v_existing.payment_unlocked THEN
    RAISE EXCEPTION 'Certificate payment required. Price: $%', to_char(v_price, 'FM999999990.00');
  END IF;

  IF NOT v_payment_enabled AND NOT v_existing.payment_unlocked
     AND COALESCE(v_existing.generation_count, 0) >= v_free_limit THEN
    RAISE EXCEPTION 'Certificate generation limit reached. Payment required. Price: $%', to_char(v_price, 'FM999999990.00');
  END IF;

  v_existing.generation_count := COALESCE(v_existing.generation_count, 0) + 1;

  UPDATE public.certificates
  SET generation_count = v_existing.generation_count,
      payment_unlocked = v_existing.payment_unlocked,
      payment_unlocked_at = v_existing.payment_unlocked_at,
      payment_order_id = v_existing.payment_order_id
  WHERE id = v_existing.id
  RETURNING * INTO v_existing;

  RETURN v_existing;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_platform_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'commission_enabled', ps.commission_enabled,
    'instructor_percentage', ps.instructor_percentage,
    'platform_percentage', ps.platform_percentage,
    'min_withdrawal_amount', ps.min_withdrawal_amount,
    'withdrawal_reserve_enabled', COALESCE(ps.withdrawal_reserve_enabled, true),
    'withdrawal_reserve_percent', COALESCE(ps.withdrawal_reserve_percent, 50),
    'show_refund_request', ps.show_refund_request,
    'course_boost_price_per_day', ps.course_boost_price_per_day,
    'mentor_boost_price_per_day', ps.mentor_boost_price_per_day,
    'course_banner_price_per_day', ps.course_banner_price_per_day,
    'mentor_banner_price_per_day', ps.mentor_banner_price_per_day,
    'boost_min_days', ps.boost_min_days,
    'boost_max_days', ps.boost_max_days,
    'course_boost_enabled', ps.course_boost_enabled,
    'course_banner_enabled', ps.course_banner_enabled,
    'mentor_boost_enabled', ps.mentor_boost_enabled,
    'mentor_banner_enabled', ps.mentor_banner_enabled,
    'self_hosted_video_uploads_enabled', ps.self_hosted_video_uploads_enabled,
    'certificate_payment_enabled', COALESCE(ps.certificate_payment_enabled, false),
    'certificate_price', COALESCE(ps.certificate_price, 1),
    'certificate_free_generation_limit', COALESCE(ps.certificate_free_generation_limit, 3),
    'updated_at', ps.updated_at
  ) INTO result
  FROM public.platform_settings ps LIMIT 1;

  RETURN COALESCE(
    result,
    '{"commission_enabled":false,"instructor_percentage":100,"platform_percentage":0,"min_withdrawal_amount":10,"withdrawal_reserve_enabled":true,"withdrawal_reserve_percent":50,"show_refund_request":true,"self_hosted_video_uploads_enabled":false,"certificate_payment_enabled":false,"certificate_price":1,"certificate_free_generation_limit":3}'::jsonb
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.generate_certificate(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.generate_certificate(uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_certificate_generation_status(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_certificate_generation_status(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_settings() TO anon, authenticated;
