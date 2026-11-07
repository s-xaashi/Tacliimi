import { createClient } from "jsr:@supabase/supabase-js@2";
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "npm:@aws-sdk/client-s3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data: { user }, error: authError } = await admin.auth.getUser(authorization.slice(7));
    if (authError || !user) return json({ error: "Invalid session" }, 401);

    const endpoint = Deno.env.get("R2_ENDPOINT") ?? "";
    const bucket = Deno.env.get("R2_BUCKET_NAME") ?? "";
    const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
    const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error("Private R2 configuration is incomplete");
    const s3 = new S3Client({ region: "auto", endpoint, credentials: { accessKeyId, secretAccessKey } });

    const cutoff = Date.now() - GRACE_PERIOD_MS;
    let removed = 0;
    const prefixes = [
      { prefix: `avatars/${user.id}/`, table: "profiles", column: "avatar_storage_key" },
      { prefix: `course-thumbnails/${user.id}/`, table: "courses", column: "thumbnail_storage_key" },
    ] as const;

    for (const item of prefixes) {
      let continuationToken: string | undefined;
      do {
        const page = await s3.send(new ListObjectsV2Command({
          Bucket: bucket, Prefix: item.prefix, MaxKeys: 1000, ContinuationToken: continuationToken,
        }));
        const candidates = (page.Contents ?? [])
          .filter(object => object.Key && object.LastModified && object.LastModified.getTime() < cutoff)
          .map(object => object.Key as string);
        if (candidates.length) {
          const { data: referenced, error } = await admin.from(item.table)
            .select(item.column).in(item.column, candidates);
          if (error) throw error;
          const inUse = new Set((referenced ?? []).map((row: Record<string, string | null>) => row[item.column]).filter(Boolean));
          const stale = candidates.filter(key => !inUse.has(key));
          if (stale.length) {
            await s3.send(new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: stale.map(Key => ({ Key })), Quiet: true },
            }));
            removed += stale.length;
          }
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (continuationToken);
    }

    return json({ cleaned: removed, grace_period_hours: 24 });
  } catch (error) {
    console.error("r2-image-cleanup:", error);
    return json({ error: error instanceof Error ? error.message : "Image cleanup failed" }, 400);
  }
});
