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
    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(detail || `Image upload failed (HTTP ${response.status}).`);
    }
    return data.object_key;
}

/**
 * Resolve an image by its owning database record. The Edge Function performs
 * visibility/ownership checks; callers cannot submit arbitrary object keys.
 */
export async function resolvePrivateImage({ resourceType, resourceId }) {
    if (!resourceType || !resourceId) return null;
    const { data, error } = await supabase.functions.invoke("r2-image-url", {
        body: { resource_type: resourceType, resource_id: resourceId }
    });
    if (error) throw new Error(error.message || "Could not resolve image.");
    return data?.signed_url || null;
}
