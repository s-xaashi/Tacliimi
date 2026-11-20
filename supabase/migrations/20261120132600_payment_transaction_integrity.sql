-- Tacliimi security migration 02: payment transaction integrity
-- Revised 2026-11-20. Pair with the matching sifalo-checkout Edge Function update.

BEGIN;

-- Gateway transaction IDs must never be reused across payment rows.
CREATE UNIQUE INDEX IF NOT EXISTS payments_sifalo_sid_unique
ON public.payments (sifalo_sid)
WHERE sifalo_sid IS NOT NULL;

-- A failed attempt must not block a retry. At the same time, permit only
-- one pending-or-paid payment per item so concurrent clicks/retries cannot
-- initiate multiple gateway charges for the same course or booking.
ALTER TABLE public.payments
DROP CONSTRAINT IF EXISTS payments_student_id_course_id_key;

DROP INDEX IF EXISTS public.payments_one_paid_per_student_course;

CREATE UNIQUE INDEX IF NOT EXISTS payments_one_active_per_student_course
ON public.payments (student_id, course_id)
WHERE course_id IS NOT NULL AND payment_status IN ('pending', 'paid');

CREATE UNIQUE INDEX IF NOT EXISTS payments_one_active_per_student_session
ON public.payments (student_id, mentorship_session_id)
WHERE mentorship_session_id IS NOT NULL AND payment_status IN ('pending', 'paid');

-- Promotion orders are stored in gateway_response because the payments schema
-- has no dedicated promotion_order_id column.
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_active_per_promotion_order
ON public.payments (student_id, (gateway_response ->> 'promotionOrderId'))
WHERE gateway_response ? 'promotionOrderId'
  AND mentorship_session_id IS NULL
  AND course_id IS NULL
  AND payment_status IN ('pending', 'paid');

COMMIT;
