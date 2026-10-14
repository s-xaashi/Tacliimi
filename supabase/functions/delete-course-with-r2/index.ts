import { createClient } from "jsr:@supabase/supabase-js@2";
import { S3Client, DeleteObjectCommand } from "npm:@aws-sdk/client-s3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonResponse = (body: unknown, status = 400) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let courseId: string;
  let userId: string;
  let supabase: ReturnType<typeof createClient>;
  let course: any;
  let lessonRows: any[] = [];
  let r2AssetRows: any[] = [];
  let assetIdsToKeep: string[] = [];
  let keysToDelete: string[] = [];
  let lessonIdsToClear: string[] = [];
  let preserveFinancialHistory = false;
  let preservedSharedCount = 0;

  try {
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("Missing Authorization token");
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Server configuration is incomplete");

    supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) throw new Error("Your session is invalid. Please sign in again.");
    userId = user.id;

    const body = await req.json();
    courseId = typeof body?.course_id === "string" ? body.course_id : "";
    if (!courseId) throw new Error("Course ID is required");

    const { data: foundCourse, error: courseError } = await supabase
      .from("courses")
      .select("id, title, instructor_id, deleted_at, intro_video_storage_key")
      .eq("id", courseId)
      .maybeSingle();
    if (courseError) throw courseError;
    if (!foundCourse) throw new Error("Course not found");
    if (foundCourse.instructor_id !== userId) throw new Error("You are not authorized to delete this course");
    course = foundCourse;

    const { data: sections, error: sectionsError } = await supabase
      .from("course_sections")
      .select("id, course_lessons(id, section_id, video_storage_key, media_asset_id)")
      .eq("course_id", courseId);
    if (sectionsError) throw sectionsError;
    lessonRows = (sections ?? []).flatMap((section: any) => section.course_lessons ?? []);
    const lessonIds = lessonRows.map((lesson: any) => lesson.id).filter(Boolean);

    const linkedAssetIds = [...new Set(lessonRows.map((lesson: any) => lesson.media_asset_id).filter(Boolean))];
    if (linkedAssetIds.length) {
      const { data: assets, error: assetsError } = await supabase
        .from("course_media_assets")
        .select("id, storage_provider, storage_path")
        .in("id", linkedAssetIds);
      if (assetsError) throw assetsError;
      r2AssetRows = (assets ?? []).filter((asset: any) =>
        String(asset.storage_provider ?? "").toLowerCase() === "r2" && asset.storage_path
      );
    }

    const candidateKeys = [...new Set([
      course.intro_video_storage_key,
      ...lessonRows.map((lesson: any) => lesson.video_storage_key),
      ...r2AssetRows.map((asset: any) => asset.storage_path),
    ].filter((key: unknown): key is string => typeof key === "string" && key.trim().length > 0))];

    const sharedAssetIds = new Set<string>();
    const sharedKeys = new Set<string>();
    const candidateAssetIds = r2AssetRows.map((asset: any) => asset.id);

    if (candidateAssetIds.length) {
      const { data: refs, error } = await supabase.from("course_lessons")
        .select("id, section_id, media_asset_id").in("media_asset_id", candidateAssetIds);
      if (error) throw error;
      const outside = (refs ?? []).filter((row: any) => !lessonIds.includes(row.id));
      const outsideSectionIds = [...new Set(outside.map((row: any) => row.section_id).filter(Boolean))];
      if (outsideSectionIds.length) {
        const { data: outsideSections, error: outsideError } = await supabase
          .from("course_sections").select("id, course_id").in("id", outsideSectionIds);
        if (outsideError) throw outsideError;
        const courseBySection = new Map((outsideSections ?? []).map((row: any) => [row.id, row.course_id]));
        for (const row of outside) {
          if (courseBySection.get(row.section_id) !== courseId) sharedAssetIds.add(row.media_asset_id);
        }
      }
    }

    const lessonKeyCandidates = [...new Set(lessonRows.map((lesson: any) => lesson.video_storage_key).filter(Boolean))];
    if (lessonKeyCandidates.length) {
      const { data: refs, error } = await supabase.from("course_lessons")
        .select("id, section_id, video_storage_key").in("video_storage_key", lessonKeyCandidates);
      if (error) throw error;
      const outside = (refs ?? []).filter((row: any) => !lessonIds.includes(row.id));
      const outsideSectionIds = [...new Set(outside.map((row: any) => row.section_id).filter(Boolean))];
      if (outsideSectionIds.length) {
        const { data: outsideSections, error: outsideError } = await supabase
          .from("course_sections").select("id, course_id").in("id", outsideSectionIds);
        if (outsideError) throw outsideError;
        const courseBySection = new Map((outsideSections ?? []).map((row: any) => [row.id, row.course_id]));
        for (const row of outside) {
          if (courseBySection.get(row.section_id) !== courseId) sharedKeys.add(row.video_storage_key);
        }
      }
    }

    assetIdsToKeep = [...sharedAssetIds];
    const sharedAssetKeys = new Set(r2AssetRows
      .filter((asset: any) => sharedAssetIds.has(asset.id))
      .map((asset: any) => asset.storage_path).filter(Boolean));
    keysToDelete = candidateKeys.filter((key) => !sharedKeys.has(key) && !sharedAssetKeys.has(key));
    preservedSharedCount = new Set([...sharedKeys, ...sharedAssetKeys]).size;

    const r2AssetIdSet = new Set(r2AssetRows.map((asset: any) => asset.id));
    lessonIdsToClear = lessonRows.filter((lesson: any) =>
      lesson.video_storage_key || (lesson.media_asset_id && r2AssetIdSet.has(lesson.media_asset_id))
    ).map((lesson: any) => lesson.id);

    const [{ data: earnings, error: earningsError }, { data: payments, error: paymentsError }] = await Promise.all([
      supabase.from("instructor_earnings").select("id").eq("course_id", courseId).limit(1),
      supabase.from("payments").select("id").eq("course_id", courseId).limit(1),
    ]);
    if (earningsError) throw earningsError;
    if (paymentsError) throw paymentsError;
    preserveFinancialHistory = Boolean(earnings?.length || payments?.length);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unable to prepare course deletion" });
  }

  return new Response(new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const emit = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      void (async () => {
        try {
          const endpoint = Deno.env.get("R2_ENDPOINT") ?? "";
          const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
          const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
          const bucket = Deno.env.get("R2_BUCKET_NAME") ?? "";
          if (keysToDelete.length && (!endpoint || !accessKeyId || !secretAccessKey || !bucket)) {
            throw new Error("R2 storage configuration is incomplete. No database records were removed.");
          }

          emit({
            type: "progress", phase: "storage", completed: 0, total: keysToDelete.length,
            percent: keysToDelete.length ? 0 : 80,
            message: keysToDelete.length ? "Preparing stored lesson videos for deletion…" : "No unshared R2 videos need deletion.",
          });

          if (keysToDelete.length) {
            const s3 = new S3Client({ region: "auto", endpoint, credentials: { accessKeyId, secretAccessKey } });
            try {
              for (let i = 0; i < keysToDelete.length; i++) {
                await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: keysToDelete[i] }));
                emit({
                  type: "progress", phase: "storage", completed: i + 1, total: keysToDelete.length,
                  percent: Math.round(((i + 1) / keysToDelete.length) * 80),
                  message: `Deleted stored video ${i + 1} of ${keysToDelete.length}…`,
                });
              }
            } finally {
              s3.destroy();
            }
          }

          emit({ type: "progress", phase: "database", percent: 90, message: "Preserving financial history and updating course records…" });

          const safeAssetIds = r2AssetRows
            .filter((asset: any) => !assetIdsToKeep.includes(asset.id))
            .map((asset: any) => asset.id);
          if (safeAssetIds.length) {
            const { error } = await supabase.from("course_media_assets").delete().in("id", safeAssetIds);
            if (error) throw error;
          }

          if (lessonIdsToClear.length) {
            const { error } = await supabase.from("course_lessons")
              .update({ video_provider: "youtube", video_storage_key: null, media_asset_id: null })
              .in("id", lessonIdsToClear);
            if (error) throw error;
          }

          const hideCourse = async () => {
            const { data, error } = await supabase.from("courses")
              .update({ deleted_at: course.deleted_at || new Date().toISOString(), is_public: false })
              .eq("id", courseId).eq("instructor_id", userId).select("id").maybeSingle();
            if (error) throw error;
            if (!data) throw new Error("Course records could not be safely preserved. Please retry.");
            return { deleted: true, softDeleted: true };
          };

          let result: { deleted: boolean; softDeleted: boolean };
          if (preserveFinancialHistory) {
            result = await hideCourse();
          } else {
            const { data, error } = await supabase.from("courses").delete()
              .eq("id", courseId).eq("instructor_id", userId).select("id").maybeSingle();
            if (error?.code === "23503") {
              result = await hideCourse();
            } else if (error) {
              throw error;
            } else if (!data) {
              throw new Error("Course was not deleted. Refresh the page and try again.");
            } else {
              result = { deleted: true, softDeleted: false };
            }
          }

          emit({
            type: "done", percent: 100,
            message: result.softDeleted
              ? "Course removed. Instructor earnings and payment history were preserved."
              : "Course and its unshared R2 lesson videos were deleted.",
            result, deletedVideoCount: keysToDelete.length, preservedSharedVideoCount: preservedSharedCount,
          });
        } catch (error) {
          emit({
            type: "error", percent: 0,
            message: error instanceof Error ? error.message : "Course deletion failed. Records were kept where possible so cleanup can be retried.",
          });
        } finally {
          controller.close();
        }
      })();
    },
  }), {
    status: 200,
    headers: {
      ...corsHeaders, "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no",
    },
  });
});
