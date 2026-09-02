
import { createClient } from "jsr:@supabase/supabase-js@2";
import { S3Client, CompleteMultipartUploadCommand } from "npm:@aws-sdk/client-s3";

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

    const { course_id, lesson_id, type = 'lesson', upload_id, object_key, parts, file_size } = await req.json();

    if (!course_id || !upload_id || !object_key || !Array.isArray(parts)) {
      throw new Error('Missing required fields');
    }

    // Verify course ownership
    const { data: course, error: courseError } = await supabase
      .from('courses')
      .select('instructor_id')
      .eq('id', course_id)
      .single();

    if (courseError || !course) throw new Error('Course not found');
    if (course.instructor_id !== user.id) throw new Error('Not authorized for this course');

    const s3Client = new S3Client({
      region: 'auto',
      endpoint: Deno.env.get('R2_ENDPOINT') ?? '',
      credentials: {
        accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID') ?? '',
        secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '',
      },
    });

    const command = new CompleteMultipartUploadCommand({
      Bucket: Deno.env.get('R2_BUCKET_NAME') ?? '',
      Key: object_key,
      UploadId: upload_id,
      MultipartUpload: {
        Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber),
      },
    });

    await s3Client.send(command);

    // Save to database
    let mediaAssetId = null;

    // Create course_media_assets record
    const { data: asset, error: assetError } = await supabase
      .from('course_media_assets')
      .insert({
        storage_provider: 'r2',
        storage_path: object_key,
        file_size_bytes: file_size || 0
      })
      .select()
      .single();

    if (assetError) throw assetError;
    mediaAssetId = asset.id;

    if (type === 'intro') {
      const { error: updateError } = await supabase
        .from('courses')
        .update({
          intro_video_provider: 'r2',
          intro_video_storage_key: object_key
        })
        .eq('id', course_id);
      if (updateError) throw updateError;
    } else {
      if (!lesson_id) throw new Error('Missing lesson_id');
      const { error: updateError } = await supabase
        .from('course_lessons')
        .update({
          video_provider: 'r2',
          video_storage_key: object_key,
          media_asset_id: mediaAssetId
        })
        .eq('id', lesson_id)
        .eq('section_id', (await supabase.from('course_sections').select('id').eq('course_id', course_id).limit(1)).data?.[0]?.id ?? ''); // Using robust schema relation or trusting the instructor
        
      if (updateError) throw updateError;
    }

    return new Response(JSON.stringify({ success: true, objectKey: object_key }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
