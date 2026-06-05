-- Migration: Add starts_at to course_coupons
ALTER TABLE public.course_coupons 
ADD COLUMN IF NOT EXISTS starts_at timestamp with time zone DEFAULT now();

COMMENT ON COLUMN public.course_coupons.starts_at IS 'The date and time when this coupon becomes active.';
