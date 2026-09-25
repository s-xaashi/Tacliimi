
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

    const { course_id, lesson_id, delete_type = 'lesson' } = await req.json();

    if (!course_id) {
      throw new Error('Missing course_id');
    }

    // Verify course ownership
    const { data: course, error: courseError } = await supabase
      .from('courses')
      .select('instructor_id, intro_video_storage_key')
      .eq('id', course_id)
      .single();

    if (courseError || !course) throw new Error('Course not found');
    if (course.instructor_id !== user.id) throw new Error('Not authorized for this course');

    let objectKey = null;
    let mediaAssetId = null;

    if (delete_type === 'intro') {
      objectKey = course.intro_video_storage_key;
      // Intros might not have media_asset_id linked directly yet
    } else {
      if (!lesson_id) throw new Error('Missing lesson_id');
      const { data: lesson, error } = await supabase
        .from('course_lessons')
        .select('video_storage_key, media_asset_id')
        .eq('id', lesson_id)
        .single();
      if (error || !lesson) throw new Error('Lesson not found');
      
      objectKey = lesson.video_storage_key;
      mediaAssetId = lesson.media_asset_id;
    }

    if (!objectKey) {
      return new Response(JSON.stringify({ success: true, message: 'No R2 video found to delete' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

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

    // Update database
    if (delete_type === 'intro') {
      await supabase.from('courses').update({
        intro_video_provider: 'youtube',
        intro_video_storage_key: null
      }).eq('id', course_id);
    } else {
      await supabase.from('course_lessons').update({
        video_provider: 'youtube',
        video_storage_key: null,
        media_asset_id: null
      }).eq('id', lesson_id);

      if (mediaAssetId) {
        await supabase.from('course_media_assets').delete().eq('id', mediaAssetId);
      }
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
