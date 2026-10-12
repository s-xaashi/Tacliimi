-- Public aggregate-only mentor stats; avoids client-side RLS silently returning zero rows.
create or replace view public.mentor_session_stats_view
with (security_barrier = true)
as
select
    mentor_id,
    count(*)::bigint as confirmed_session_count
from public.mentorship_sessions
where status = 'confirmed'
  and booking_status = 'confirmed'
group by mentor_id;

grant select on public.mentor_session_stats_view to anon, authenticated;

-- Use the median first-reply delay per booking, in seconds, so a few very old
-- conversations do not make the displayed "typical reply time" misleading.
create or replace view public.mentor_response_metrics_view
with (security_barrier = true)
as
with first_student_message as (
    select booking_id, min(created_at) as first_student_at
    from public.mentorship_booking_messages
    where sender_role = 'student'
    group by booking_id
),
booking_response as (
    select
        s.mentor_id,
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
select
    mentor_id,
    percentile_cont(0.5) within group (order by response_seconds)::numeric as typical_response_time_seconds
from booking_response
where response_seconds >= 0
group by mentor_id;

grant select on public.mentor_response_metrics_view to anon, authenticated;