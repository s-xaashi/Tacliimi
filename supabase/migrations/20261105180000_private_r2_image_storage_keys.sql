-- Store private R2 object keys separately from legacy image URLs.
-- Existing avatar_url and thumbnail_url values remain untouched for backwards compatibility.
alter table public.profiles
  add column if not exists avatar_storage_key text;

alter table public.courses
  add column if not exists thumbnail_storage_key text;

comment on column public.profiles.avatar_storage_key is
  'Opaque object key for an avatar stored in the private media bucket; never a public URL.';

comment on column public.courses.thumbnail_storage_key is
  'Opaque object key for a course thumbnail stored in the private media bucket; never a public URL.';


-- Phase 2 image-key projections.
-- Keep the existing public visibility predicates and result shapes intact;
-- append opaque R2 keys so clients can request short-lived URLs through the
-- authorization-checked r2-image-url function.

create or replace view public.course_marketplace_view as
select
    c.id,
    c.instructor_id,
    c.title,
    coalesce(root.slug, c.slug) as slug,
    c.description,
    c.thumbnail_url,
    c.price,
    c.status,
    c.created_at,
    c.updated_at,
    c.deleted_at,
    c.subtitle,
    c.category_id,
    c.level,
    c.intro_video_url,
    c.price_type,
    c.currency,
    c.is_public,
    c.total_duration_minutes,
    coalesce(c.root_course_id, c.id) as family_id,
    c.version_number,
    p.full_name as instructor_name,
    p.avatar_url as instructor_avatar,
    cc.name as category_name,
    coalesce(fam_agg.avg_rating, 0::numeric) as average_rating,
    coalesce(fam_agg.review_count, 0::bigint) as review_count,
    coalesce(fam_agg.enrollments_count, 0::bigint) as enrollments_count,
    coalesce(l.lessons_count, 0::bigint) as total_lessons,
    coalesce(q.quizzes_count, 0::bigint) as total_quizzes,
    coalesce(res.resources_count, 0::bigint) as total_resources,
    c.thumbnail_storage_key,
    p.avatar_storage_key as instructor_avatar_storage_key
from courses c
join profiles p on c.instructor_id = p.id
join instructors i on c.instructor_id = i.user_id
left join course_categories cc on c.category_id = cc.id
left join courses root on root.id = c.root_course_id
left join (
    select
        coalesce(c2.root_course_id, c2.id) as family_id,
        avg(cr.rating)::numeric(3,1) as avg_rating,
        count(distinct cr.id) as review_count,
        count(distinct e.id) as enrollments_count
    from courses c2
    left join course_reviews cr on cr.course_id = c2.id
    left join enrollments e on e.course_id = c2.id
    group by coalesce(c2.root_course_id, c2.id)
) fam_agg on fam_agg.family_id = coalesce(c.root_course_id, c.id)
left join (
    select s.course_id, count(ls.id) as lessons_count
    from course_sections s
    join course_lessons ls on ls.section_id = s.id
    where ls.deleted_at is null
    group by s.course_id
) l on l.course_id = c.id
left join (
    select s.course_id, count(qz.id) as quizzes_count
    from course_sections s
    join course_lessons ls on ls.section_id = s.id
    join quizzes qz on qz.lesson_id = ls.id
    where ls.deleted_at is null
    group by s.course_id
) q on q.course_id = c.id
left join (
    select s.course_id, count(rs.id) as resources_count
    from course_sections s
    join course_lessons ls on ls.section_id = s.id
    join lesson_resources rs on rs.lesson_id = ls.id
    where ls.deleted_at is null
    group by s.course_id
) res on res.course_id = c.id
where c.is_latest_published = true
  and c.deleted_at is null
  and i.approval_status = 'approved'
  and p.account_status = 'active';

create or replace view public.mentor_profile_reviews_view as
select
    r.id,
    r.mentor_id,
    r.rating,
    r.comment,
    r.created_at,
    p.full_name,
    p.avatar_url,
    p.avatar_storage_key,
    r.student_id
from mentorship_reviews r
left join profiles p on r.student_id = p.id;

create or replace view public.public_course_review_display
with (security_invoker = false)
as
select
    cr.id as review_id,
    cr.course_id,
    cr.student_id,
    p.full_name,
    p.avatar_url,
    p.avatar_storage_key
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

create or replace function public.get_pending_courses_admin()
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    courses_data json;
begin
    if not exists (
        select 1
        from public.admin_auth
        where id = auth.uid()
          and coalesce(is_suspended, false) = false
    ) then
        raise exception 'Unauthorized: Not a valid admin';
    end if;

    select json_agg(c)
    into courses_data
    from (
        select
            co.id,
            co.title,
            co.subtitle,
            co.thumbnail_url,
            co.thumbnail_storage_key,
            co.category_id,
            co.level,
            co.created_at,
            co.instructor_id,
            co.root_course_id,
            co.version_number,
            co.version_status,
            co.rejection_reason,
            (co.root_course_id is not null) as is_revision,
            json_build_object(
                'id', p.id,
                'full_name', p.full_name,
                'email', p.email,
                'avatar_url', p.avatar_url,
                'avatar_storage_key', p.avatar_storage_key
            ) as instructor,
            json_build_object('name', cat.name) as category
        from courses co
        left join profiles p on co.instructor_id = p.id
        left join course_categories cat on co.category_id = cat.id
        where co.status = 'pending_review'
        order by co.created_at desc
    ) c;

    return coalesce(courses_data, '[]'::json);
end;
$function$;

create or replace function public.get_course_details_admin(p_course_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_course_data jsonb;
begin
    if not exists (
        select 1
        from public.admin_auth
        where id = auth.uid()
          and coalesce(is_suspended, false) = false
    ) then
        raise exception 'Unauthorized: Not a valid admin';
    end if;

    select jsonb_build_object(
        'id', c.id,
        'title', c.title,
        'subtitle', c.subtitle,
        'description', c.description,
        'thumbnail_url', c.thumbnail_url,
        'thumbnail_storage_key', c.thumbnail_storage_key,
        'price', c.price,
        'price_type', c.price_type,
        'currency', c.currency,
        'status', c.status,
        'is_public', c.is_public,
        'intro_video_url', c.intro_video_url,
        'intro_video_provider', c.intro_video_provider,
        'intro_video_storage_key', c.intro_video_storage_key,
        'created_at', c.created_at,
        'updated_at', c.updated_at,
        'category_id', c.category_id,
        'level', c.level,
        'instructor', jsonb_build_object(
            'id', p.id,
            'full_name', p.full_name,
            'email', p.email,
            'avatar_url', p.avatar_url,
            'avatar_storage_key', p.avatar_storage_key,
            'phone', p.phone_number
        ),
        'category', jsonb_build_object('name', cat.name),
        'sections', (
            select coalesce(jsonb_agg(
                jsonb_build_object(
                    'id', s.id,
                    'title', s.title,
                    'order_index', s.order_index,
                    'lessons', (
                        select coalesce(jsonb_agg(
                            jsonb_build_object(
                                'id', l.id,
                                'title', l.title,
                                'video_url', l.video_url,
                                'video_provider', l.video_provider,
                                'video_storage_key', l.video_storage_key,
                                'content_type', l.content_type,
                                'is_preview', l.is_preview,
                                'description', l.description,
                                'order_index', l.order_index,
                                'lesson_resources', (
                                    select coalesce(jsonb_agg(lr.*), '[]'::jsonb)
                                    from lesson_resources lr
                                    where lr.lesson_id = l.id
                                ),
                                'quizzes', (
                                    select coalesce(jsonb_agg(
                                        jsonb_build_object(
                                            'id', q.id,
                                            'title', q.title,
                                            'description', q.description,
                                            'passing_score_percentage', q.passing_score_percentage,
                                            'questions', (
                                                select coalesce(jsonb_agg(
                                                    jsonb_build_object(
                                                        'id', qq.id,
                                                        'question_text', qq.question_text,
                                                        'order_index', qq.order_index,
                                                        'options', (
                                                            select coalesce(jsonb_agg(qo.*), '[]'::jsonb)
                                                            from quiz_options qo
                                                            where qo.question_id = qq.id
                                                        )
                                                    )
                                                ), '[]'::jsonb)
                                                from quiz_questions qq
                                                where qq.quiz_id = q.id
                                            )
                                        )
                                    ), '[]'::jsonb)
                                    from quizzes q
                                    where q.lesson_id = l.id
                                )
                            )
                        ), '[]'::jsonb)
                        from course_lessons l
                        where l.section_id = s.id
                    )
                )
            ), '[]'::jsonb)
            from course_sections s
            where s.course_id = c.id
        ),
        'moderation_history', (
            select coalesce(jsonb_agg(h.* order by h.created_at desc), '[]'::jsonb)
            from course_moderation_logs h
            where h.course_id = c.id
        )
    )
    into v_course_data
    from courses c
    left join profiles p on c.instructor_id = p.id
    left join course_categories cat on c.category_id = cat.id
    where c.id = p_course_id;

    return v_course_data;
end;
$function$;
