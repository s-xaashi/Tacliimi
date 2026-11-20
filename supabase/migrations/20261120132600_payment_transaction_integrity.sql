-- Tacliimi security migration 02: payment transaction integrity
-- Revised 2026-11-20. Pair with the matching sifalo-checkout Edge Function update.

BEGIN;

-- Gateway transaction IDs must never be reused across payment rows.
CREATE UNIQUE INDEX IF NOT EXISTS payments_sifalo_sid_unique
ON public.payments (sifalo_sid)
WHERE sifalo_sid IS NOT NULL;

-- Failed/pending attempts must not block a fresh checkout. Only one paid
-- payment may exist for a student/course pair.
ALTER TABLE public.payments
DROP CONSTRAINT IF EXISTS payments_student_id_course_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS payments_one_paid_per_student_course
ON public.payments (student_id, course_id)
WHERE course_id IS NOT NULL AND payment_status = 'paid';

COMMIT;
