create or replace view public.public_course_review_display
with (security_invoker = false)
as
select
    cr.id as review_id,
    cr.course_id,
    cr.student_id,
    p.full_name,
    p.avatar_url
from public.course_reviews cr
join public.courses c on c.id = cr.course_id
left join public.profiles p on p.id = cr.student_id
where c.status = 'published'
  and c.deleted_at is null
  and c.is_public is true
  and c.is_latest_published is true
  and c.version_status = 'published';

revoke all on public.public_course_review_display from public;
grant select on public.public_course_review_display to anon, authenticated;
