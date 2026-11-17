
import { createClient } from "jsr:@supabase/supabase-js@2";
import { S3Client, DeleteObjectCommand } from "npm:@aws-sdk/client-s3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function hasLessonReferences(supabase: any, objectKey: string) {
  const [directRefs, assets] = await Promise.all([
    supabase.from('course_lessons').select('id').eq('video_storage_key', objectKey),
    supabase.from('course_media_assets').select('id').eq('storage_path', objectKey),
  ]);
  if (directRefs.error) throw directRefs.error;
  if (assets.error) throw assets.error;
  const assetIds = (assets.data || []).map((asset: any) => asset.id);
  if (!assetIds.length) return (directRefs.data || []).length > 0;
  const { data: assetRefs, error: assetRefError } = await supabase
    .from('course_lessons').select('id').in('media_asset_id', assetIds);
  if (assetRefError) throw assetRefError;
  return (directRefs.data || []).length > 0 || (assetRefs || []).length > 0;
}

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
      if (!objectKey) {
        return new Response(JSON.stringify({ success: true, message: 'No R2 video found to delete' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (requestedObjectKey) {
        const keyMatch = String(requestedObjectKey).match(/^courses\/([a-f0-9-]+)\/introduction\/[a-f0-9-]+\.mp4$/i);
        if (!keyMatch) throw new Error('Invalid introduction object key');
        const { data: sourceCourse, error: sourceError } = await supabase.from('courses')
          .select('id, instructor_id, root_course_id').eq('id', keyMatch[1]).maybeSingle();
        if (sourceError) throw sourceError;
        if (!sourceCourse || sourceCourse.instructor_id !== user.id ||
            (sourceCourse.root_course_id || sourceCourse.id) !== (course.root_course_id || course_id)) {
          throw new Error('Introduction object does not belong to this course family');
        }
      } else {
        // Clear this version's pointer before checking whether another version
        // still references the object.
        const { error: updateError } = await supabase.from('courses').update({
          intro_video_provider: 'youtube',
          intro_video_storage_key: null
        }).eq('id', course_id).eq('intro_video_storage_key', objectKey);
        if (updateError) throw updateError;
      }

      const { data: introReferences, error: referenceError } = await supabase
        .from('courses').select('id, instructor_id, root_course_id')
        .eq('intro_video_storage_key', objectKey);
      if (referenceError) throw referenceError;
      const invalidReference = (introReferences || []).some(reference =>
        reference.instructor_id !== user.id ||
        (reference.root_course_id || reference.id) !== (course.root_course_id || course_id)
      );
      if (invalidReference) throw new Error('Introduction object is referenced outside this course family');
      preserveSharedIntro = Boolean(introReferences?.length);
    } else {
      if (!lesson_id) throw new Error('Missing lesson_id');
      const { data: lesson, error } = await supabase
        .from('course_lessons')
        .select('section_id, video_storage_key, media_asset_id')
        .eq('id', lesson_id)
        .maybeSingle();
      if (error) throw error;

      if (lesson) {
        const { data: section, error: sectionError } = await supabase
          .from('course_sections')
          .select('id')
          .eq('id', lesson.section_id)
          .eq('course_id', course_id)
          .maybeSingle();
        if (sectionError || !section) throw new Error('Lesson does not belong to this course');
        mediaAssetId = lesson.media_asset_id;
      } else if (!requestedObjectKey) {
        throw new Error('Lesson not found');
      }

      let linkedAsset = null;
      if (lesson?.media_asset_id) {
        const { data: asset, error: assetError } = await supabase.from('course_media_assets')
          .select('id, storage_path').eq('id', lesson.media_asset_id).maybeSingle();
        if (assetError) throw assetError;
        linkedAsset = asset;
      }
      objectKey = requestedObjectKey || lesson?.video_storage_key || linkedAsset?.storage_path;

      if (!objectKey) {
        return new Response(JSON.stringify({ success: true, message: 'No R2 video found to delete' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (requestedObjectKey) {
        // A replacement can refer to the prior version's lesson key. Prove that
        // source lesson and course belong to the same instructor/course family.
        const keyMatch = String(requestedObjectKey).match(/^courses\/([a-f0-9-]+)\/lessons\/([a-f0-9-]+)\/video\/[a-f0-9-]+\.mp4$/i);
        if (!keyMatch) throw new Error('Invalid lesson video object key');
        const { data: sourceCourse, error: sourceCourseError } = await supabase.from('courses')
          .select('id, instructor_id, root_course_id').eq('id', keyMatch[1]).maybeSingle();
        if (sourceCourseError) throw sourceCourseError;
        if (!sourceCourse || sourceCourse.instructor_id !== user.id ||
            (sourceCourse.root_course_id || sourceCourse.id) !== (course.root_course_id || course_id)) {
          throw new Error('Lesson video does not belong to this course family');
        }
        const { data: sourceLesson, error: sourceLessonError } = await supabase.from('course_lessons')
          .select('id, course_sections!inner(course_id)')
          .eq('id', keyMatch[2]).eq('course_sections.course_id', keyMatch[1]).maybeSingle();
        if (sourceLessonError) throw sourceLessonError;
        if (!sourceLesson) throw new Error('Source lesson for this video key could not be verified');
      } else {
        // Detach only the current lesson. A cloned version may share its media
        // asset ID, so object deletion waits for the global reference check below.
        const { error: lessonUpdateError } = await supabase.from('course_lessons').update({
          video_provider: 'youtube',
          video_storage_key: null,
          media_asset_id: null
        }).eq('id', lesson_id);
        if (lessonUpdateError) throw lessonUpdateError;
      }

      preserveSharedIntro = await hasLessonReferences(supabase, objectKey);
      if (!preserveSharedIntro) {
        const { error: assetDeleteError } = await supabase.from('course_media_assets')
          .delete().eq('storage_path', objectKey);
        if (assetDeleteError) throw assetDeleteError;
      }
    }

    if (!preserveSharedIntro) {
      const endpoint = Deno.env.get('R2_ENDPOINT') ?? '';
      const bucket = Deno.env.get('R2_BUCKET_NAME') ?? '';
      const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID') ?? '';
      const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '';
      if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
        throw new Error('Private R2 configuration is incomplete');
      }
      const s3Client = new S3Client({
        region: 'auto', endpoint,
        credentials: { accessKeyId, secretAccessKey },
      });
      await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
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
