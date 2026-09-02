
import { createClient } from "jsr:@supabase/supabase-js@2";
import { S3Client, AbortMultipartUploadCommand } from "npm:@aws-sdk/client-s3";

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

    const { course_id, upload_id, object_key } = await req.json();

    if (!course_id || !upload_id || !object_key) {
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

    const command = new AbortMultipartUploadCommand({
      Bucket: Deno.env.get('R2_BUCKET_NAME') ?? '',
      Key: object_key,
      UploadId: upload_id,
    });

    await s3Client.send(command);

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
