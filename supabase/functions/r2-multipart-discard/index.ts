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
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return json({ error: "Authentication required" }, 401);

    const cfg = getConfig();
    const supabase = createClient(cfg.url, cfg.key);
    const { data: { user }, error: authError } = await supabase.auth.getUser(match[1]);
    if (authError || !user) return json({ error: "Invalid session" }, 401);

    const { course_id, upload_id, object_key } = await req.json();
    if (!course_id || !upload_id || !object_key) return json({ error: "Missing upload identity" }, 400);

    const { data: session, error: sessionError } = await supabase
      .from("r2_multipart_upload_sessions")
      .select("*")
      .eq("upload_id", upload_id)
      .eq("object_key", object_key)
      .eq("course_id", course_id)
      .eq("instructor_id", user.id)
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return json({ error: "Upload session not found or not authorized" }, 404);

    if (session.status === "committed") return json({ discarded: false, preserved: true, reason: "already_committed" });
    if (session.status === "discarded") return json({ discarded: true, already_discarded: true });

    const s3 = new S3Client({
      region: "auto",
      endpoint: cfg.endpoint,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      requestChecksumCalculation: "WHEN_REQUIRED",
    });

    const hasReferences = async () => {
      if (session.upload_type === "intro") {
        const { data, error } = await supabase.from("courses")
          .select("id").eq("intro_video_storage_key", session.object_key);
        if (error) throw error;
        return (data || []).length > 0;
      }
      const [directRefs, assets] = await Promise.all([
        supabase.from("course_lessons").select("id").eq("video_storage_key", session.object_key),
        supabase.from("course_media_assets").select("id")
          .eq("storage_path", session.object_key).eq("storage_provider", "r2"),
      ]);
      if (directRefs.error) throw directRefs.error;
      if (assets.error) throw assets.error;
      const assetIds = (assets.data || []).map((asset: any) => asset.id);
      if (!assetIds.length) return (directRefs.data || []).length > 0;
      const { data: assetRefs, error: assetRefError } = await supabase.from("course_lessons")
        .select("id").in("media_asset_id", assetIds);
      if (assetRefError) throw assetRefError;
      return (directRefs.data || []).length > 0 || (assetRefs || []).length > 0;
    };

    // Never discard a key attached directly or through a shared media asset.
    const firstHasReferences = await hasReferences();
    if (firstHasReferences) {
      await supabase.from("r2_multipart_upload_sessions")
        .update({ status: "committed", committed_at: new Date().toISOString() })
        .eq("upload_id", upload_id)
        .in("status", ["completed", "discarding", "aborted"]);
      return json({ discarded: false, preserved: true, reason: "still_referenced" });
    }

    const { data: claimed, error: claimError } = await supabase
      .from("r2_multipart_upload_sessions")
      .update({ status: "discarding" })
      .eq("upload_id", upload_id)
      .eq("instructor_id", user.id)
      .in("status", ["in_progress", "completed", "aborted", "discarding"])
      .select("upload_id, status")
      .maybeSingle();
    if (claimError) throw claimError;

    if (!claimed) {
      const { data: latest, error: latestError } = await supabase.from("r2_multipart_upload_sessions")
        .select("status").eq("upload_id", upload_id).maybeSingle();
      if (latestError) throw latestError;
      if (latest?.status === "committed") return json({ discarded: false, preserved: true, reason: "commit_won_race" });
      if (latest?.status === "discarded") return json({ discarded: true, already_discarded: true });
      throw new Error("Upload is changing state; retry cleanup shortly.");
    }

    if (session.status === "in_progress" || session.status === "discarding") {
      try {
        await s3.send(new AbortMultipartUploadCommand({
          Bucket: cfg.bucket, Key: session.object_key, UploadId: session.upload_id,
        }));
      } catch (abortError) {
        const status = (abortError as any)?.$metadata?.httpStatusCode;
        const isMissingUpload = status === 404 || (abortError as Error)?.name === "NoSuchUpload" ||
          /NoSuchUpload|not found/i.test((abortError as Error)?.message || "");
        if (!isMissingUpload) throw abortError;

        // R2 reports NoSuchUpload when completion already won the race. Only
        // treat a missing object as safely aborted when HeadObject confirms 404.
        try {
          await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: session.object_key }));
        } catch (headError) {
          const headStatus = (headError as any)?.$metadata?.httpStatusCode;
          const isMissingObject = headStatus === 404 || (headError as Error)?.name === "NotFound" ||
            /not found|404/i.test((headError as Error)?.message || "");
          if (!isMissingObject) throw headError;
          await supabase.from("r2_multipart_upload_sessions")
            .update({ status: "discarded" }).eq("upload_id", upload_id).eq("status", "discarding");
          return json({ discarded: true, multipart_aborted: true });
        }
        console.warn("Multipart upload no longer exists; deleting its unreferenced completed object.", abortError);
      }
    }

    // Recheck immediately before deletion. A concurrent commit must win.
    const finalHasReferences = await hasReferences();
    if (finalHasReferences) {
      await supabase.from("r2_multipart_upload_sessions")
        .update({ status: "committed", committed_at: new Date().toISOString() })
        .eq("upload_id", upload_id).eq("status", "discarding");
      return json({ discarded: false, preserved: true, reason: "referenced_during_cleanup" });
    }

    await s3.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: session.object_key }));
    const { error: finishError } = await supabase.from("r2_multipart_upload_sessions")
      .update({ status: "discarded" })
      .eq("upload_id", upload_id)
      .eq("status", "discarding");
    if (finishError) throw finishError;

    return json({ discarded: true });
  } catch (error) {
    console.error("r2-multipart-discard:", error);
    return json({ error: error instanceof Error ? error.message : "Could not discard staged upload" }, 400);
  }
});
