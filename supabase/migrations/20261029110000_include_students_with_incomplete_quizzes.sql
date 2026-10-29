create or replace function public.get_instructor_course_quiz_analytics(p_course_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
    v_result jsonb;
begin
    if auth.uid() is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;

    if not exists (
        select 1
        from public.courses c
        where c.id = p_course_id
          and c.instructor_id = auth.uid()
          and c.deleted_at is null
          and c.status = 'published'
          and c.is_public is true
          and c.is_latest_published is true
          and c.version_status = 'published'
    ) then
        raise exception 'Course not found or access denied' using errcode = '42501';
    end if;

    with course_quizzes as (
        select q.id, q.title
        from public.quizzes q
        join public.course_lessons cl on cl.id = q.lesson_id and cl.deleted_at is null
        join public.course_sections cs on cs.id = cl.section_id and cs.deleted_at is null
        where cs.course_id = p_course_id
    ),
    question_bank as (
        select qq.id, qq.quiz_id, qq.question_text
        from public.quiz_questions qq
        join course_quizzes cq on cq.id = qq.quiz_id
    ),
    answer_rows as (
        select
            qs.id as submission_id,
            qs.student_id,
            qs.quiz_id,
            qsa.question_id,
            coalesce(qsa.is_correct, false) as is_correct
        from public.quiz_submissions qs
        join course_quizzes cq on cq.id = qs.quiz_id
        join public.quiz_submission_answers qsa on qsa.submission_id = qs.id
        join question_bank qb on qb.id = qsa.question_id and qb.quiz_id = qs.quiz_id
    ),
    attempt_scores as (
        select
            ar.submission_id,
            ar.student_id,
            ar.quiz_id,
            count(*)::integer as answered_count,
            count(*) filter (where ar.is_correct)::integer as correct_count,
            (select count(*)::integer from question_bank qb where qb.quiz_id = ar.quiz_id) as total_question_count,
            round(100.0 * count(*) filter (where ar.is_correct) / nullif(count(*), 0), 2) as score
        from answer_rows ar
        group by ar.submission_id, ar.student_id, ar.quiz_id
    ),
    best_attempt_per_quiz as (
        select distinct on (student_id, quiz_id)
            submission_id, student_id, quiz_id, answered_count, correct_count, total_question_count, score
        from attempt_scores
        where total_question_count > 0
          and answered_count = total_question_count
        order by student_id, quiz_id, score desc, submission_id desc
    ),
    student_score_values as (
        select
            students.student_id,
            coalesce(round(sum(
                (100.0 * bap.correct_count / nullif(bap.total_question_count, 0))
                / nullif((select count(*) from course_quizzes), 0)
            ), 2), 0) as score,
            count(bap.quiz_id)::integer as quizzes_attempted,
            (select count(*) from course_quizzes)::integer as total_quizzes
        from (select distinct student_id from answer_rows) students
        left join best_attempt_per_quiz bap on bap.student_id = students.student_id
        group by students.student_id
    ),
    student_scores as (
        select
            ssv.*,
            dense_rank() over (order by ssv.score desc)::integer as rank
        from student_score_values ssv
    ),
    question_stats as (
        select
            qb.id,
            qb.question_text,
            count(ar.question_id)::integer as response_count,
            count(*) filter (where not ar.is_correct)::integer as failed_count,
            round(100.0 * count(*) filter (where not ar.is_correct) / nullif(count(ar.question_id), 0), 2) as failed_rate
        from question_bank qb
        left join answer_rows ar on ar.question_id = qb.id
        group by qb.id, qb.question_text
        having count(ar.question_id) > 0
    )
    select jsonb_build_object(
        'course_title', (select c.title from public.courses c where c.id = p_course_id),
        'total_course_quizzes', (select count(*) from course_quizzes),
        'overall_performance', coalesce((
            select round(100.0 * sum(correct_count) / nullif(sum(answered_count), 0), 2)
            from best_attempt_per_quiz
        ), 0),
        'unique_students', (select count(distinct student_id) from answer_rows),
        'total_attempts', (select count(distinct submission_id) from attempt_scores),
        'questions_answered', (select count(*) from answer_rows),
        'top_failed_questions', coalesce((
            select jsonb_agg(jsonb_build_object(
                'question_id', qs.id,
                'question_text', qs.question_text,
                'failed_count', qs.failed_count,
                'response_count', qs.response_count,
                'failed_rate', qs.failed_rate
            ) order by qs.failed_rate desc, qs.failed_count desc, qs.question_text)
            from (select * from question_stats order by failed_rate desc, failed_count desc, question_text limit 5) qs
        ), '[]'::jsonb),
        'top_students', coalesce((
            select jsonb_agg(jsonb_build_object(
                'student_id', ranked.student_id,
                'full_name', coalesce(nullif(btrim(p.full_name), ''), 'Student'),
                'avatar_url', p.avatar_url,
                'score', ranked.score,
                'rank', ranked.rank,
                'quizzes_attempted', ranked.quizzes_attempted,
                'total_quizzes', ranked.total_quizzes
            ) order by ranked.score desc, ranked.quizzes_attempted desc, ranked.student_id)
            from (
                select * from student_scores
                order by score desc, quizzes_attempted desc, student_id
                limit 10
            ) ranked
            join public.profiles p on p.id = ranked.student_id
        ), '[]'::jsonb)
    ) into v_result;

    return v_result;
end;
$function$;

revoke all on function public.get_instructor_course_quiz_analytics(uuid) from public;
revoke all on function public.get_instructor_course_quiz_analytics(uuid) from anon;
grant execute on function public.get_instructor_course_quiz_analytics(uuid) to authenticated;
