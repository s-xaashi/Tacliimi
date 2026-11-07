import { createClient } from "jsr:@supabase/supabase-js@2";
import { S3Client, DeleteObjectCommand } from "npm:@aws-sdk/client-s3";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data: { user }, error: authError } = await admin.auth.getUser(authorization.slice(7));
    if (authError || !user) return json({ error: "Invalid session" }, 401);

    const body = await req.json();
    const type = body?.resource_type;
    const id = typeof body?.resource_id === "string" ? body.resource_id : "";
    const key = typeof body?.object_key === "string" ? body.object_key : "";
    if (!id || !key || (type !== "avatar" && type !== "thumbnail")) return json({ error: "Invalid image reference" }, 400);
    if (type === "thumbnail" && !UUID_RE.test(id)) return json({ error: "Invalid course reference" }, 400);

    if (type === "avatar") {
      if (id !== user.id || !new RegExp("^avatars/" + user.id + "/[a-f0-9-]+\\.(jpg|png|webp|gif)$", "i").test(key)) {
        return json({ error: "Avatar object is not owned by this account" }, 403);
      }
    } else {
      if (!new RegExp("^course-thumbnails/" + user.id + "/" + id + "/[a-f0-9-]+\\.(jpg|png|webp|gif)$", "i").test(key)) {
        return json({ error: "Thumbnail object is not owned by this account or course" }, 403);
      }
      const { data: course, error } = await admin.from("courses").select("id")
        .eq("id", id).eq("instructor_id", user.id).maybeSingle();
      if (error) throw error;
      if (!course) return json({ error: "Course not found or not owned by this instructor" }, 403);
    }

    // Never delete an object that any profile/course row still references.
    const [avatarRefs, thumbnailRefs] = await Promise.all([
      admin.from("profiles").select("id").eq("avatar_storage_key", key).limit(1),
      admin.from("courses").select("id").eq("thumbnail_storage_key", key).limit(1),
    ]);
    if (avatarRefs.error) throw avatarRefs.error;
    if (thumbnailRefs.error) throw thumbnailRefs.error;
    if ((avatarRefs.data?.length ?? 0) > 0 || (thumbnailRefs.data?.length ?? 0) > 0) {
      return json({ deleted: false, reason: "still_referenced" });
    }

    const endpoint = Deno.env.get("R2_ENDPOINT") ?? "";
    const bucket = Deno.env.get("R2_BUCKET_NAME") ?? "";
    const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
    const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error("Private R2 configuration is incomplete");
    const s3 = new S3Client({ region: "auto", endpoint, credentials: { accessKeyId, secretAccessKey } });
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return json({ deleted: true });
  } catch (error) {
    console.error("r2-image-delete:", error);
    return json({ error: error instanceof Error ? error.message : "Image deletion failed" }, 400);
  }
});
