import { createClient } from "jsr:@supabase/supabase-js@2";
import { S3Client, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from "npm:@aws-sdk/client-s3";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});

function matchesImageSignature(type: string, bytes: Uint8Array): boolean {
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v);
  if (type === "image/gif") return bytes.length >= 6 && new TextDecoder().decode(bytes.slice(0, 6)).match(/^GIF8[79]a$/) !== null;
  if (type === "image/webp") return bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: { user }, error: authError } = await admin.auth.getUser(authorization.slice(7));
    if (authError || !user) return json({ error: "Invalid session" }, 401);

    const body = await req.json();
    const purpose = body?.purpose;
    const courseId = typeof body?.course_id === "string" ? body.course_id : "";
    const objectKey = typeof body?.object_key === "string" ? body.object_key : "";
    if (purpose !== "avatar" && purpose !== "thumbnail") return json({ error: "Invalid image purpose" }, 400);
    if (purpose === "thumbnail" && !UUID_RE.test(courseId)) return json({ error: "Invalid course reference" }, 400);

    const isAvatarKey = new RegExp("^avatars/" + user.id + "/[a-f0-9-]+\\.(jpg|png|webp|gif)$", "i").test(objectKey);
    const isThumbnailKey = courseId &&
      new RegExp("^course-thumbnails/" + user.id + "/" + courseId + "/[a-f0-9-]+\\.(jpg|png|webp|gif)$", "i").test(objectKey);
    if ((purpose === "avatar" && !isAvatarKey) || (purpose === "thumbnail" && !isThumbnailKey)) {
      return json({ error: "Image object does not belong to this account or course" }, 403);
    }

    if (purpose === "thumbnail") {
      const { data: course, error } = await admin.from("courses").select("id")
        .eq("id", courseId).eq("instructor_id", user.id).maybeSingle();
      if (error) throw error;
      if (!course) return json({ error: "Course not found or not owned by this instructor" }, 403);
    }

    const endpoint = Deno.env.get("R2_ENDPOINT") ?? "";
    const bucket = Deno.env.get("R2_BUCKET_NAME") ?? "";
    const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
    const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error("Private R2 configuration is incomplete");
    const s3 = new S3Client({ region: "auto", endpoint, credentials: { accessKeyId, secretAccessKey } });

    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
    const maxBytes = purpose === "avatar" ? 5 * 1024 * 1024 : 10 * 1024 * 1024;
    const contentType = head.ContentType ?? "";
    const expectedExtension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[contentType];
    const extension = objectKey.split(".").pop()?.toLowerCase();
    const validHead = Number.isSafeInteger(head.ContentLength) &&
      (head.ContentLength ?? 0) > 0 && (head.ContentLength ?? 0) <= maxBytes &&
      !!expectedExtension && extension === expectedExtension;

    if (!validHead) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
      return json({ error: "Uploaded image failed size, type, or ownership-metadata validation" }, 422);
    }

    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey, Range: "bytes=0-15" }));
    const bytes = object.Body ? await object.Body.transformToByteArray() : new Uint8Array();
    if (!matchesImageSignature(contentType, bytes)) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
      return json({ error: "Uploaded file content does not match an allowed image format" }, 422);
    }

    return json({ verified: true, size: head.ContentLength, content_type: contentType });
  } catch (error) {
    console.error("r2-image-upload-complete:", error);
    return json({ error: error instanceof Error ? error.message : "Image verification failed" }, 400);
  }
});
