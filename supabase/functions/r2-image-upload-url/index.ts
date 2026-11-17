import { createClient } from "jsr:@supabase/supabase-js@2";
import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data: { user }, error: authError } = await admin.auth.getUser(authorization.slice(7));
    if (authError || !user) return json({ error: "Invalid session" }, 401);

    const body = await req.json();
    const purpose = body?.purpose;
    const contentType = body?.content_type;
    const fileSize = Number(body?.file_size);
    const courseId = body?.course_id ? String(body.course_id) : null;
    
    if (purpose !== "avatar" && purpose !== "thumbnail") return json({ error: "Invalid image purpose" }, 400);
    if (!Object.hasOwn(IMAGE_TYPES, contentType)) return json({ error: "Unsupported image type" }, 400);
    const maxBytes = purpose === "avatar" ? 5 * 1024 * 1024 : 10 * 1024 * 1024;
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > maxBytes) return json({ error: "Image size is invalid or exceeds the limit" }, 400);
 

    let imageUploadId: string | null = null;
    if (purpose === "thumbnail") {
      if (!courseId) return json({ error: "A course ID is required for thumbnail uploads" }, 400);
      const { data: course, error } = await admin.from("courses")
        .select("id, instructor_id")
        .eq("id", courseId)
        .eq("instructor_id", user.id)
        .maybeSingle();
      if (error) throw error;
      if (!course) return json({ error: "Course not found or not owned by this instructor" }, 403);
      imageUploadId = crypto.randomUUID();
    }

    const extension = IMAGE_TYPES[contentType];
    // A replacement always gets a new staging key. The previous thumbnail
    // remains untouched until the database pointer has been saved.
    const objectKey = purpose === "avatar"
      ? `avatars/${user.id}/${crypto.randomUUID()}.${extension}`
      : `course-thumbnails/${user.id}/${courseId ?? "new"}/${crypto.randomUUID()}.${extension}`;
    const endpoint = Deno.env.get("R2_ENDPOINT") ?? "";
    const bucket = Deno.env.get("R2_BUCKET_NAME") ?? "";
    const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
    const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error("Private R2 configuration is incomplete (R2_BUCKET_NAME)");

    const s3 = new S3Client({ region: "auto", endpoint, credentials: { accessKeyId, secretAccessKey } });
    const command = new PutObjectCommand({
      Bucket: bucket, Key: objectKey, ContentType: contentType,
      // Every upload gets a write-once staging key; committed thumbnails are immutable.
      IfNoneMatch: "*",
      CacheControl: "private, max-age=0, no-store",
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
    if (purpose === "thumbnail" && imageUploadId) {
      const { error: sessionError } = await admin.from("r2_image_upload_sessions").insert({
        upload_id: imageUploadId,
        object_key: objectKey,
        instructor_id: user.id,
        course_id: courseId,
        upload_type: "thumbnail",
        content_type: contentType,
        file_size_bytes: fileSize,
        status: "in_progress",
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });
      if (sessionError) throw sessionError;
    }
    return json({
      upload_url: uploadUrl,
      upload_id: imageUploadId,
      object_key: objectKey,
      required_headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=0, no-store",
        "If-None-Match": "*",
       },
    });
  } catch (error) {
    console.error("r2-image-upload-url:", error);
    return json({ error: error instanceof Error ? error.message : "Image upload failed" }, 400);
  }
});