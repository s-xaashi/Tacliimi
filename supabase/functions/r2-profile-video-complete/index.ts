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

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (userError || !user) throw new Error('Invalid token');

    const { upload_id, object_key, parts } = await req.json();

    if (!upload_id || !object_key || !Array.isArray(parts)) {
      throw new Error('Missing required fields: upload_id, object_key, parts');
    }

    // Ownership check
    const expectedPrefix = `instructors/${user.id}/intro/`;
    if (!object_key.startsWith(expectedPrefix)) {
      throw new Error('Not authorized for this object');
    }

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
        Parts: parts.sort((a: any, b: any) => a.PartNumber - b.PartNumber),
      },
    });

    await s3Client.send(command);

    // NOTE: No DB write here. The client saves the objectKey to teaching_profiles
    // only when the user explicitly clicks "Save Changes" — preventing junk saves.
    return new Response(
      JSON.stringify({ success: true, objectKey: object_key }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
