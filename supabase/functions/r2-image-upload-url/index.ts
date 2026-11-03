import { createClient } from "jsr:@supabase/supabase-js@2";
import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const PUBLIC_BASE_URL = "https://media.tacliimi.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(supabaseUrl, serviceKey);
    const token = authorization.slice("Bearer ".length);
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid session" }, 401);

    const body = await req.json();
    const purpose = body?.purpose;
    const contentType = body?.content_type;
    const fileSize = Number(body?.file_size);
    const courseId = body?.course_id ? String(body.course_id) : null;

    if (purpose !== "avatar" && purpose !== "thumbnail") return json({ error: "Invalid image purpose" }, 400);
    if (!Object.hasOwn(IMAGE_TYPES, contentType)) return json({ error: "Unsupported image type" }, 400);
    const maxBytes = purpose === "avatar" ? 5 * 1024 * 1024 : 10 * 1024 * 1024;
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > maxBytes) {
      return json({ error: `Image exceeds the ${maxBytes / (1024 * 1024)}MB limit` }, 400);
    }

    if (purpose === "thumbnail" && courseId) {
      const { data: course, error } = await admin
        .from("courses")
        .select("id")
        .eq("id", courseId)
        .eq("instructor_id", user.id)
        .maybeSingle();
      if (error) throw error;
      if (!course) return json({ error: "Course not found or not owned by this instructor" }, 403);
    }

    const extension = IMAGE_TYPES[contentType];
    const objectKey = purpose === "avatar"
      ? `avatars/${user.id}/${crypto.randomUUID()}.${extension}`
      : `course-thumbnails/${user.id}/${courseId ?? "new"}/${crypto.randomUUID()}.${extension}`;

    const endpoint = Deno.env.get("R2_ENDPOINT") ?? "";
    const bucket = Deno.env.get("R2_PUBLIC_BUCKET_NAME") ?? "";
    const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
    const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error("Public R2 storage configuration is incomplete (R2_PUBLIC_BUCKET_NAME)");
    }

    const s3 = new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

    return json({
      upload_url: uploadUrl,
      object_key: objectKey,
      public_url: `${PUBLIC_BASE_URL}/${objectKey}`,
      required_headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("r2-image-upload-url:", error);
    return json({ error: error instanceof Error ? error.message : "Image upload failed" }, 400);
  }
});