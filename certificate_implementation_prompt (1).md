# Tacliimi — Certificate of Completion: Implementation Prompt for Antigravity

## Context (read first, do not skip)

This is the Tacliimi learning platform repo (vanilla JS + Vite multi-page app, Supabase backend, no framework). The certificate **background design is already finalized** — do not redesign it. The final approved file is `tacliimi_certificate_v2.html`, which contains these `data-field` markers that must map 1:1 to canvas draw targets:

`studentName`, `studentPhoto`, `courseName`, `congratsMessage` (static copy, baked into background), `dateCompleted`, `quizScore`, `seal`, `instructorSignature`, `instructorName`, `verificationCode`, `dateIssued`.

I have inspected the actual repo (not assumptions) and confirmed the following, so build against these exact names:

- **`enrollments`** table already has `completed_at TIMESTAMPTZ` (see `src/db/migrations/create_enrollments_wishlist.sql`) — **do not re-add this column**, just start populating it.
- **`courses`** table does **not** have `certificate_enabled` yet — needs adding.
- No `certificates` table exists yet — needs creating.
- Quiz correctness lives in `quiz_submission_answers.is_correct` (per question), linked via `quiz_submissions.quiz_id` → `quizzes.lesson_id` → `course_lessons.section_id` → `course_sections.course_id`. This exact join chain is already used in `course_marketplace_view` (`src/db/migrations/20260704_course_revisions.sql`, STEP 13) — reuse it.
- Instructor name/avatar is already available on every course fetch via `courses.instructor:profiles(full_name, avatar_url, ...)` in `CourseService.getCourseFull` (`src/services/courseService.js`) — no new column needed for instructor name.
- Student photo = `profiles.avatar_url` for the enrolled student (join on `enrollments.student_id`).
- The project's convention for server logic is `SECURITY DEFINER` plpgsql functions living in `src/db/migrations/*.sql` (see `get_or_create_course_revision`, `validate_coupon`, `create_update_offer`). Follow this pattern — put certificate logic in RPCs, not ad-hoc client-side queries, so scoring/verification can't be tampered with from the browser.
- The wizard uses a global `window.courseDraft` object (`src/utils/js/course-wizard.js`), synced to DB via `CourseService.saveDraft()` which spreads whatever is on the payload — so adding a new boolean field is mechanical once `courseDraft` carries it.
- Toggle-switch UI pattern already exists in `src/pages/instructor/instructor-mentorship/views/privacy.html` (`<input type="checkbox" class="sr-only peer">` + `peer-checked:bg-primary` sibling) — reuse this exact pattern for visual consistency, don't invent a new toggle style.

---

## Step 1 — Migration: `src/db/migrations/20260730_certificates.sql`

```sql
-- =============================================================================
-- MIGRATION: Certificates of Completion
-- =============================================================================

-- 1. Course-level toggle
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS certificate_enabled BOOLEAN NOT NULL DEFAULT false;

-- 2. certificates table — created once per (student, course), never regenerated
CREATE TABLE IF NOT EXISTS public.certificates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id           UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  verification_code   TEXT NOT NULL UNIQUE,
  quiz_score_snapshot NUMERIC(5,2) NOT NULL DEFAULT 100,
  issued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, course_id)
);

ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;

-- Students can only read their own certificates directly (no public SELECT policy —
-- public verification goes through the verify_certificate() RPC below instead,
-- so the table itself never needs to be exposed to anon reads).
CREATE POLICY "student_read_own_certificates" ON public.certificates
  FOR SELECT
  USING (student_id = auth.uid());

-- 3. get_course_quiz_score — aggregate correctness across every quiz question
--    in the course for a given student. Reuses the same join chain as
--    course_marketplace_view (section -> lesson -> quiz).
CREATE OR REPLACE FUNCTION public.get_course_quiz_score(p_student_id UUID, p_course_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_total_questions INTEGER;
  v_correct_answers INTEGER;
BEGIN
  SELECT COUNT(qq.id) INTO v_total_questions
  FROM course_sections cs
  JOIN course_lessons cl ON cl.section_id = cs.id
  JOIN quizzes qz ON qz.lesson_id = cl.id
  JOIN quiz_questions qq ON qq.quiz_id = qz.id
  WHERE cs.course_id = p_course_id AND cl.deleted_at IS NULL;

  IF v_total_questions IS NULL OR v_total_questions = 0 THEN
    RETURN 100; -- no quizzes in this course: full marks by default
  END IF;

  SELECT COUNT(qsa.id) INTO v_correct_answers
  FROM course_sections cs
  JOIN course_lessons cl ON cl.section_id = cs.id
  JOIN quizzes qz ON qz.lesson_id = cl.id
  JOIN quiz_submissions qs ON qs.quiz_id = qz.id AND qs.student_id = p_student_id
  JOIN quiz_submission_answers qsa ON qsa.submission_id = qs.id AND qsa.is_correct = true
  WHERE cs.course_id = p_course_id AND cl.deleted_at IS NULL;

  RETURN ROUND((v_correct_answers::NUMERIC / v_total_questions::NUMERIC) * 100, 2);
END;
$$;

-- 4. generate_certificate — idempotent: creates the row only the first time,
--    otherwise returns the existing snapshot untouched (score/code stay stable).
CREATE OR REPLACE FUNCTION public.generate_certificate(p_student_id UUID, p_course_id UUID)
RETURNS public.certificates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_existing public.certificates;
  v_new      public.certificates;
  v_enrolled BOOLEAN;
  v_completed_at TIMESTAMPTZ;
  v_cert_enabled BOOLEAN;
  v_code TEXT;
  v_score NUMERIC;
BEGIN
  SELECT (e.completed_at IS NOT NULL), c.certificate_enabled
    INTO v_completed_at, v_cert_enabled
  FROM enrollments e
  JOIN courses c ON c.id = e.course_id
  WHERE e.student_id = p_student_id AND e.course_id = p_course_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not enrolled in this course';
  END IF;
  IF v_completed_at IS NULL THEN
    RAISE EXCEPTION 'Course not yet completed';
  END IF;
  IF NOT v_cert_enabled THEN
    RAISE EXCEPTION 'Certificates are not enabled for this course';
  END IF;

  SELECT * INTO v_existing FROM certificates
  WHERE student_id = p_student_id AND course_id = p_course_id;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  v_score := public.get_course_quiz_score(p_student_id, p_course_id);
  v_code := 'CERT-' || upper(substr(md5(gen_random_uuid()::text), 1, 4))
            || '-' || upper(substr(md5(random()::text), 1, 4));

  INSERT INTO certificates (student_id, course_id, verification_code, quiz_score_snapshot)
  VALUES (p_student_id, p_course_id, v_code, v_score)
  RETURNING * INTO v_new;

  RETURN v_new;
END;
$$;

-- 5. verify_certificate — public lookup by code, no table access needed.
--    Returns only what the verification page should ever show.
CREATE OR REPLACE FUNCTION public.verify_certificate(p_code TEXT)
RETURNS TABLE (
  student_name TEXT,
  course_title TEXT,
  instructor_name TEXT,
  issued_at TIMESTAMPTZ,
  quiz_score_snapshot NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT p.full_name, c.title, ip.full_name, cert.issued_at, cert.quiz_score_snapshot
  FROM certificates cert
  JOIN profiles p ON p.id = cert.student_id
  JOIN courses c ON c.id = cert.course_id
  JOIN profiles ip ON ip.id = c.instructor_id
  WHERE cert.verification_code = p_code;
$$;

GRANT EXECUTE ON FUNCTION public.get_course_quiz_score(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_certificate(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_certificate(TEXT) TO anon, authenticated;
```

Run this in the Supabase SQL editor (same place `RUN_IN_SUPABASE_FIRST.sql` was run).

---

## Step 2 — `src/services/courseService.js`: add three methods

Add near `checkEnrollment`/`enrollCourse` (around line 803), matching existing style:

```js
async getCertificate(studentId, courseId) {
    const { data, error } = await supabase
        .from('certificates')
        .select('*')
        .eq('student_id', studentId)
        .eq('course_id', courseId)
        .maybeSingle();
    if (error) throw error;
    return data;
},

async generateCertificate(studentId, courseId) {
    const { data, error } = await supabase
        .rpc('generate_certificate', { p_student_id: studentId, p_course_id: courseId })
        .single();
    if (error) throw error;
    return data;
},

async verifyCertificate(code) {
    const { data, error } = await supabase
        .rpc('verify_certificate', { p_code: code });
    if (error) throw error;
    return (data && data.length > 0) ? data[0] : null;
},
```

No change needed to `getCourseFull` — it already does `SELECT *` on `courses`, so `certificate_enabled` comes through automatically.

---

## Step 3 — Course wizard toggle

**`src/pages/instructor/instructor-courses/wizard.html`** — in the Review & Publish step, directly after the closing `</div>` of the "Privacy Settings" `<section>` (the one with the Public/Private radios, around line 565), insert a new section using the same toggle-switch markup as `src/pages/instructor/instructor-mentorship/views/privacy.html`:

```html
<section class="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 p-6">
    <h3 class="font-bold text-lg mb-4 flex items-center gap-2">
        <span class="material-symbols-outlined text-primary">workspace_premium</span>
        Certificate of Completion
    </h3>
    <label class="flex items-center justify-between gap-4 p-4 rounded-lg border-2 border-slate-200 dark:border-slate-700 cursor-pointer">
        <div class="flex flex-col">
            <span class="font-bold text-slate-900 dark:text-slate-100">Enable certificate for this course</span>
            <span class="text-sm text-slate-600 dark:text-slate-400">Students who complete 100% of the course can generate and download a Tacliimi Certificate of Completion.</span>
        </div>
        <div class="relative inline-flex shrink-0">
            <input type="checkbox" id="certificate-enabled-toggle" class="sr-only peer">
            <div class="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
        </div>
    </label>
</section>
```

**`src/utils/js/course-wizard.js`**:

1. In `loadDraft()` (around line 169, right after `privacy:` is set), add:
```js
certificate_enabled: course.certificate_enabled || false,
```
and after the DOM-population block (around line 258), add:
```js
const certToggle = document.getElementById('certificate-enabled-toggle');
if (certToggle) certToggle.checked = window.courseDraft.certificate_enabled;
```

2. In `setupEventListeners()` (wherever the `privacyEl` change listener is set, around line 608), add a matching listener:
```js
document.getElementById('certificate-enabled-toggle')?.addEventListener('change', (e) => {
    window.courseDraft.certificate_enabled = e.target.checked;
    window.saveDraft(true);
});
```

3. In `performSave()` payload (around line 331, next to `is_public:`), add:
```js
certificate_enabled: window.courseDraft.certificate_enabled === true,
```

---

## Step 4 — Completion detection: `src/pages/learning/learning-interface/learningInterface.js`

Modify `syncCourseProgress()` (currently ~line 446) to also stamp `completed_at` the first time 100% is reached — guarded with `.is('completed_at', null)` so it truly only ever sets once:

```js
async function syncCourseProgress() {
    if (!currentUser || !currentCourseData || totalLessonCount === 0) return;
    const courseLessonIds = new Set();
    currentCourseData.course_sections.forEach(s => (s.course_lessons || []).forEach(l => courseLessonIds.add(l.id)));
    let count = 0;
    completedLessonIds.forEach(id => { if (courseLessonIds.has(id)) count++; });
    const percentage = Math.min(100, Math.round((count / totalLessonCount) * 100));
    try {
        await supabase.from('enrollments')
            .update({ progress_percentage: percentage, updated_at: new Date().toISOString() })
            .eq('student_id', currentUser.id).eq('course_id', currentCourseData.id);

        if (percentage === 100) {
            // Only ever sets completed_at the first time — no-op on subsequent calls.
            await supabase.from('enrollments')
                .update({ completed_at: new Date().toISOString() })
                .eq('student_id', currentUser.id).eq('course_id', currentCourseData.id)
                .is('completed_at', null);
            maybeShowCertificateButton();
        }
    } catch (e) {
        console.error("Error syncing course progress:", e);
    }
}

function maybeShowCertificateButton() {
    const btn = document.getElementById('li-certificate-btn');
    if (btn && currentCourseData?.certificate_enabled) {
        btn.classList.remove('hidden');
    }
}
```

Also call `maybeShowCertificateButton()` once at the end of the `DOMContentLoaded` handler (after `updateProgressUI()` is first invoked), so returning students who already completed the course see the button immediately without needing a fresh completion event.

**`src/pages/learning/learning-interface/index.html`** — inside the progress card (right after the progress bar `<div>`, around line 113), add:

```html
<button id="li-certificate-btn" onclick="window.generateCertificate()"
    class="hidden mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 bg-accent-gold hover:brightness-95 text-white font-bold rounded-xl transition-all shadow-lg shadow-accent-gold/20">
    <span class="material-symbols-outlined text-lg">workspace_premium</span>
    Generate My Certificate
</button>
```

---

## Step 5 — Static certificate background asset

The finalized `tacliimi_certificate_v2.html` bakes the dynamic values directly into the DOM for previewing. For Canvas API drawing we need a **blank background image** instead — border, logo, headings, congrats copy, and decorative seal/signature labels all baked in, but `studentName`, `studentPhoto`, `courseName`, `dateCompleted`, `quizScore`, `instructorName`/`instructorSignature`, `verificationCode`, `dateIssued` left empty.

1. Duplicate `tacliimi_certificate_v2.html`, blank out those specific `data-field` elements' text content (keep the elements/positions intact so layout doesn't shift).
2. Render it headlessly at 2× scale (2800×1980) for a crisp download, and export to PNG.
3. Save as `public/assets/images/certificate-background.png`.
4. Keep the source HTML too (e.g. `public/assets/certificate-background.source.html`) so the background can be regenerated later if the design changes.

---

## Step 6 — Certificate generation: new file `src/pages/learning/learning-interface/certificateGenerator.js`

```js
import { supabase } from '/src/services/supabaseClient.js';
import { CourseService } from '/src/services/courseService.js';

const CANVAS_W = 2800, CANVAS_H = 1980; // matches the 2x background export

const FIELD_COORDS = {
    // All values are pixel positions on the 2800x1980 canvas — measure these
    // directly from the background PNG using the "Show dynamic-field guides"
    // overlay already built into tacliimi_certificate_v2.html (multiply the
    // 1400x990 guide coordinates by 2).
    studentPhoto:  { x: 1000, y: 610, r: 76 },
    studentName:   { x: 1400, y: 640, font: "italic 500 80px Fraunces, serif", color: "#0B2D57", align: "center" },
    courseName:    { x: 1400, y: 745, font: "600 50px Fraunces, serif", color: "#0B2D57", align: "center" },
    dateCompleted: { x: 1140, y: 1085, font: "600 36px Fraunces, serif", color: "#0B2D57", align: "center" },
    quizScore:     { x: 1400, y: 1085, font: "600 36px Fraunces, serif", color: "#0B2D57", align: "center" },
    instructorSignature: { x: 985,  y: 1290, font: "500 60px Caveat, cursive", color: "#0B2D57", align: "center" },
    instructorName:      { x: 985,  y: 1335, font: "600 24px Inter, sans-serif", color: "#0B2D57", align: "center" },
    verificationCode:    { x: 190,  y: 1885, font: "500 25px 'IBM Plex Mono', monospace", color: "#0B2D57", align: "left" },
    dateIssued:          { x: 2610, y: 1885, font: "500 23px Inter, sans-serif", color: "#0B2D57", align: "right" },
};
// NOTE FOR IMPLEMENTER: the numbers above are placeholders — open the finalized
// background PNG in an image editor (or re-open certificate-background.source.html
// with the field-guide toggle at 2x zoom) and replace every x/y with the true
// measured center-point of each field before shipping.

async function loadFonts() {
    await Promise.all([
        new FontFace('Fraunces', "url(https://fonts.gstatic.com/s/fraunces/v31/6NUh8FyLNQOQZAnv9bYE0Fs.woff2)").load().then(f => document.fonts.add(f)),
        document.fonts.load("italic 500 80px Fraunces"),
        document.fonts.load("600 60px Caveat"),
        document.fonts.load("500 25px 'IBM Plex Mono'"),
        document.fonts.load("500 23px Inter"),
    ]).catch(() => {}); // fall back to system fonts silently if a load fails
    // Simpler/more robust in practice: just link the same Google Fonts <link>
    // tags used in tacliimi_certificate_v2.html into this page's <head>, then
    // await document.fonts.ready before drawing. Prefer that over FontFace()
    // hand-rolling shown above.
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

function drawCircularPhoto(ctx, img, field) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(field.x, field.y, field.r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, field.x - field.r, field.y - field.r, field.r * 2, field.r * 2);
    ctx.restore();
}

function drawText(ctx, text, field) {
    ctx.font = field.font;
    ctx.fillStyle = field.color;
    ctx.textAlign = field.align;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, field.x, field.y);
}

window.generateCertificate = async function () {
    const btn = document.getElementById('li-certificate-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    try {
        const session = window.currentUser || (await import('/src/services/authService.js')).AuthService;
        const studentId = window.currentUser?.id; // reuse currentUser already set in learningInterface.js
        const courseId = window.currentCourseData?.id;

        const [cert, studentProfile] = await Promise.all([
            CourseService.generateCertificate(studentId, courseId),
            supabase.from('profiles').select('full_name, avatar_url').eq('id', studentId).single().then(r => r.data)
        ]);

        await loadFonts();
        const bg = await loadImage('/assets/images/certificate-background.png');

        const canvas = document.createElement('canvas');
        canvas.width = CANVAS_W;
        canvas.height = CANVAS_H;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bg, 0, 0, CANVAS_W, CANVAS_H);

        if (studentProfile?.avatar_url) {
            try {
                const photo = await loadImage(studentProfile.avatar_url);
                drawCircularPhoto(ctx, photo, FIELD_COORDS.studentPhoto);
            } catch { /* no photo available — leave the circle blank, background already has a placeholder ring */ }
        }

        drawText(ctx, studentProfile?.full_name || 'Student', FIELD_COORDS.studentName);
        drawText(ctx, window.currentCourseData?.title || 'Course', FIELD_COORDS.courseName);
        drawText(ctx, new Date(cert.issued_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), FIELD_COORDS.dateCompleted);
        drawText(ctx, `${cert.quiz_score_snapshot}%`, FIELD_COORDS.quizScore);
        drawText(ctx, window.currentCourseData?.instructor?.full_name || 'Instructor', FIELD_COORDS.instructorSignature);
        drawText(ctx, window.currentCourseData?.instructor?.full_name || 'Instructor', FIELD_COORDS.instructorName);
        drawText(ctx, cert.verification_code, FIELD_COORDS.verificationCode);
        drawText(ctx, `${new Date(cert.issued_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} · Verify at tacliimi.com/verify`, FIELD_COORDS.dateIssued);

        canvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Tacliimi-Certificate-${cert.verification_code}.png`;
            a.click();
            URL.revokeObjectURL(url);
        }, 'image/png');

    } catch (e) {
        alert('Could not generate certificate: ' + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined text-lg">workspace_premium</span> Generate My Certificate'; }
    }
};
```

Import it from `index.html` with a `<script type="module" src="./certificateGenerator.js"></script>` tag placed after `learningInterface.js` loads (so `window.currentUser` / `window.currentCourseData` exist) — or, simpler and less fragile: move `currentUser`/`currentCourseData` in `learningInterface.js` from `let` module-scoped variables to `window.currentUser` / `window.currentCourseData` assignments alongside the existing `let`s, so this new file can read them without a race condition.

---

## Step 7 — Verification page

**New file `src/pages/verify/index.html`** (brand-consistent, minimal):

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Verify Certificate — Tacliimi</title>
<script src="https://cdn.tailwindcss.com?plugins=forms"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:wght@500;600&display=swap" rel="stylesheet">
<style>body{font-family:'Inter',sans-serif;background:#FAF9F6;}</style>
</head>
<body class="min-h-screen flex items-center justify-center p-6">
  <div class="max-w-lg w-full bg-white rounded-2xl shadow-xl border border-slate-100 p-8" id="result">
    <p class="text-slate-500">Checking verification code…</p>
  </div>
  <script type="module" src="./verify.js"></script>
</body>
</html>
```

**New file `src/pages/verify/verify.js`**:

```js
import { CourseService } from '/src/services/courseService.js';

const params = new URLSearchParams(window.location.search);
const code = params.get('code');
const el = document.getElementById('result');

(async () => {
    if (!code) {
        el.innerHTML = `<p class="text-rose-500 font-semibold">No verification code provided.</p>`;
        return;
    }
    try {
        const cert = await CourseService.verifyCertificate(code.trim().toUpperCase());
        if (!cert) {
            el.innerHTML = `
                <div class="flex items-center gap-3 text-rose-600 mb-2">
                    <span class="material-symbols-outlined">cancel</span>
                    <h1 class="font-bold text-lg">Not a valid certificate</h1>
                </div>
                <p class="text-slate-500 text-sm">We couldn't find a certificate matching code <b>${code}</b>.</p>`;
            return;
        }
        el.innerHTML = `
            <div class="flex items-center gap-3 text-emerald-600 mb-4">
                <span class="material-symbols-outlined">verified</span>
                <h1 class="font-bold text-lg">This certificate is authentic</h1>
            </div>
            <dl class="space-y-3 text-sm">
                <div><dt class="text-slate-400 uppercase text-xs tracking-wide">Issued to</dt><dd class="font-semibold text-slate-800 font-serif text-base">${cert.student_name}</dd></div>
                <div><dt class="text-slate-400 uppercase text-xs tracking-wide">Course</dt><dd class="font-semibold text-slate-800">${cert.course_title}</dd></div>
                <div><dt class="text-slate-400 uppercase text-xs tracking-wide">Instructor</dt><dd class="text-slate-700">${cert.instructor_name}</dd></div>
                <div><dt class="text-slate-400 uppercase text-xs tracking-wide">Issued on</dt><dd class="text-slate-700">${new Date(cert.issued_at).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</dd></div>
                <div><dt class="text-slate-400 uppercase text-xs tracking-wide">Final score</dt><dd class="text-slate-700">${cert.quiz_score_snapshot}%</dd></div>
            </dl>`;
    } catch (e) {
        el.innerHTML = `<p class="text-rose-500 font-semibold">Error: ${e.message}</p>`;
    }
})();
```

Add a route entry for `/verify` in `src/utils/js/routes.js` following whatever pattern the other public pages (e.g. `/marketplace`) use there.

---

## Build order for Antigravity

1. Run the SQL migration (Step 1) in Supabase first — everything else depends on it.
2. `courseService.js` methods (Step 2).
3. Wizard toggle (Step 3) — instructors need this before any student can generate anything.
4. Completion detection + button markup (Step 4).
5. Export the static background asset (Step 5) — blocks Step 6 entirely.
6. `certificateGenerator.js` (Step 6) — measure real coordinates against the exported PNG before considering this done; the placeholder coordinates in this prompt are illustrative only.
7. Verification page (Step 7) — independent, can be built in parallel with Step 6.

One open decision for you (the instructor) to confirm before build: should `dateCompleted` on the certificate reflect `enrollments.completed_at` (when the student actually finished) or `certificates.issued_at` (when they clicked "Generate")? The SQL above snapshots `issued_at` only — if you want both dates shown distinctly, say so and I'll add `completed_at` to the `certificates` table too so it's frozen at generation time rather than re-read live.
