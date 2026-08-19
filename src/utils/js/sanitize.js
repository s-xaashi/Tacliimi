/**
 * sanitize.js
 * ============================================================
 * Lightweight DOM safety utilities.
 * 
 * RULE: Never set innerHTML with user-supplied content.
 * Use these helpers instead.
 * ============================================================
 */

/**
 * Safely sets the text content of an element.
 * Equivalent to element.textContent = value, but null-safe.
 * Use this instead of element.innerHTML = value for plain text.
 *
 * @param {HTMLElement} element
 * @param {*} value
 */
export function setText(element, value) {
    if (element) {
        element.textContent = value ?? '';
    }
}

/**
 * Creates an <img> element safely without string interpolation.
 * @param {string} src - Image URL
 * @param {string} alt - Alt text
 * @param {string} className - CSS class string
 * @returns {HTMLImageElement}
 */
export function createSafeImg(src, alt = '', className = '') {
    const img = document.createElement('img');
    img.src = src || '';
    img.alt = alt;
    if (className) img.className = className;
    return img;
}

/**
 * Creates an <a> element safely, validating the href protocol.
 * Only allows http: and https: protocols.
 * @param {string} href
 * @param {string} textContent
 * @param {string} className
 * @param {object} attrs - Additional attributes { key: value }
 * @returns {HTMLAnchorElement|null} null if href is unsafe
 */
export function createSafeLink(href, textContent = '', className = '', attrs = {}) {
    // Validate the URL
    try {
        const parsed = new URL(href, window.location.origin);
        if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    } catch {
        // Relative paths are fine
    }

    const a = document.createElement('a');
    a.href = href;
    if (textContent) a.textContent = textContent;
    if (className) a.className = className;
    for (const [k, v] of Object.entries(attrs)) {
        a.setAttribute(k, v);
    }
    return a;
}

/**
 * Sanitizes a URL string, returning null if the protocol is unsafe.
 * Use before setting any src, href, or action attribute from user data.
 * @param {string} url
 * @returns {string|null}
 */
export function sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return null;
    try {
        const parsed = new URL(url, window.location.origin);
        if (!['http:', 'https:', 'data:'].includes(parsed.protocol)) return null;
        // Block data: URIs for everything except images
        if (parsed.protocol === 'data:' && !url.startsWith('data:image/')) return null;
        return url;
    } catch {
        // Relative URL — safe
        return url;
    }
}
