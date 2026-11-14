
import { createClient } from "jsr:@supabase/supabase-js@2";
import { S3Client, DeleteObjectCommand } from "npm:@aws-sdk/client-s3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (userError || !user) throw new Error('Invalid token');

    const { course_id, lesson_id, delete_type = 'lesson', object_key: requestedObjectKey = null } = await req.json();

    if (!course_id) {
      throw new Error('Missing course_id');
    }

    // Verify course ownership
    const { data: course, error: courseError } = await supabase
      .from('courses')
      .select('instructor_id, intro_video_storage_key, root_course_id')
      .eq('id', course_id)
      .single();

    if (courseError || !course) throw new Error('Course not found');
    if (course.instructor_id !== user.id) throw new Error('Not authorized for this course');

    let objectKey = null;
    let mediaAssetId = null;
    let preserveSharedIntro = false;

    if (delete_type === 'intro') {
      objectKey = requestedObjectKey || course.intro_video_storage_key;
      if (requestedObjectKey) {
        // Replacement cleanup may target an old key after the course row already
        // points at its new upload. Restrict that request to this course family's
        // own introduction namespace; callers cannot delete arbitrary bucket keys.
        const familyId = course.root_course_id || course_id;
        const keyMatch = typeof requestedObjectKey === 'string'
          ? requestedObjectKey.match(/^courses\/([a-f0-9-]+)\/introduction\/[a-f0-9-]+\.mp4$/i)
          : null;
        if (!keyMatch) throw new Error('Invalid introduction object key');
        const { data: sourceCourse, error: sourceCourseError } = await supabase
          .from('courses')
          .select('id, instructor_id, root_course_id')
          .eq('id', keyMatch[1])
          .maybeSingle();
        if (sourceCourseError) throw sourceCourseError;
        if (!sourceCourse || sourceCourse.instructor_id !== user.id ||
            (sourceCourse.root_course_id || sourceCourse.id) !== familyId) {
          throw new Error('Introduction object does not belong to this course family');
        }
      }
      if (objectKey) {
        // Service-role client sees every revision, including archived versions,
        // so a shared object is never removed while any course still references it.
        const { data: introReferences, error: referenceError } = await supabase
          .from('courses')
          .select('id, instructor_id, root_course_id')
          .eq('intro_video_storage_key', objectKey);
        if (referenceError) throw referenceError;
        const invalidReference = (introReferences || []).some(reference =>
          reference.instructor_id !== user.id ||
          (reference.root_course_id || reference.id) !== (course.root_course_id || course_id)
        );
        if (invalidReference) throw new Error('Introduction object is referenced outside this course family');
        preserveSharedIntro = Boolean(introReferences?.length);
      }
      // When object_key is explicitly supplied, this is post-save replacement
      // cleanup only: do not change the course's current provider or storage key.
    } else {
      if (!lesson_id) throw new Error('Missing lesson_id');
      const { data: lesson, error } = await supabase
        .from('course_lessons')
        .select('section_id, video_storage_key, media_asset_id')
        .eq('id', lesson_id)
        .single();
      if (error || !lesson) throw new Error('Lesson not found');

      // Ensure the lesson belongs to the course whose ownership was verified above.
      const { data: section, error: sectionError } = await supabase
        .from('course_sections')
        .select('id')
        .eq('id', lesson.section_id)
        .eq('course_id', course_id)
        .maybeSingle();
      if (sectionError || !section) throw new Error('Lesson does not belong to this course');

      objectKey = lesson.video_storage_key;
      mediaAssetId = lesson.media_asset_id;
    }

    if (!objectKey) {
      return new Response(JSON.stringify({ success: true, message: 'No R2 video found to delete' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!preserveSharedIntro) {
      const s3Client = new S3Client({
        region: 'auto',
        endpoint: Deno.env.get('R2_ENDPOINT') ?? '',
        credentials: {
          accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID') ?? '',
          secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '',
        },
      });

      const command = new DeleteObjectCommand({
        Bucket: Deno.env.get('R2_BUCKET_NAME') ?? '',
        Key: objectKey,
      });

      await s3Client.send(command);
    }

    // Only the normal "remove intro" action clears the current course pointer.
    // Replacement cleanup supplies object_key and must leave the newly saved key intact.
    if (delete_type === 'intro' && !requestedObjectKey) {
      const { error: introUpdateError } = await supabase.from('courses').update({
        intro_video_provider: 'youtube',
        intro_video_storage_key: null
      }).eq('id', course_id).eq('intro_video_storage_key', objectKey);
      if (introUpdateError) throw introUpdateError;
    } else if (delete_type !== 'intro') {
      const { error: lessonUpdateError } = await supabase.from('course_lessons').update({
        video_provider: 'youtube',
        video_storage_key: null,
        media_asset_id: null
      }).eq('id', lesson_id);
      if (lessonUpdateError) throw lessonUpdateError;

      if (mediaAssetId) {
        const { error: assetDeleteError } = await supabase.from('course_media_assets').delete().eq('id', mediaAssetId);
        if (assetDeleteError) throw assetDeleteError;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      deleted: !preserveSharedIntro,
      preservedSharedObject: preserveSharedIntro,
      reason: preserveSharedIntro ? 'still_referenced_by_course_version' : null
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
