-- Return only the active enrollment total for a currently public course.
-- This narrow aggregate avoids exposing enrollment rows while allowing the
-- same public count to be displayed under anon/authenticated RLS contexts.

create or replace function public.get_public_course_enrollment_count(p_course_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $function$
    select count(distinct e.student_id)::bigint
    from public.courses c
    join public.enrollments e
      on e.course_id = c.id
     and e.status = 'active'
    where c.id = p_course_id
      and c.status = 'published'
      and c.deleted_at is null
      and c.is_public is true
      and c.is_latest_published is true
      and c.version_status = 'published';
$function$;

revoke all on function public.get_public_course_enrollment_count(uuid) from public;
grant execute on function public.get_public_course_enrollment_count(uuid) to anon, authenticated;
