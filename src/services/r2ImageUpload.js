import { supabase } from "./supabaseClient.js";

/**
 * Upload an image into the existing private R2 bucket.
 * Returns only the opaque object key; never constructs or returns a public URL.
 */
export async function uploadPrivateImage({ file, purpose, courseId = null }) {
    if (!file) throw new Error("An image file is required.");

    const { data, error } = await supabase.functions.invoke("r2-image-upload-url", {
        body: { purpose, course_id: courseId, content_type: file.type, file_size: file.size }
    });
    if (error) throw new Error(error.message || "Could not prepare image upload.");
    if (!data?.upload_url || !data?.object_key || !data?.required_headers) {
        throw new Error("The private image upload service returned an invalid response.");
    }

    const response = await fetch(data.upload_url, {
        method: "PUT",
        headers: data.required_headers,
        body: file
    });
    // A 412 means a prior attempt already created this one-time object key.
    // Continue to server verification so a lost PUT response can be retried safely.
    if (!response.ok && response.status !== 412) {
        const detail = await response.text().catch(() => "");
        throw new Error(detail || `Image upload failed (HTTP ${response.status}).`);
    }

    // Verify the actual stored object server-side before allowing its key to be
    // persisted in a profile/course row.
    const { data: verified, error: verifyError } = await supabase.functions.invoke("r2-image-upload-complete", {
        body: { purpose, course_id: courseId, object_key: data.object_key }
    });
    if (verifyError || verified?.verified !== true) {
        throw new Error(verifyError?.message || verified?.error || "The uploaded image failed server-side verification.");
    }
    return data.object_key;
}

/**
 * Resolve an image by its owning database record. The Edge Function performs
 * visibility/ownership checks; callers cannot submit arbitrary object keys.
 */
const signedImageCache = new Map();

export async function resolvePrivateImage({ resourceType, resourceId, visibilityContext = null, visibilityContextId = null }) {
    if (!resourceType || !resourceId) return null;
    // Do not reuse a signed URL cached under a different authenticated account.
    // The URL remains a bearer token until expiry, so cache isolation matters.
    const { data: { session } } = await supabase.auth.getSession();
    const cacheKey = `${session?.user?.id || "anonymous"}:${resourceType}:${resourceId}:${visibilityContext || "default"}:${visibilityContextId || ""}`;
    // Bound memory use and discard expired URLs while resolving.
    for (const [key, value] of signedImageCache) {
        if (value.expiresAt <= Date.now()) signedImageCache.delete(key);
    }
    if (signedImageCache.size > 200) signedImageCache.clear();
    const cached = signedImageCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 5000) return cached.url;
    const { data, error } = await supabase.functions.invoke("r2-image-url", {
        body: { resource_type: resourceType, resource_id: resourceId, visibility_context: visibilityContext, visibility_context_id: visibilityContextId }
    });
    if (error) throw new Error(error.message || "Could not resolve image.");
    if (!data?.signed_url) return null;
    signedImageCache.set(cacheKey, { url: data.signed_url, expiresAt: Date.now() + (Number(data.expires_in || 60) * 1000) });
    return data.signed_url;
}

/** Invalidate signed URLs after a resource's storage key changes. */
export function invalidatePrivateImageCache({ resourceType, resourceId }) {
    const prefix = `:${resourceType}:${resourceId}:`;
    for (const key of signedImageCache.keys()) {
        if (key.includes(prefix)) signedImageCache.delete(key);
    }
}

/**
 * A stored private key is authoritative. Never fall back to a legacy public URL
 * after private resolution fails, because that could bypass visibility checks.
 * Legacy URLs are used only for records that have no private storage key.
 */
export async function resolveProfileAvatar(profile, visibilityContext = null, visibilityContextId = null) {
    // Mentorship records have their own `id`; avatar ownership always belongs to the user profile.
    const profileId = profile?.instructor_id || profile?.id;
    if (profile?.avatar_storage_key) {
        if (!profileId) return null;
        return await resolvePrivateImage({ resourceType: "avatar", resourceId: profileId, visibilityContext, visibilityContextId });
    }
    return profile?.avatar_url || null;
}

/** A private thumbnail must never fall back to a legacy public URL on denial. */
export async function resolveCourseThumbnail(course) {
    if (course?.thumbnail_storage_key) {
        if (!course?.id) return null;
        return await resolvePrivateImage({ resourceType: "thumbnail", resourceId: course.id });
    }
    return course?.thumbnail_url || null;
}


/**
 * Delete a replaced/orphaned private image only after the database no longer
 * references its object key. The Edge Function rechecks ownership and refs.
 */
export async function deletePrivateImage({ resourceType, resourceId, objectKey }) {
    if (!resourceType || !resourceId || !objectKey) return false;
    const { data, error } = await supabase.functions.invoke("r2-image-delete", {
        body: { resource_type: resourceType, resource_id: resourceId, object_key: objectKey }
    });
    if (error) throw new Error(error.message || "Could not clean up the old image.");
    return data?.deleted === true;
}


/** Opportunistically remove abandoned, unreferenced image objects older than 24 hours. */
export async function cleanupPrivateImages() {
    const { data, error } = await supabase.functions.invoke("r2-image-cleanup", { body: {} });
    if (error) throw new Error(error.message || "Could not clean up abandoned images.");
    return Number(data?.cleaned || 0);
}
