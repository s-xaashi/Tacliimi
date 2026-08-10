import { supabase } from '/src/services/supabaseClient.js';
import { CourseService } from '/src/services/courseService.js';

const CANVAS_W = 2800, CANVAS_H = 1980;

const FIELD_COORDS = {
    studentPhoto:        { x: 1002, y: 504, r: 58 },
    studentName:         { x: 1476, y: 504, font: "italic 500 80px Fraunces, serif",       color: "#0B2D57", align: "center" },
    courseName:          { x: 1400, y: 671, font: "600 50px Fraunces, serif",               color: "#0B2D57", align: "center" },
    dateCompleted:       { x: 1161, y: 1246, font: "600 36px Fraunces, serif",               color: "#0B2D57", align: "center" },
    quizScore:           { x: 1440, y: 1246, font: "600 36px Fraunces, serif",               color: "#0B2D57", align: "center" },
    instructorSignature: { x: 1080, y: 1393, font: "500 60px Caveat, cursive",       color: "#0B2D57", align: "center" },
    instructorName:      { x: 1080, y: 1466, font: "600 24px Inter, sans-serif",             color: "#0B2D57", align: "center" },
    verificationCode:    { x: 182, y: 1902, font: "500 25px 'IBM Plex Mono', monospace",    color: "#0B2D57", align: "left" },
    dateIssued:          { x: 2618, y: 1904, font: "500 23px Inter, sans-serif",             color: "#0B2D57", align: "right" },
};

async function loadFonts() {
    await Promise.all([
        document.fonts.load("italic 500 80px Fraunces"),
        document.fonts.load("600 50px Fraunces"),
        document.fonts.load("500 60px Caveat"),
        document.fonts.load("500 25px 'IBM Plex Mono'"),
        document.fonts.load("500 23px Inter"),
    ]).catch(() => {});
    await document.fonts.ready;
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
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

const PHOTO_NAME_GAP = 40; // px gap between photo right edge and name left edge

function drawStudentPhotoAndName(ctx, name, photoImg, nameField, photoField) {
    // Photo is drawn at the FIXED coordinate so it aligns with the
    // pre-drawn circle border on the certificate background image.
    if (photoImg) {
        drawCircularPhoto(ctx, photoImg, photoField);
    }

    // Name starts to the right of the photo circle, with the gap.
    const nameLeftEdge = photoField.x + photoField.r + PHOTO_NAME_GAP;
    ctx.font = nameField.font;
    ctx.fillStyle = nameField.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, nameLeftEdge, nameField.y);
}

window.generateCertificate = async function () {
    const btn = document.getElementById('li-certificate-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    try {
        const studentId = window.currentUser?.id;
        const courseId = window.currentCourseData?.id;

        const [cert, studentProfile] = await Promise.all([
            CourseService.generateCertificate(studentId, courseId),
            supabase.from('profiles').select('full_name, avatar_url').eq('id', studentId).single().then(r => r.data)
        ]);

        await loadFonts();
        const bg = await loadImage('/public/assets/images/certificate-background.png');

        const canvas = document.createElement('canvas');
        canvas.width = CANVAS_W;
        canvas.height = CANVAS_H;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bg, 0, 0, CANVAS_W, CANVAS_H);

        let photoImg = null;
        if (studentProfile?.avatar_url) {
            try { photoImg = await loadImage(studentProfile.avatar_url); }
            catch { /* no photo available */ }
        }

        const dateCompleted = new Date(cert.completed_at_snapshot).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const dateIssued = new Date(cert.issued_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

        drawStudentPhotoAndName(ctx, studentProfile?.full_name || 'Student', photoImg, FIELD_COORDS.studentName, FIELD_COORDS.studentPhoto);
        drawText(ctx, window.currentCourseData?.title || 'Course', FIELD_COORDS.courseName);
        drawText(ctx, dateCompleted, FIELD_COORDS.dateCompleted);
        drawText(ctx, `${cert.quiz_score_snapshot}%`, FIELD_COORDS.quizScore);
        drawText(ctx, window.currentCourseData?.instructor?.full_name || 'Instructor', FIELD_COORDS.instructorSignature);
        drawText(ctx, window.currentCourseData?.instructor?.full_name || 'Instructor', FIELD_COORDS.instructorName);
        drawText(ctx, cert.verification_code, FIELD_COORDS.verificationCode);
        drawText(ctx, `${dateIssued} · Verify at tacliimi.com/verify`, FIELD_COORDS.dateIssued);

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
        const resetHtml = '<span class="material-symbols-outlined text-lg">workspace_premium</span> Generate My Certificate';
        if (btn) { btn.disabled = false; btn.innerHTML = resetHtml; }
        const mobileBtn = document.getElementById('li-certificate-btn-mobile');
        if (mobileBtn) { mobileBtn.disabled = false; mobileBtn.innerHTML = resetHtml; }
    }
};
