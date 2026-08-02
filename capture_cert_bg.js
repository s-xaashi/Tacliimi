/**
 * capture_cert_bg.js
 * ---------------------------------------------------------------------------
 * Run with:  node capture_cert_bg.js
 * Requires:  npm install puppeteer  (or npx puppeteer ...)
 *
 * 1. Loads certificate-background.source.html at 2x device-pixel-ratio so
 *    every CSS pixel maps to 2 canvas pixels (giving 2800 × 1980 output).
 * 2. Measures the bounding-box centre of each dynamic text element BEFORE
 *    the text is cleared — layout is still valid at this point.
 * 3. Clears all placeholder text, leaving a blank certificate layout.
 * 4. Screenshots ONLY the .cert-wrap element (elementHandle.screenshot) so
 *    no browser chrome, scrollbar, or body padding leaks in.
 * 5. Saves the result directly to public/assets/images/certificate-background.png
 *    (the exact path certificateGenerator.js loads).
 * 6. Prints the measured FIELD_COORDS block ready to paste into certificateGenerator.js.
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// ─── paths ───────────────────────────────────────────────────────────────────
const SOURCE_HTML = path.resolve(__dirname, 'public/assets/certificate-background.source.html');
const OUTPUT_PNG  = path.resolve(__dirname, 'public/assets/images/certificate-background.png');

// Ensure output directory exists
fs.mkdirSync(path.dirname(OUTPUT_PNG), { recursive: true });

// ─── device scale ─────────────────────────────────────────────────────────────
// .cert-wrap is 1400 × 990 CSS px.  At 2× we get 2800 × 1980 physical px.
const DPR = 2;

(async () => {
    console.log('Launching browser…');
    const browser = await puppeteer.launch({ headless: true });
    const page    = await browser.newPage();

    await page.setViewport({ width: 1500, height: 1100, deviceScaleFactor: DPR });

    const fileUrl = 'file:///' + SOURCE_HTML.replace(/\\/g, '/');
    console.log('Loading:', fileUrl);
    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    // Extra wait for web fonts
    await new Promise(r => setTimeout(r, 2500));

    // ─── 1. Measure coordinates (with placeholder text present) ──────────────
    console.log('Measuring element coordinates…');
    const rawCoords = await page.evaluate((dpr) => {
        const cw = document.querySelector('.cert-wrap').getBoundingClientRect();

        function centreByField(selector) {
            const el = document.querySelector(`[data-field="${selector}"]`);
            if (!el) return null;
            
            // Use realistic lengths to not break flex layouts
            if (selector === 'studentName') el.textContent = 'Amina Ali';
            else if (selector === 'courseName') el.textContent = 'Introduction to Financial Modeling';
            else if (selector === 'dateCompleted') el.textContent = '12 Aug 2024';
            else if (selector === 'quizScore') el.textContent = '100%';
            else if (selector === 'instructorName') el.textContent = 'Dr. Jane Smith';
            else if (selector === 'verificationCode') el.textContent = 'TCL-123-ABC';
            else if (selector === 'dateIssued') el.textContent = '12 Aug 2024';
            else el.textContent = 'Sample Text';

            const r = el.getBoundingClientRect();
            return {
                x:  Math.round((r.left + r.width  / 2 - cw.left) * dpr),
                y:  Math.round((r.top  + r.height / 2 - cw.top ) * dpr),
                left:   Math.round((r.left  - cw.left) * dpr),
                right:  Math.round((r.right - cw.left) * dpr),
                top:    Math.round((r.top   - cw.top ) * dpr),
                bottom: Math.round((r.bottom - cw.top) * dpr),
                w: Math.round(r.width  * dpr),
                h: Math.round(r.height * dpr),
            };
        }

        return {
            certWrap:            { w: Math.round(cw.width * dpr), h: Math.round(cw.height * dpr) },
            photoCircle:         centreByField('studentPhoto'),
            studentName:         centreByField('studentName'),
            courseName:          centreByField('courseName'),
            dateCompleted:       centreByField('dateCompleted'),
            quizScore:           centreByField('quizScore'),
            instructorSignature: centreByField('instructorSignature'),
            instructorName:      centreByField('instructorName'),
            verifyCode:          centreByField('verificationCode'),
            issuedValue:         centreByField('dateIssued'),
        };
    }, DPR);

    console.log('\n=== RAW MEASUREMENTS (physical px @ 2x) ===');
    console.log(JSON.stringify(rawCoords, null, 2));

    // ─── 2. Clear all dynamic text ────────────────────────────────────────────
    console.log('\nClearing dynamic text…');
    await page.evaluate(() => {
        // Student name
        const sn = document.querySelector('.student-name');
        if (sn) sn.textContent = '';

        // Photo circle – leave the element but remove any src / background
        const pc = document.querySelector('.name-with-photo .photo-circle');
        if (pc) {
            pc.style.backgroundImage = 'none';
            pc.textContent = '';
        }

        // The standalone photo-circle (stats row area if present)
        document.querySelectorAll('.photo-circle').forEach(el => {
            el.style.backgroundImage = 'none';
            el.textContent = '';
        });

        // Course name
        const cn = document.querySelector('.course-name');
        if (cn) cn.textContent = '';

        // Stats: date completed, quiz score, any .stat-value
        document.querySelectorAll('.stat-value').forEach(el => el.textContent = '');

        // Instructor signature (Caveat script)
        const isig = document.querySelector('[data-field="instructorSignature"]');
        if (isig) isig.textContent = '';

        // Instructor name (printed below the line)
        const iname = document.querySelector('[data-field="instructorName"]');
        if (iname) iname.textContent = '';

        // Footer: verification code
        const vc = document.querySelector('.verify-code');
        if (vc) vc.textContent = '';

        // Footer: issued value (may contain a link)
        const iv = document.querySelector('.issued-value');
        if (iv) iv.innerHTML = '';

        // Remove the guide-toggle button (browser UI, not part of cert)
        const btn = document.getElementById('guideToggle');
        if (btn) btn.remove();
    });

    // Brief settle after DOM changes
    await new Promise(r => setTimeout(r, 500));

    // ─── 3. Screenshot the .cert-wrap element only ────────────────────────────
    console.log('Capturing .cert-wrap element screenshot…');
    const certWrapHandle = await page.$('.cert-wrap');
    if (!certWrapHandle) {
        throw new Error('.cert-wrap element not found on page');
    }

    await certWrapHandle.screenshot({ path: OUTPUT_PNG, type: 'png' });
    console.log('✅ Saved:', OUTPUT_PNG);

    // Verify dimensions
    const { width, height } = rawCoords.certWrap;
    console.log(`   Measured cert-wrap size: ${width} × ${height} px`);
    console.log(`   Expected:                2800 × 1980 px`);
    if (width !== 2800 || height !== 1980) {
        console.warn('⚠️  Dimensions mismatch — check the source HTML .cert-wrap size / aspect-ratio.');
    }

    await browser.close();

    // ─── 4. Print FIELD_COORDS ready to paste ─────────────────────────────────
    const c = rawCoords;
    const fieldCoords = `const FIELD_COORDS = {
    studentPhoto:        { x: ${c.photoCircle?.x      || 0}, y: ${c.photoCircle?.y     || 0}, r: ${Math.round((c.photoCircle?.w || 116) / 2)} },
    studentName:         { x: ${c.studentName?.x      || 0}, y: ${c.studentName?.y     || 0}, font: "italic 500 80px Fraunces, serif",       color: "#0B2D57", align: "center" },
    courseName:          { x: ${c.courseName?.x       || 0}, y: ${c.courseName?.y      || 0}, font: "600 50px Fraunces, serif",               color: "#0B2D57", align: "center" },
    dateCompleted:       { x: ${c.dateCompleted?.x    || 0}, y: ${c.dateCompleted?.y   || 0}, font: "600 36px Fraunces, serif",               color: "#0B2D57", align: "center" },
    quizScore:           { x: ${c.quizScore?.x        || 0}, y: ${c.quizScore?.y       || 0}, font: "600 36px Fraunces, serif",               color: "#0B2D57", align: "center" },
    instructorSignature: { x: ${c.instructorSignature?.x || 0}, y: ${c.instructorSignature?.y || 0}, font: "500 60px Caveat, cursive",       color: "#0B2D57", align: "center" },
    instructorName:      { x: ${c.instructorName?.x   || 0}, y: ${c.instructorName?.y  || 0}, font: "600 24px Inter, sans-serif",             color: "#0B2D57", align: "center" },
    verificationCode:    { x: ${c.verifyCode?.left    || 0}, y: ${c.verifyCode?.y      || 0}, font: "500 25px 'IBM Plex Mono', monospace",    color: "#0B2D57", align: "left" },
    dateIssued:          { x: ${c.issuedValue?.right  || 0}, y: ${c.issuedValue?.y     || 0}, font: "500 23px Inter, sans-serif",             color: "#0B2D57", align: "right" },
};`;

    console.log('\n=== PASTE THIS INTO certificateGenerator.js ===');
    console.log(fieldCoords);

})().catch(err => {
    console.error('ERROR:', err);
    process.exit(1);
});
