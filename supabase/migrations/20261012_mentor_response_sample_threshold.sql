drop view if exists public.mentor_response_metrics_view;
create view public.mentor_response_metrics_view with (security_barrier = true) as
with first_student_message as (
 select booking_id, min(created_at) as first_student_at
 from public.mentorship_booking_messages
 where sender_role = 'student'
 group by booking_id
),
booking_response as (
 select s.mentor_id,
        extract(epoch from (mentor_reply.first_mentor_at - student.first_student_at))::numeric as response_seconds
 from public.mentorship_sessions s
 join first_student_message student on student.booking_id = s.id
 join lateral (
   select min(m.created_at) as first_mentor_at
   from public.mentorship_booking_messages m
   where m.booking_id = s.id
     and m.sender_role = 'mentor'
     and m.created_at > student.first_student_at
 ) mentor_reply on mentor_reply.first_mentor_at is not null
 where s.mentor_id is not null
)
select mentor_id,
       percentile_cont(0.5) within group (order by response_seconds)::numeric as typical_response_time_seconds,
       count(*)::bigint as response_sample_count
from booking_response
where response_seconds >= 0
group by mentor_id;
grant select on public.mentor_response_metrics_view to anon, authenticated;