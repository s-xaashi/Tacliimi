
import { createClient } from "jsr:@supabase/supabase-js@2";
import { S3Client, GetObjectCommand } from "npm:@aws-sdk/client-s3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner";

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

    const { course_id, lesson_id, playback_type = 'lesson' } = await req.json();

    if (!course_id) {
      throw new Error('Missing course_id');
    }

    let objectKey = null;

    if (playback_type === 'intro') {
      const { data: course, error } = await supabase
        .from('courses')
        .select('intro_video_storage_key')
        .eq('id', course_id)
        .single();
        
      if (error || !course?.intro_video_storage_key) throw new Error('Intro video not found');
      objectKey = course.intro_video_storage_key;
    } else {
      if (!lesson_id) throw new Error('Missing lesson_id');
      
      const { data: lesson, error } = await supabase
        .from('course_lessons')
        .select('video_storage_key, is_preview')
        .eq('id', lesson_id)
        .single();
        
      if (error || !lesson?.video_storage_key) throw new Error('Lesson video not found');
      objectKey = lesson.video_storage_key;

      if (!lesson.is_preview) {
        // Enforce authorization for non-preview lessons:
        // Must be instructor of course OR enrolled student OR admin
        const { data: course } = await supabase.from('courses').select('instructor_id').eq('id', course_id).single();
        const isInstructor = course?.instructor_id === user.id;

        const { data: admin } = await supabase.from('admin_auth').select('id').eq('id', user.id).maybeSingle();
        const isAdmin = !!admin;

        const { data: enrollment } = await supabase.from('enrollments').select('id').eq('student_id', user.id).eq('course_id', course_id).maybeSingle();
        const isEnrolled = !!enrollment;

        if (!isInstructor && !isAdmin && !isEnrolled) {
          throw new Error('Not authorized to view this lesson');
        }
      }
    }

    if (!objectKey) throw new Error('Could not resolve object key');

    const s3Client = new S3Client({
      region: 'auto',
      endpoint: Deno.env.get('R2_ENDPOINT') ?? '',
      credentials: {
        accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID') ?? '',
        secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '',
      },
    });

    const command = new GetObjectCommand({
      Bucket: Deno.env.get('R2_BUCKET_NAME') ?? '',
      Key: objectKey,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return new Response(JSON.stringify({ playbackUrl: url }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
