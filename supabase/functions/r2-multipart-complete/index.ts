import { createClient } from "jsr:@supabase/supabase-js@2";
import { S3Client, DeleteObjectCommand } from "npm:@aws-sdk/client-s3";

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
  if (![url, key, endpoint, accessKeyId, secretAccessKey, bucket].every(Boolean)) throw new Error("R2 server configuration is incomplete");
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
  return new S3Client({
    region: "auto",
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
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

  try {
    const { supabase, user, cfg } = await authenticate(req);
    const body = await req.json();
    const { course_id, upload_id, object_key, parts } = body;
    if (!course_id || !upload_id || !object_key || !Array.isArray(parts)) {
      throw new Error("Missing required multipart completion fields");
    }

    const session = await ownedSession(supabase, { course_id, upload_id, object_key }, user.id);
    if (parts.length !== session.part_count) throw new Error("Uploaded part count does not match the expected file size");

    const normalized = parts.map((part: any) => ({
      PartNumber: part?.PartNumber,
      ETag: typeof part?.ETag === "string" ? part.ETag.trim() : "",
    }));
    if (normalized.some((part: any) =>
      !Number.isInteger(part.PartNumber) ||
      part.PartNumber < 1 ||
      part.PartNumber > session.part_count ||
      !part.ETag ||
      part.ETag.length > 1024
    )) {
      throw new Error("Invalid multipart part metadata");
    }
    normalized.sort((a: any, b: any) => a.PartNumber - b.PartNumber);
    if (normalized.some((part: any, index: number) => part.PartNumber !== index + 1)) {
      throw new Error("Multipart parts must be unique and sequential from 1 to the final part");
    }

    // All new uploads use unique staging keys; committed media is never overwritten.

    const { CompleteMultipartUploadCommand } = await import("npm:@aws-sdk/client-s3");
    await makeS3(cfg).send(new CompleteMultipartUploadCommand({
      Bucket: cfg.bucket,
      Key: session.object_key,
      UploadId: session.upload_id,
      MultipartUpload: { Parts: normalized },
    }));

    // Completion only stages the R2 object. The existing client workflow commits
    // lesson videos through commit_r2_video_upload after the instructor clicks
    // Save Video; intro videos are persisted by the course-draft save flow.
    // Keeping database attachment out of this endpoint also allows a completed
    // but unsaved upload to be safely discarded without deleting a referenced asset.
    const { data: completedSession, error: updateError } = await supabase.from("r2_multipart_upload_sessions")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("upload_id", session.upload_id)
      .eq("status", "in_progress")
      .select("upload_id")
      .maybeSingle();
    if (updateError) throw updateError;

    if (!completedSession) {
      // Cancellation may have claimed the session while R2 completion was in
      // flight. Recheck references after completion before removing the object.
      const referenceQuery = session.upload_type === "intro"
        ? await supabase.from("courses").select("id").eq("intro_video_storage_key", session.object_key)
        : await supabase.from("course_lessons").select("id").eq("video_storage_key", session.object_key);
      if (referenceQuery.error) throw referenceQuery.error;
      if ((referenceQuery.data || []).length) {
        await supabase.from("r2_multipart_upload_sessions")
          .update({ status: "committed", committed_at: new Date().toISOString() })
          .eq("upload_id", session.upload_id)
          .eq("status", "discarding");
        return json({ error: "Upload was committed while cancellation was requested; the referenced media was preserved." }, 409);
      }

      await makeS3(cfg).send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: session.object_key }));
      await supabase.from("r2_multipart_upload_sessions")
        .update({ status: "discarded" })
        .eq("upload_id", session.upload_id)
        .in("status", ["discarding", "aborted"]);
      return json({ error: "Upload was cancelled before it could be staged." }, 409);
    }

    return json({ success: true, objectKey: session.object_key });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Multipart completion failed" }, 400);
  }
});
