import { createClient } from "jsr:@supabase/supabase-js@2";
import { S3Client, CreateMultipartUploadCommand } from "npm:@aws-sdk/client-s3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const PART_SIZE = 16 * 1024 * 1024; // 16 MB

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

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (userError || !user) throw new Error('Invalid token');

    const { content_type, file_size } = await req.json();

    if (!content_type || !file_size) {
      throw new Error('Missing required fields: content_type, file_size');
    }

    if (!ALLOWED_TYPES.includes(content_type)) {
      throw new Error('Invalid content type. Only MP4, WebM, and MOV are supported.');
    }

    if (file_size > 200 * 1024 * 1024) {
      throw new Error('File too large. Maximum size is 200 MB.');
    }

    // Build a path scoped to this instructor — prevents cross-user access
    const uuid = crypto.randomUUID();
    const ext = content_type === 'video/webm' ? 'webm' : 'mp4';
    const objectKey = `instructors/${user.id}/intro/${uuid}.${ext}`;

    const partCount = Math.ceil(file_size / PART_SIZE);

    const s3Client = new S3Client({
      region: 'auto',
      endpoint: Deno.env.get('R2_ENDPOINT') ?? '',
      credentials: {
        accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID') ?? '',
        secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '',
      },
    });

    const createCommand = new CreateMultipartUploadCommand({
      Bucket: Deno.env.get('R2_BUCKET_NAME') ?? '',
      Key: objectKey,
      ContentType: content_type,
    });

    const createResponse = await s3Client.send(createCommand);

    return new Response(
      JSON.stringify({
        uploadId: createResponse.UploadId,
        objectKey,
        partCount,
        partSize: PART_SIZE,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
