-- ========================================================
-- Migration: Create Mentor Wishlist
-- Run this in your Supabase SQL Editor
-- ========================================================

CREATE TABLE IF NOT EXISTS public.mentor_wishlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(mentor_id, student_id)
);

-- Enable RLS
ALTER TABLE public.mentor_wishlist ENABLE ROW LEVEL SECURITY;

-- PostgREST RLS Policies
CREATE POLICY "Students can view their own mentor wishlist"
    ON public.mentor_wishlist FOR SELECT
    USING (auth.uid() = student_id);

CREATE POLICY "Students can add to mentor wishlist"
    ON public.mentor_wishlist FOR INSERT
    WITH CHECK (auth.uid() = student_id);

CREATE POLICY "Students can remove from mentor wishlist"
    ON public.mentor_wishlist FOR DELETE
    USING (auth.uid() = student_id);
