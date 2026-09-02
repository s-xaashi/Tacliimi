
import { createClient } from "jsr:@supabase/supabase-js@2";
import { S3Client, UploadPartCommand } from "npm:@aws-sdk/client-s3";
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

    const { course_id, upload_id, object_key, part_numbers } = await req.json();

    if (!course_id || !upload_id || !object_key || !Array.isArray(part_numbers)) {
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

    const bucketName = Deno.env.get('R2_BUCKET_NAME') ?? '';
    const presignedUrls = [];

    // Generate presigned URLs for each part concurrently
    const promises = part_numbers.map(async (partNumber) => {
      const command = new UploadPartCommand({
        Bucket: bucketName,
        Key: object_key,
        UploadId: upload_id,
        PartNumber: partNumber,
      });

      const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
      return { partNumber, url };
    });

    const results = await Promise.all(promises);

    return new Response(JSON.stringify({ presignedUrls: results }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
