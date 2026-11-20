import { createClient } from "jsr:@supabase/supabase-js@2";
import { S3Client, GetObjectCommand } from "npm:@aws-sdk/client-s3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const match = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
    if (!match) return json({ error: "Authentication required" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const endpoint = Deno.env.get("R2_ENDPOINT");
    const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
    const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
    const bucket = Deno.env.get("R2_BUCKET_NAME");
    if (![supabaseUrl, serviceRoleKey, endpoint, accessKeyId, secretAccessKey, bucket].every(Boolean)) {
      throw new Error("Playback service configuration is incomplete");
    }

    const supabase = createClient(supabaseUrl!, serviceRoleKey!);
    const { data: { user }, error: userError } = await supabase.auth.getUser(match[1]);
    if (userError || !user) return json({ error: "Invalid authentication token" }, 401);

    const body = await req.json();
    const courseId = typeof body.course_id === "string" ? body.course_id : "";
    const lessonId = typeof body.lesson_id === "string" ? body.lesson_id : "";
    const playbackType = body.playback_type ?? "lesson";
    if (!courseId || !["lesson", "intro"].includes(playbackType)) {
      return json({ error: "Invalid playback request" }, 400);
    }
    if (playbackType === "lesson" && !lessonId) {
      return json({ error: "Missing lesson_id" }, 400);
    }

    // Resolve the course first. The lesson must belong to this exact course;
    // a caller cannot combine an authorized course ID with another course's lesson.
    const { data: course, error: courseError } = await supabase
      .from("courses")
      .select("id,instructor_id,status,version_status,is_public,is_latest_published,deleted_at,intro_video_storage_key")
      .eq("id", courseId)
      .maybeSingle();
    if (courseError) throw courseError;
    if (!course || course.deleted_at) return json({ error: "Course not found" }, 404);

    const [instructorResult, adminResult, enrollmentResult] = await Promise.all([
      supabase.from("instructors").select("user_id,approval_status").eq("user_id", course.instructor_id).maybeSingle(),
      supabase.from("admin_auth").select("id,role,is_suspended").eq("id", user.id).maybeSingle(),
      supabase.from("enrollments").select("id").eq("student_id", user.id).eq("course_id", courseId).maybeSingle(),
    ]);
    if (instructorResult.error) throw instructorResult.error;
    if (adminResult.error) throw adminResult.error;
    if (enrollmentResult.error) throw enrollmentResult.error;

    const { data: profile, error: profileError } = await supabase
      .from("profiles").select("id,role,account_status").eq("id", course.instructor_id).maybeSingle();
    if (profileError) throw profileError;

    const isOwner = course.instructor_id === user.id;
    const isAdmin = !!adminResult.data &&
      ["superadmin", "course_manager", "finance_manager"].includes(adminResult.data.role) &&
      adminResult.data.is_suspended !== true;
    const isEnrolled = !!enrollmentResult.data;
    const isPublicCourse = course.is_public === true &&
      course.status === "published" &&
      course.version_status === "published" &&
      course.is_latest_published === true &&
      instructorResult.data?.approval_status === "approved" &&
      profile?.role === "instructor" &&
      profile.account_status === "active";

    let objectKey: string | null = null;
    if (playbackType === "intro") {
      if (!course.intro_video_storage_key) return json({ error: "Intro video not found" }, 404);
      if (!isOwner && !isEnrolled && !isAdmin && !isPublicCourse) {
        return json({ error: "Not authorized to view this introduction video" }, 403);
      }
      objectKey = course.intro_video_storage_key;
    } else {
      const { data: lesson, error: lessonError } = await supabase
        .from("course_lessons")
        .select("id,video_storage_key,is_preview,course_sections!inner(course_id)")
        .eq("id", lessonId)
        .eq("course_sections.course_id", courseId)
        .maybeSingle();
      if (lessonError) throw lessonError;
      if (!lesson?.video_storage_key) return json({ error: "Lesson video not found" }, 404);

      if (!isOwner && !isEnrolled && !isAdmin && !(lesson.is_preview === true && isPublicCourse)) {
        return json({ error: "Not authorized to view this lesson" }, 403);
      }
      objectKey = lesson.video_storage_key;
    }

    if (!objectKey) return json({ error: "Video is unavailable" }, 404);

    const s3Client = new S3Client({
      region: "auto",
      endpoint: endpoint!,
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
    });
    const playbackUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({ Bucket: bucket!, Key: objectKey }),
      { expiresIn: 900 },
    );

    return json({ playbackUrl });
  } catch (error) {
    console.error("r2-video-playback:", error);
    return json({ error: error instanceof Error ? error.message : "Unable to authorize video playback" }, 400);
  }
});
