-- Preserve private R2 course media when a published course is cloned into a revision.
-- Thumbnail keys are shared only inside one course family; r2-image-url and
-- r2-image-delete validate that family relationship before signing or deleting.

-- Repair revisions created before this migration. Never overwrite an existing
-- revision asset; use only the family's currently published version as source.
update public.courses as target
set thumbnail_storage_key = source.thumbnail_storage_key
from public.courses as source
where coalesce(target.root_course_id, target.id) = coalesce(source.root_course_id, source.id)
  and target.instructor_id = source.instructor_id
  and target.id <> source.id
  and target.deleted_at is null
  and target.version_status in ('draft', 'pending_review', 'rejected')
  and target.thumbnail_storage_key is null
  and source.is_latest_published = true
  and source.thumbnail_storage_key is not null;

update public.courses as target
set
  intro_video_provider = source.intro_video_provider,
  intro_video_storage_key = source.intro_video_storage_key
from public.courses as source
where coalesce(target.root_course_id, target.id) = coalesce(source.root_course_id, source.id)
  and target.instructor_id = source.instructor_id
  and target.id <> source.id
  and target.deleted_at is null
  and target.version_status in ('draft', 'pending_review', 'rejected')
  and target.intro_video_storage_key is null
  and source.is_latest_published = true
  and source.intro_video_storage_key is not null;

create or replace function public.get_or_create_course_revision(p_course_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_family_id      uuid;
  v_root_id        uuid;
  v_next_version   integer;
  v_new_course_id  uuid;
  v_old_section_id uuid;
  v_new_section_id uuid;
  v_old_lesson_id  uuid;
  v_new_lesson_id  uuid;
  v_old_quiz_id    uuid;
  v_new_quiz_id    uuid;
  v_old_q_id       uuid;
  v_new_q_id       uuid;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized: authentication required';
  end if;

  -- The requested course must belong to the authenticated instructor.
  select coalesce(root_course_id, id)
    into v_family_id
  from public.courses
  where id = p_course_id
    and instructor_id = auth.uid();

  if v_family_id is null then
    raise exception 'Unauthorized: course does not belong to the current user';
  end if;

  -- Reuse an existing uncommitted revision in this family.
  select id into v_new_course_id
  from public.courses
  where coalesce(root_course_id, id) = v_family_id
    and instructor_id = auth.uid()
    and version_status in ('draft', 'pending_review', 'rejected')
  limit 1;

  if v_new_course_id is not null then
    return v_new_course_id;
  end if;

  -- Clone the latest published version.
  select id into v_root_id
  from public.courses
  where coalesce(root_course_id, id) = v_family_id
    and instructor_id = auth.uid()
    and is_latest_published = true
  limit 1;

  if v_root_id is null then
    raise exception 'No published version found for course family %', v_family_id;
  end if;

  select coalesce(max(version_number), 1) + 1 into v_next_version
  from public.courses
  where coalesce(root_course_id, id) = v_family_id
    and instructor_id = auth.uid();

  insert into public.courses (
    instructor_id, title, slug, description, thumbnail_url, thumbnail_storage_key, price,
    status, subtitle, category_id, level, intro_video_url, intro_video_provider,
    intro_video_storage_key, price_type, currency, is_public, total_duration_minutes,
    root_course_id, version_number, is_latest_published, version_status
  )
  select
    instructor_id, title, slug || '-rev-' || v_next_version,
    description, thumbnail_url, thumbnail_storage_key, price,
    'draft'::course_status,
    subtitle, category_id, level, intro_video_url, intro_video_provider,
    intro_video_storage_key, price_type, currency, is_public, total_duration_minutes,
    v_family_id, v_next_version, false, 'draft'
  from public.courses
  where id = v_root_id
  returning id into v_new_course_id;

  for v_old_section_id in
    select id
    from public.course_sections
    where course_id = v_root_id and deleted_at is null
    order by order_index
  loop
    insert into public.course_sections (course_id, title, order_index)
    select v_new_course_id, title, order_index
    from public.course_sections
    where id = v_old_section_id
    returning id into v_new_section_id;

    for v_old_lesson_id in
      select id
      from public.course_lessons
      where section_id = v_old_section_id and deleted_at is null
      order by order_index
    loop
      insert into public.course_lessons (
        section_id, title, video_url, is_preview, order_index,
        content_type, description, media_asset_id
      )
      select
        v_new_section_id, title, video_url, is_preview, order_index,
        content_type, description, media_asset_id
      from public.course_lessons
      where id = v_old_lesson_id
      returning id into v_new_lesson_id;

      insert into public.lesson_resources (lesson_id, title, file_url, file_type)
      select v_new_lesson_id, title, file_url, file_type
      from public.lesson_resources
      where lesson_id = v_old_lesson_id;

      for v_old_quiz_id in
        select id from public.quizzes where lesson_id = v_old_lesson_id
      loop
        insert into public.quizzes (lesson_id, title, description, passing_score_percentage)
        select v_new_lesson_id, title, description, passing_score_percentage
        from public.quizzes
        where id = v_old_quiz_id
        returning id into v_new_quiz_id;

        for v_old_q_id in
          select id
          from public.quiz_questions
          where quiz_id = v_old_quiz_id
          order by order_index
        loop
          insert into public.quiz_questions (quiz_id, question_text, order_index)
          select v_new_quiz_id, question_text, order_index
          from public.quiz_questions
          where id = v_old_q_id
          returning id into v_new_q_id;

          insert into public.quiz_options (question_id, option_text, is_correct, order_index)
          select v_new_q_id, option_text, is_correct, order_index
          from public.quiz_options
          where question_id = v_old_q_id;
        end loop;
      end loop;
    end loop;
  end loop;

  insert into public.course_coupons (
    course_id, code, discount_percent, is_active, expires_at, starts_at, coupon_type
  )
  select v_new_course_id, code, discount_percent, is_active, expires_at, starts_at, 'general'
  from public.course_coupons
  where course_id = v_root_id and coupon_type = 'general';

  return v_new_course_id;
end;
$function$;
