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

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (userError || !user) throw new Error('Invalid token');

    const { upload_id, object_key, part_numbers } = await req.json();

    if (!upload_id || !object_key || !Array.isArray(part_numbers)) {
      throw new Error('Missing required fields: upload_id, object_key, part_numbers');
    }

    // Ownership check: the object key must be scoped to this user
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
      requestChecksumCalculation: "WHEN_REQUIRED",
    });

    const bucketName = Deno.env.get('R2_BUCKET_NAME') ?? '';

    const presignedUrls = await Promise.all(
      part_numbers.map(async (partNumber: number) => {
        const command = new UploadPartCommand({
          Bucket: bucketName,
          Key: object_key,
          UploadId: upload_id,
          PartNumber: partNumber,
        });
        const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        return { partNumber, url };
      })
    );

    return new Response(
      JSON.stringify({ presignedUrls }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
