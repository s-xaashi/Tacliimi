// Run with: node extract_cert_coords.js
// Requires: npx playwright install chromium (if not already installed)
const { chromium } = require('playwright');
const path = require('path');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    await page.setViewportSize({ width: 1600, height: 1200 });

    const htmlPath = 'file:///' + path.resolve(__dirname, 'tacliimi_certificate_v2 (1).html').replace(/\\/g, '/');
    await page.goto(htmlPath);
    await page.waitForLoadState('networkidle');

    // Measure cert-wrap bounding box and relevant elements
    const coords = await page.evaluate(() => {
        const cw = document.querySelector('.cert-wrap').getBoundingClientRect();

        function rel(selector, part) {
            const el = document.querySelector(selector);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2 - cw.left;   // centre-x relative to cert-wrap
            const cy = r.top + r.height / 2 - cw.top;    // centre-y
            const left = r.left - cw.left;
            const right = r.right - cw.left;
            if (part === 'center') return { cx, cy };
            if (part === 'left')   return { x: left, cy };
            if (part === 'right')  return { x: right, cy };
            return { cx, cy, left, right, top: r.top - cw.top, bottom: r.bottom - cw.top, w: r.width, h: r.height };
        }

        return {
            certWrap: { w: cw.width, h: cw.height },
            nameRow: rel('.name-with-photo', 'all'),
            photoCircle: rel('.name-with-photo .photo-circle', 'all'),
            studentName: rel('.student-name', 'all'),
            courseName: rel('.course-name', 'all'),
            statsRow: rel('.stats-row', 'all'),
            dateBlock: rel('.stat-block:first-child .stat-value', 'all'),
            scoreBlock: rel('.stat-block:last-child .stat-value', 'all'),
            leftSign: rel('.sign-block:first-child .sign-script', 'all'),
            leftSignName: rel('.sign-block:first-child .sign-name', 'all'),
            rightSign: rel('.sign-block:last-child .sign-script', 'all'),
            rightSignName: rel('.sign-block:last-child .sign-name', 'all'),
            verifyCode: rel('.verify-code', 'all'),
            issuedValue: rel('.issued-value', 'all'),
            footerRow: rel('.footer-row', 'all'),
        };
    });

    // Scale all coords by 2 (deviceScaleFactor)
    const S = 2;
    function scale(obj) {
        if (!obj) return null;
        const result = {};
        for (const [k, v] of Object.entries(obj)) {
            result[k] = Math.round(v * S);
        }
        return result;
    }
    for (const k of Object.keys(coords)) {
        coords[k] = scale(coords[k]);
    }

    console.log('=== CERT COORDINATES (at 2x = canvas units) ===');
    console.log(JSON.stringify(coords, null, 2));

    await browser.close();
})();
