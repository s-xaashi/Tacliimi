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
 

    let reusableThumbnailKey: string | null = null;
    if (purpose === "thumbnail") {
      if (!courseId) return json({ error: "A course ID is required for thumbnail uploads" }, 400);
      const { data: course, error } = await admin.from("courses")
        .select("id, instructor_id, root_course_id")
        .eq("id", courseId)
        .eq("instructor_id", user.id)
        .maybeSingle();
      if (error) throw error;
      if (!course) return json({ error: "Course not found or not owned by this instructor" }, 403);

      const requestedKey = typeof body?.existing_object_key === "string" ? body.existing_object_key : "";
      const match = requestedKey.match(/^course-thumbnails\/([a-f0-9-]+)\/([a-f0-9-]+)\/([a-f0-9-]+)\.(jpg|png|webp|gif)$/i);
      if (match && match[1].toLowerCase() === user.id.toLowerCase() && match[4].toLowerCase() === IMAGE_TYPES[contentType]) {
        const { data: source, error: sourceError } = await admin.from("courses")
          .select("id, instructor_id, root_course_id")
          .eq("id", match[2]).eq("instructor_id", user.id).maybeSingle();
        if (sourceError) throw sourceError;
        const targetFamily = course.root_course_id || course.id;
        if (source && (source.root_course_id || source.id) === targetFamily) {
          const { data: refs, error: refsError } = await admin.from("courses")
            .select("id").eq("thumbnail_storage_key", requestedKey);
          if (refsError) throw refsError;
          // Never overwrite an image shared by archived/published course versions.
          if ((refs || []).length === 1 && refs[0].id === courseId) reusableThumbnailKey = requestedKey;
        }
      }
    }

    const extension = IMAGE_TYPES[contentType];
    // Always upload to a fresh staging key first. The completion endpoint
    // validates the actual bytes and only then copies to the old key if it is
    // still exclusively referenced by this course.
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
      // New keys remain write-once. Reuse is allowed only after the ownership,
      // course-family and single-reference checks above.
      IfNoneMatch: "*",
      CacheControl: "private, max-age=0, no-store",
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
    return json({
      upload_url: uploadUrl,
      object_key: objectKey,
      replace_object_key: reusableThumbnailKey,
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