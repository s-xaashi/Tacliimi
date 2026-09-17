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

    // Verify token if present (supports anon key or user JWT)
    const token = authHeader.replace('Bearer ', '');
    await supabase.auth.getUser(token);

    const { object_key } = await req.json();

    if (!object_key) {
      throw new Error('Missing required field: object_key');
    }

    // Security check: Only allow fetching intro videos (instructors/*/intro/*)
    // This prevents using this Edge Function to access non-intro objects
    const introKeyRegex = /^instructors\/[^/]+\/intro\/[^/]+$/;
    if (!introKeyRegex.test(object_key)) {
      throw new Error('Not authorized to access this object key');
    }

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
      Key: object_key,
    });

    const playbackUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return new Response(
      JSON.stringify({ playbackUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
