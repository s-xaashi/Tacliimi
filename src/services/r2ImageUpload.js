import { supabase } from "./supabaseClient.js";

/**
 * Upload a public, immutable image to the Tacliimi R2 media bucket.
 * The Edge Function authenticates the user and signs an owner-scoped object key.
 */
export async function uploadPublicImage({ file, purpose, courseId = null }) {
    if (!file) throw new Error("An image file is required.");

    const { data, error } = await supabase.functions.invoke("r2-image-upload-url", {
        body: {
            purpose,
            course_id: courseId,
            content_type: file.type,
            file_size: file.size
        }
    });

    if (error) throw new Error(error.message || "Could not prepare image upload.");
    if (!data?.upload_url || !data?.public_url || !data?.required_headers) {
        throw new Error("The image upload service returned an invalid response.");
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

    return data.public_url;
}
