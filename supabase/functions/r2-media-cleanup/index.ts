import { createClient } from "jsr:@supabase/supabase-js@2";
import { S3Client, AbortMultipartUploadCommand, DeleteObjectCommand, HeadObjectCommand } from "npm:@aws-sdk/client-s3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const GRACE_MS = 24 * 60 * 60 * 1000;

function getConfig() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const endpoint = Deno.env.get("R2_ENDPOINT");
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
  const bucket = Deno.env.get("R2_BUCKET_NAME");
  if (![url, key, endpoint, accessKeyId, secretAccessKey, bucket].every(Boolean)) {
    throw new Error("R2 server configuration is incomplete");
  }
  return { url: url!, key: key!, endpoint: endpoint!, accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey!, bucket: bucket! };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authorization = req.headers.get("Authorization") || "";
    const match = authorization.match(/^Bearer\\s+(.+)$/i);
    if (!match) return json({ error: "Authentication required" }, 401);

    const cfg = getConfig();
    const admin = createClient(cfg.url, cfg.key);
    const { data: { user }, error: authError } = await admin.auth.getUser(match[1]);
    if (authError || !user) return json({ error: "Invalid session" }, 401);

    const s3 = new S3Client({
      region: "auto", endpoint: cfg.endpoint,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
    const cutoff = Date.now() - GRACE_MS;
    let deletedVideos = 0;
    let abortedMultipart = 0;
    let reconciledVideos = 0;
    let deletedImages = 0;
    let reconciledImages = 0;

    const { data: videoSessions, error: videoError } = await admin.from("r2_multipart_upload_sessions")
      .select("*").eq("instructor_id", user.id).in("status", ["in_progress", "completed"]);
    if (videoError) throw videoError;

    for (const session of videoSessions || []) {
      const isExpiredMultipart = session.status === "in_progress" && new Date(session.expires_at).getTime() <= Date.now();
      const isStaleCompleted = session.status === "completed" &&
        new Date(session.completed_at || session.created_at).getTime() <= cutoff;
      if (!isExpiredMultipart && !isStaleCompleted) continue;

      const { data: claimed, error: claimError } = await admin.from("r2_multipart_upload_sessions")
        .update({ status: "discarding" })
        .eq("upload_id", session.upload_id).eq("status", session.status)
        .select("upload_id").maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) continue;

      const refs = session.upload_type === "intro"
        ? await admin.from("courses").select("id").eq("intro_video_storage_key", session.object_key)
        : await admin.from("course_lessons").select("id").eq("video_storage_key", session.object_key);
      if (refs.error) throw refs.error;
      if ((refs.data || []).length) {
        await admin.from("r2_multipart_upload_sessions")
          .update({ status: "committed", committed_at: new Date().toISOString() })
          .eq("upload_id", session.upload_id).eq("status", "discarding");
        reconciledVideos++;
        continue;
      }

      if (isExpiredMultipart) {
        try {
          await s3.send(new AbortMultipartUploadCommand({
            Bucket: cfg.bucket, Key: session.object_key, UploadId: session.upload_id,
          }));
          abortedMultipart++;
        } catch (abortError) {
          // If R2 already completed but the DB update was lost, treat it as an
          // object candidate and remove it only after the reference check below.
          try {
            await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: session.object_key }));
          } catch (_) {
            await admin.from("r2_multipart_upload_sessions")
              .update({ status: "aborted" }).eq("upload_id", session.upload_id).eq("status", "discarding");
            continue;
          }
          console.warn("Expired multipart upload no longer exists; checking for a completed object.", abortError);
        }
      }

      // Recheck all course versions immediately before object deletion.
      const finalRefs = session.upload_type === "intro"
        ? await admin.from("courses").select("id").eq("intro_video_storage_key", session.object_key)
        : await admin.from("course_lessons").select("id").eq("video_storage_key", session.object_key);
      if (finalRefs.error) throw finalRefs.error;
      if ((finalRefs.data || []).length) {
        await admin.from("r2_multipart_upload_sessions")
          .update({ status: "committed", committed_at: new Date().toISOString() })
          .eq("upload_id", session.upload_id).eq("status", "discarding");
        reconciledVideos++;
        continue;
      }

      if (isStaleCompleted) {
        await s3.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: session.object_key }));
        deletedVideos++;
      }
      await admin.from("r2_multipart_upload_sessions")
        .update({ status: "discarded" })
        .eq("upload_id", session.upload_id).eq("status", "discarding");
    }

    const { data: imageSessions, error: imageError } = await admin.from("r2_image_upload_sessions")
      .select("*").eq("instructor_id", user.id).in("status", ["in_progress", "completed"]);
    if (imageError) throw imageError;

    for (const session of imageSessions || []) {
      const isExpiredPut = session.status === "in_progress" && new Date(session.expires_at).getTime() <= Date.now();
      const isStaleCompleted = session.status === "completed" &&
        new Date(session.completed_at || session.created_at).getTime() <= cutoff;
      if (!isExpiredPut && !isStaleCompleted) continue;

      const { data: claimed, error: claimError } = await admin.from("r2_image_upload_sessions")
        .update({ status: "discarding" })
        .eq("upload_id", session.upload_id).eq("status", session.status)
        .select("upload_id").maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) continue;

      const refs = await admin.from("courses").select("id").eq("thumbnail_storage_key", session.object_key);
      if (refs.error) throw refs.error;
      if ((refs.data || []).length) {
        await admin.from("r2_image_upload_sessions")
          .update({ status: "committed", committed_at: new Date().toISOString() })
          .eq("upload_id", session.upload_id).eq("status", "discarding");
        reconciledImages++;
        continue;
      }

      // Recheck immediately before deleting; an upload is never removed while
      // any course version still points at the same object.
      const finalRefs = await admin.from("courses").select("id").eq("thumbnail_storage_key", session.object_key);
      if (finalRefs.error) throw finalRefs.error;
      if ((finalRefs.data || []).length) {
        await admin.from("r2_image_upload_sessions")
          .update({ status: "committed", committed_at: new Date().toISOString() })
          .eq("upload_id", session.upload_id).eq("status", "discarding");
        reconciledImages++;
        continue;
      }

      await s3.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: session.object_key }));
      await admin.from("r2_image_upload_sessions")
        .update({ status: "discarded" }).eq("upload_id", session.upload_id).eq("status", "discarding");
      deletedImages++;
    }

    return json({
      deleted_videos: deletedVideos,
      aborted_multipart_uploads: abortedMultipart,
      reconciled_video_sessions: reconciledVideos,
      deleted_thumbnails: deletedImages,
      reconciled_thumbnail_sessions: reconciledImages,
      grace_period_hours: 24,
    });
  } catch (error) {
    console.error("r2-media-cleanup:", error);
    return json({ error: error instanceof Error ? error.message : "R2 media cleanup failed" }, 400);
  }
});
