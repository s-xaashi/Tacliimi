import { createClient } from "jsr:@supabase/supabase-js@2";
import { S3Client, GetObjectCommand } from "npm:@aws-sdk/client-s3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner";

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
    const body = await req.json();
    const type = body?.resource_type;
    const id = typeof body?.resource_id === "string" ? body.resource_id : "";
    if (!id || (type !== "avatar" && type !== "thumbnail")) return json({ error: "Invalid image reference" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(supabaseUrl, serviceKey);
    const authorization = req.headers.get("Authorization");
    let userId: string | null = null;
    let isAdmin = false;
    if (authorization?.startsWith("Bearer ")) {
      const { data: { user } } = await admin.auth.getUser(authorization.slice(7));
      userId = user?.id ?? null;
      if (userId) {
        const { data: callerProfile } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
        isAdmin = callerProfile?.role === "admin";
      }
    }

    let objectKey: string | null = null;
    let permitted = false;
    if (type === "avatar") {
      const { data: profile, error } = await admin.from("profiles")
        .select("id, avatar_url, avatar_storage_key, is_public, account_status")
        .eq("id", id).maybeSingle();
      if (error) throw error;
      if (!profile || profile.account_status !== "active") return json({ error: "Image not found" }, 404);
      const { data: mentor } = await admin.from("mentorship_profiles")
        .select("id, is_public, deleted_at").eq("instructor_id", id).is("deleted_at", null).maybeSingle();
      const isPublic = profile.is_public === true || mentor?.is_public === true;
      permitted = isPublic || userId === id || isAdmin;
      objectKey = profile.avatar_storage_key;
    } else {
      const { data: course, error } = await admin.from("courses")
        .select("id, instructor_id, thumbnail_url, thumbnail_storage_key, status, is_public, deleted_at, is_latest_published")
        .eq("id", id).maybeSingle();
      if (error) throw error;
      if (!course || course.deleted_at) return json({ error: "Image not found" }, 404);
      // Public course images follow the marketplace visibility/version rules.
      // For private courses, keep access restricted to the owner/admin until the
      // product explicitly defines whether enrolled students may view them.
      const isPublic = course.status === "published" &&
        course.is_public === true &&
        course.is_latest_published === true &&
        course.deleted_at === null;
      permitted = isPublic || userId === course.instructor_id || isAdmin;
      objectKey = course.thumbnail_storage_key;
    }
    if (!permitted) return json({ error: "Image not available" }, 403);
    // Only keys in the dedicated image namespaces are eligible. Legacy URLs
    // are intentionally not re-signed and continue to be rendered as-is.
    if (typeof objectKey !== "string" || !/^(avatars|course-thumbnails)\/[a-f0-9-]+\/.+\.(jpg|png|webp|gif)$/i.test(objectKey)) {
      return json({ error: "No private R2 image is attached to this resource" }, 404);
    }

    const expectedPrefix = type === "avatar" ? `avatars/${id}/` : `course-thumbnails/${(await admin.from("courses").select("instructor_id").eq("id", id).single()).data?.instructor_id}/${id}/`;
    if (!objectKey.startsWith(expectedPrefix) && !(type === "thumbnail" && objectKey.startsWith(expectedPrefix.replace(`/${id}/`, "/new/")))) {
      return json({ error: "Image reference does not match its owner or resource" }, 403);
    }

    const endpoint = Deno.env.get("R2_ENDPOINT") ?? "";
    const bucket = Deno.env.get("R2_BUCKET_NAME") ?? "";
    const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
    const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error("Private R2 configuration is incomplete");
    const s3 = new S3Client({ region: "auto", endpoint, credentials: { accessKeyId, secretAccessKey } });
    const signedUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: objectKey }), { expiresIn: 60 });
    return json({ signed_url: signedUrl, expires_in: 60 });
  } catch (error) {
    console.error("r2-image-url:", error);
    return json({ error: error instanceof Error ? error.message : "Image resolution failed" }, 400);
  }
});