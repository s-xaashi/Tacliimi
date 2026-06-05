-- ========================================================
-- Migration: Create enrollments and wishlist tables
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/akmhxhtzfevmzlqixsct/editor
-- ========================================================

-- 1. Create ENROLLMENTS table
CREATE TABLE IF NOT EXISTS public.enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    progress_percentage INT NOT NULL DEFAULT 0,
    completed_at TIMESTAMPTZ,
    UNIQUE(course_id, student_id)
);

-- 2. Create WISHLIST table
CREATE TABLE IF NOT EXISTS public.wishlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(course_id, student_id)
);

-- 3. Enable RLS
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wishlist ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies for ENROLLMENTS
CREATE POLICY IF NOT EXISTS "Students can view their own enrollments"
    ON public.enrollments FOR SELECT
    USING (auth.uid() = student_id);

CREATE POLICY IF NOT EXISTS "Students can enroll in courses"
    ON public.enrollments FOR INSERT
    WITH CHECK (auth.uid() = student_id);

-- 5. RLS Policies for WISHLIST
CREATE POLICY IF NOT EXISTS "Students can view their own wishlist"
    ON public.wishlist FOR SELECT
    USING (auth.uid() = student_id);

CREATE POLICY IF NOT EXISTS "Students can add to wishlist"
    ON public.wishlist FOR INSERT
    WITH CHECK (auth.uid() = student_id);

CREATE POLICY IF NOT EXISTS "Students can remove from wishlist"
    ON public.wishlist FOR DELETE
    USING (auth.uid() = student_id);
