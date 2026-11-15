import { createClient } from "jsr:@supabase/supabase-js@2";
import { S3Client } from "npm:@aws-sdk/client-s3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
function getConfig() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const endpoint = Deno.env.get("R2_ENDPOINT");
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
  const bucket = Deno.env.get("R2_BUCKET_NAME");
  if (![url,key,endpoint,accessKeyId,secretAccessKey,bucket].every(Boolean)) throw new Error("R2 server configuration is incomplete");
  return { url: url!, key: key!, endpoint: endpoint!, accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey!, bucket: bucket! };
}
async function authenticate(req: Request) {
  const header = req.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Missing or invalid Authorization header");
  const cfg = getConfig();
  const supabase = createClient(cfg.url, cfg.key);
  const { data: { user }, error } = await supabase.auth.getUser(match[1]);
  if (error || !user) throw new Error("Invalid authentication token");
  return { supabase, user, cfg };
}
function makeS3(cfg: ReturnType<typeof getConfig>) {
  return new S3Client({ region: "auto", endpoint: cfg.endpoint, credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }, requestChecksumCalculation: "WHEN_REQUIRED" });
}

/**
 * The session table intentionally has a unique index on object_key. Reusing an
 * introduction-video key therefore requires retiring its previous terminal
 * session row before a new multipart upload can be registered.
 *
 * Never remove a live session. An expired in-progress multipart upload is
 * aborted in R2 first, then marked aborted before its row is removed.
 */
async function retirePreviousIntroSession(supabase: any, s3: S3Client, cfg: ReturnType<typeof getConfig>, objectKey: string, courseId: string, userId: string) {
  const { data: previous, error: lookupError } = await supabase
    .from("r2_multipart_upload_sessions")
    .select("upload_id, object_key, instructor_id, course_id, upload_type, status, expires_at")
    .eq("object_key", objectKey)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!previous) return;

  // The existing row must describe this instructor's introduction upload.
  // Do not touch a row belonging to another course, owner, or upload type.
  if (previous.instructor_id !== userId || previous.course_id !== courseId || previous.upload_type !== "intro") {
    throw new Error("This introduction video key already has an upload session that cannot safely be reused. Please retry to create a separate media object.");
  }

  if (previous.status === "in_progress") {
    if (new Date(previous.expires_at).getTime() > Date.now()) {
      throw new Error("An upload for this introduction video is already in progress. Please wait for it to finish before trying again.");
    }

    // Expired multipart uploads cannot be completed by the normal completion
    // endpoint. Abort the old R2 multipart upload before releasing its key.
    const { AbortMultipartUploadCommand } = await import("npm:@aws-sdk/client-s3");
    await s3.send(new AbortMultipartUploadCommand({
      Bucket: cfg.bucket,
      Key: previous.object_key,
      UploadId: previous.upload_id,
    }));

    const { error: markError } = await supabase
      .from("r2_multipart_upload_sessions")
      .update({ status: "aborted" })
      .eq("upload_id", previous.upload_id)
      .eq("object_key", objectKey)
      .eq("status", "in_progress");
    if (markError) throw markError;
  } else if (!["completed", "aborted"].includes(previous.status)) {
    throw new Error("The previous introduction upload has an unexpected status and cannot safely be replaced.");
  }

  // This deletes only the obsolete session metadata. It does not delete the
  // completed R2 object or alter the course's media reference.
  const { error: deleteError } = await supabase
    .from("r2_multipart_upload_sessions")
    .delete()
    .eq("upload_id", previous.upload_id)
    .eq("object_key", objectKey)
    .in("status", ["completed", "aborted"]);
  if (deleteError) throw deleteError;
}
async function ownedSession(supabase: any, input: any, userId: string) {
  const { data, error } = await supabase.from("r2_multipart_upload_sessions").select("*")
    .eq("upload_id", input.upload_id).eq("object_key", input.object_key)
    .eq("course_id", input.course_id).eq("instructor_id", userId)
    .eq("status", "in_progress").gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Upload session not found, expired, or not authorized");
  return data;
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let multipart: { uploadId?: string; Key?: string } | null = null;
  try {
    const { supabase, user, cfg } = await authenticate(req);
    const body = await req.json();
    const { course_id, lesson_id, type = "lesson", content_type, file_size, existing_object_key } = body;
    if (!course_id || !Number.isSafeInteger(file_size) || file_size <= 0 || file_size > 5 * 1024 * 1024 * 1024) throw new Error("Invalid course_id or file_size (maximum 5 GB)");
    if (!["lesson", "intro"].includes(type)) throw new Error("Invalid upload type");
    if (!["video/mp4", "video/quicktime"].includes(content_type)) throw new Error("Only MP4 and MOV videos are supported");
    const partSize = 16 * 1024 * 1024;
    const partCount = Math.ceil(file_size / partSize);
    if (partCount < 1 || partCount > 10000) throw new Error("File requires an unsupported number of multipart chunks");
    const { data: course, error: courseError } = await supabase.from("courses").select("id,instructor_id").eq("id", course_id).maybeSingle();
    if (courseError) throw courseError;
    if (!course || course.instructor_id !== user.id) throw new Error("Course not found or not authorized");
    const { data: settings, error: settingsError } = await supabase.from("platform_settings").select("self_hosted_video_uploads_enabled").single();
    if (settingsError) throw settingsError;
    if (!settings?.self_hosted_video_uploads_enabled) throw new Error("Self-hosted video uploads are disabled");
    if (type === "lesson") {
      if (!lesson_id) throw new Error("Missing lesson_id");
      const { data: lesson, error } = await supabase.from("course_lessons").select("id,course_sections!inner(course_id)").eq("id", lesson_id).eq("course_sections.course_id", course_id).maybeSingle();
      if (error) throw error;
      if (!lesson) throw new Error("Lesson does not belong to this course");
    } else if (lesson_id) {
      throw new Error("Introduction uploads must not include a lesson_id");
    }
    let reusableIntroKey: string | null = null;
    if (type === "intro" && typeof existing_object_key === "string") {
      const match = existing_object_key.match(/^courses\/([a-f0-9-]+)\/introduction\/[a-f0-9-]+\.mp4$/i);
      if (match) {
        const { data: sourceCourse, error: sourceError } = await supabase.from("courses")
          .select("id, instructor_id, root_course_id")
          .eq("id", match[1]).maybeSingle();
        if (sourceError) throw sourceError;
        const { data: targetCourse, error: targetError } = await supabase.from("courses")
          .select("id, instructor_id, root_course_id")
          .eq("id", course_id).eq("instructor_id", user.id).maybeSingle();
        if (targetError) throw targetError;
        const sameFamily = sourceCourse && targetCourse &&
          sourceCourse.instructor_id === user.id &&
          (sourceCourse.root_course_id || sourceCourse.id) === (targetCourse.root_course_id || targetCourse.id);
        if (sameFamily) {
          const { data: refs, error: refsError } = await supabase.from("courses")
            .select("id").eq("intro_video_storage_key", existing_object_key);
          if (refsError) throw refsError;
          // A key used by any other revision must remain immutable.
          if ((refs || []).length === 1 && refs[0].id === course_id) reusableIntroKey = existing_object_key;
        }
      }
    }
    const objectKey = type === "intro"
      ? (reusableIntroKey || `courses/${course_id}/introduction/${crypto.randomUUID()}.mp4`)
      : `courses/${course_id}/lessons/${lesson_id}/video/${crypto.randomUUID()}.mp4`;
    const s3 = makeS3(cfg);
    if (type === "intro" && reusableIntroKey) {
      await retirePreviousIntroSession(supabase, s3, cfg, objectKey, course_id, user.id);
    }
    const { CreateMultipartUploadCommand } = await import("npm:@aws-sdk/client-s3");
    const result = await s3.send(new CreateMultipartUploadCommand({ Bucket: cfg.bucket, Key: objectKey, ContentType: content_type }));
    if (!result.UploadId) throw new Error("R2 did not return an upload ID");
    multipart = { uploadId: result.UploadId, Key: objectKey };
    const { error: insertError } = await supabase.from("r2_multipart_upload_sessions").insert({
      upload_id: result.UploadId, object_key: objectKey, instructor_id: user.id, course_id,
      lesson_id: lesson_id || null, upload_type: type, content_type, file_size_bytes: file_size,
      part_size_bytes: partSize, part_count: partCount, status: "in_progress",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    });
    if (insertError) throw insertError;
    return json({ uploadId: result.UploadId, objectKey, partCount, partSize });
  } catch (error) {
    if (multipart?.uploadId && multipart.Key) {
      try {
        const { AbortMultipartUploadCommand } = await import("npm:@aws-sdk/client-s3");
        const cfg = getConfig();
        await makeS3(cfg).send(new AbortMultipartUploadCommand({ Bucket: cfg.bucket, Key: multipart.Key, UploadId: multipart.uploadId }));
      } catch (cleanupError) { console.error("Failed to abort unregistered multipart upload", cleanupError); }
    }
    return json({ error: error instanceof Error ? error.message : "Upload creation failed" }, 400);
  }
});