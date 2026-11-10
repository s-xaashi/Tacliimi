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
    const visibilityContext = typeof body?.visibility_context === "string" ? body.visibility_context : null;
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
    let resourceOwnerId: string | null = null;
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
      let visibleInPublicContext = false;

      // These contexts mirror existing public views that already expose the
      // legacy avatar_url field. They do not make a profile generally public.
      if (!isPublic && visibilityContext === "marketplace-instructor") {
        const { data, error: viewError } = await admin.from("course_marketplace_view")
          .select("id").eq("instructor_id", id).eq("is_public", true).eq("status", "published").limit(1);
        if (viewError) throw viewError;
        visibleInPublicContext = Boolean(data?.length);
      } else if (!isPublic && visibilityContext === "course-reviewer") {
        const { data, error: viewError } = await admin.from("public_course_review_display")
          .select("review_id").eq("student_id", id).limit(1);
        if (viewError) throw viewError;
        visibleInPublicContext = Boolean(data?.length);
      } else if (!isPublic && visibilityContext === "mentor-reviewer") {
        const { data: publicMentors, error: mentorError } = await admin.from("mentorship_profiles")
          .select("id").eq("instructor_id", id).eq("is_public", true).is("deleted_at", null);
        if (mentorError) throw mentorError;
        const mentorIds = (publicMentors || []).map((item) => item.id);
        if (mentorIds.length) {
          const { data: reviews, error: reviewError } = await admin.from("mentor_profile_reviews_view")
            .select("id").eq("student_id", id).in("mentor_id", mentorIds).limit(1);
          if (reviewError) throw reviewError;
          visibleInPublicContext = Boolean(reviews?.length);
        }
      }

      permitted = isPublic || visibleInPublicContext || userId === id || isAdmin;
      objectKey = profile.avatar_storage_key;
    } else {
      const { data: course, error } = await admin.from("courses")
        .select("id, instructor_id, thumbnail_url, thumbnail_storage_key, status, is_public, deleted_at, is_latest_published")
        .eq("id", id).maybeSingle();
      if (error) throw error;
      if (!course || course.deleted_at) return json({ error: "Image not found" }, 404);
      // Public course images follow the marketplace visibility/version rules.
      // Private course thumbnails are available only to the course owner,
      // admins, and students with an active enrollment.
      const isPublic = course.status === "published" &&
        course.is_public === true &&
        course.is_latest_published === true &&
        course.deleted_at === null;
      let isEnrolledStudent = false;
      if (userId && !isPublic && userId !== course.instructor_id && !isAdmin) {
        const { data: enrollment, error: enrollmentError } = await admin
          .from("enrollments")
          .select("id")
          .eq("course_id", course.id)
          .eq("student_id", userId)
          .eq("status", "active")
          .maybeSingle();
        if (enrollmentError) throw enrollmentError;
        isEnrolledStudent = Boolean(enrollment);
      }
      permitted = isPublic || userId === course.instructor_id || isAdmin || isEnrolledStudent;
      objectKey = course.thumbnail_storage_key;
      resourceOwnerId = course.instructor_id;
    }
    if (!permitted) return json({ error: "Image not available" }, 403);
    // Only keys in the dedicated image namespaces are eligible. Legacy URLs
    // are intentionally not re-signed and continue to be rendered as-is.
    if (typeof objectKey !== "string" || !/^(avatars|course-thumbnails)\/[a-f0-9-]+\/.+\.(jpg|png|webp|gif)$/i.test(objectKey)) {
      return json({ error: "No private R2 image is attached to this resource" }, 404);
    }

    const expectedPrefix = type === "avatar" ? `avatars/${id}/` : `course-thumbnails/${resourceOwnerId}/${id}/`;
    if (!objectKey.startsWith(expectedPrefix)) {
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