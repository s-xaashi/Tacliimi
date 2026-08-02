/**
 * Shared video embed utility — single source of truth for YouTube/Vimeo URL detection.
 *
 * Converts a YouTube or Vimeo watch/share URL to an embeddable iframe src.
 * Returns null for direct video file URLs (mp4, mov, etc.) so the caller can
 * fall back to a native <video> element instead.
 *
 * YouTube embeds include:
 *   - rel=0          : suppress related-video suggestions from other channels
 *   - modestbranding=1 : reduces YouTube branding during playback
 *
 * NOTE: The persistent YouTube watermark in the bottom-right corner is NOT
 * removed — YouTube's Terms of Service prohibit covering it via CSS overlays,
 * and the showinfo=0 parameter that previously suppressed it has been removed
 * from the YouTube Player API.
 */
export function getEmbedUrl(url) {
    if (!url) return null;
    try {
        // YouTube: https://www.youtube.com/watch?v=ID  or  https://youtu.be/ID
        const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
        if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}?rel=0&modestbranding=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`;

        // Vimeo: https://vimeo.com/ID  or  https://player.vimeo.com/video/ID
        const vimeoMatch = url.match(/(?:vimeo\.com\/(?:video\/)?|player\.vimeo\.com\/video\/)(\d+)/);
        if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}?api=1`;

        // Already an embed URL — pass through unchanged
        if (url.includes('/embed/') || url.includes('player.vimeo.com')) return url;
    } catch (e) { /* ignore malformed URLs */ }

    return null; // Direct video file — caller should use a <video> element
}

export function getEmbedPlatform(embedUrl) {
    if (!embedUrl) return null;
    if (embedUrl.includes('youtube.com')) return 'youtube';
    if (embedUrl.includes('vimeo.com')) return 'vimeo';
    return null;
}
