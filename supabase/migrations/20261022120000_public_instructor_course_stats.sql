-- Public-facing instructor statistics.
-- Only counts public, latest published, non-deleted course families and active students.
create or replace function public.get_public_instructor_course_stats(p_instructor_id uuid)
returns table(total_courses bigint, total_students bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
    with public_courses as (
        select
            c.id,
            coalesce(c.root_course_id, c.id) as family_id
        from public.courses c
        where c.instructor_id = p_instructor_id
          and c.status = 'published'
          and c.deleted_at is null
          and c.is_public is true
          and c.is_latest_published is true
          and c.version_status = 'published'
    )
    select
        (select count(distinct pc.family_id) from public_courses pc) as total_courses,
        (
            select count(distinct e.student_id)
            from public.enrollments e
            join public_courses pc on pc.id = e.course_id
            where e.status = 'active'
        ) as total_students;
$function$;

-- This function exposes aggregate counts only, not enrollment rows or student identities.
revoke all on function public.get_public_instructor_course_stats(uuid) from public;
grant execute on function public.get_public_instructor_course_stats(uuid) to anon, authenticated;
