import { supabase } from '/src/services/supabaseClient.js';
import { CourseService } from '/src/services/courseService.js';
import { PaymentService } from '/src/services/paymentService.js';

import { CANVAS_W, CANVAS_H, GOLD, NAVY, ORIG, FS, PHOTO_NAME_GAP } from './certFieldConfig.js';

// ─── Font preload ──────────────────────────────────────────────────────────────────────────────
async function loadFonts() {
    await Promise.all([
        document.fonts.load(`italic 600 ${FS.name}px Fraunces`),
        document.fonts.load(`700 ${FS.course}px Fraunces`),
        document.fonts.load(`600 ${FS.date}px Fraunces`),
        document.fonts.load(`500 ${FS.sig}px Caveat`),
        document.fonts.load(`500 ${FS.tacliimiSig}px Caveat`),
        document.fonts.load(`600 ${FS.instrNm}px Inter`),
        document.fonts.load(`500 ${FS.ver}px 'IBM Plex Mono'`),
        document.fonts.load(`500 ${FS.issued}px Inter`),
    ]).catch(() => { });
    await document.fonts.ready;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
        img.src = src;
    });
}

/** Draw a circular photo with a decorative gold ring border. */
function drawCircularPhoto(ctx, img, cx, cy, r) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();

    // Gold ring border
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r + 7, 0, Math.PI * 2);
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.restore();
}

/** Draw placeholder ring when no avatar available. */
function drawPhotoPlaceholder(ctx, cx, cy, r) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#F5F0E8';
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r + 7, 0, Math.PI * 2);
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.restore();
}

function drawText(ctx, text, x, y, font, color, align = 'center') {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
}

/**
 * Draw photo + name as a horizontally centred group.
 */
function drawStudentPhotoAndName(ctx, name, photoImg, r) {
    ctx.font = `italic 600 ${FS.name}px Fraunces, serif`;
    const nameWidth = ctx.measureText(name).width;
    // Calculate total width of avatar group + gap + text
    const groupW = r * 2 + PHOTO_NAME_GAP + nameWidth;
    const groupStart = (CANVAS_W - groupW) / 2;
    const photoCX = groupStart + r;
    const nameCY = ORIG.nameY;

    if (photoImg) {
        drawCircularPhoto(ctx, photoImg, photoCX, nameCY, r);
    } else {
        drawPhotoPlaceholder(ctx, photoCX, nameCY, r);
    }

    ctx.font = `italic 600 ${FS.name}px Fraunces, serif`;
    ctx.fillStyle = NAVY;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, groupStart + r * 2 + PHOTO_NAME_GAP, nameCY);
}

// ─── Main certificate generator ───────────────────────────────────────────────

function certificateModalStep(step) {
    ['method', 'phone', 'processing', 'result'].forEach(name => {
        document.getElementById('cp-step-' + name)?.classList.add('hidden');
    });
    document.getElementById('cp-step-' + step)?.classList.remove('hidden');
}

function showCertificatePaymentResult(success, title, message, onContinue) {
    const container = document.getElementById('cp-result-container');
    const icon = document.getElementById('cp-result-icon');
    const btn = document.getElementById('cp-result-btn');
    if (!container || !icon || !btn) return;

    container.style.background = success ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)';
    container.style.color = success ? '#10b981' : '#ef4444';
    container.style.border = '2px solid ' + (success ? 'rgba(16,185,129,.2)' : 'rgba(239,68,68,.2)');
    icon.textContent = success ? 'check_circle' : 'error_outline';
    document.getElementById('cp-result-title').textContent = title;
    document.getElementById('cp-result-message').textContent = message;
    btn.style.background = success
        ? 'linear-gradient(135deg,#10b981,#059669)'
        : 'linear-gradient(135deg,#6c63ff,#4f46e5)';
    btn.textContent = success ? 'Generate Certificate' : 'Try Again';
    btn.onclick = onContinue || (() => certificateModalStep('method'));
    certificateModalStep('result');
}

window.closeCertificatePaymentModal = function () {
    const modal = document.getElementById('certificate-payment-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    document.body.style.overflow = '';
};

async function openCertificatePaymentModal(status) {
    const modal = document.getElementById('certificate-payment-modal');
    if (!modal) throw new Error('Certificate payment window is unavailable.');

    document.getElementById('cp-course-title').textContent = window.currentCourseData?.title || 'Course Certificate';
    document.getElementById('cp-student-name').textContent = window.currentUser?.user_metadata?.full_name || 'Student';
    document.getElementById('cp-price').textContent = '
    const btn = document.getElementById('li-certificate-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    try {
        const studentId = window.currentUser?.id;
        const courseId = window.currentCourseData?.id;

        const [cert, studentProfile] = await Promise.all([
            CourseService.generateCertificate(studentId, courseId),
            supabase.from('profiles').select('full_name, avatar_url').eq('id', studentId).single().then(r => r.data),
        ]);

        await loadFonts();
        const bg = await loadImage('/public/assets/images/certificate-background.png');

        const canvas = document.createElement('canvas');
        canvas.width = CANVAS_W;
        canvas.height = CANVAS_H;
        const ctx = canvas.getContext('2d');

        // Draw full unaffected background so corner flames / edge markers stay put perfectly
        ctx.drawImage(bg, 0, 0, CANVAS_W, CANVAS_H);

        let photoImg = null;
        if (studentProfile?.avatar_url) {
            try { photoImg = await loadImage(studentProfile.avatar_url); }
            catch { /* no avatar — placeholder ring will be drawn */ }
        }

        const dateCompleted = new Date(cert.completed_at_snapshot).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const dateIssued = new Date(cert.issued_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

        drawStudentPhotoAndName(
            ctx,
            studentProfile?.full_name || 'Student',
            photoImg,
            ORIG.photoR
        );

        // Course name — centred
        drawText(ctx,
            window.currentCourseData?.title || 'Course',
            CANVAS_W / 2,
            ORIG.courseY,
            `700 ${FS.course}px Fraunces, serif`,
            NAVY
        );

        // Date completed (left block)
        drawText(ctx,
            dateCompleted,
            ORIG.dateCX,
            ORIG.dateCY,
            `600 ${FS.date}px Fraunces, serif`,
            NAVY
        );

        // Quiz score (right block)
        drawText(ctx,
            `${cert.quiz_score_snapshot}%`,
            ORIG.scoreX,
            ORIG.scoreY,
            `600 ${FS.date}px Fraunces, serif`,
            NAVY
        );

        // Instructor cursive signature
        const instrName = window.currentCourseData?.instructor?.full_name || 'Instructor';
        drawText(ctx,
            instrName,
            ORIG.instrSigX,
            ORIG.instrSigY,
            `500 ${FS.sig}px Caveat, cursive`,
            NAVY
        );

        // Instructor name label (below signature line)
        drawText(ctx,
            instrName,
            ORIG.instrNmX,
            ORIG.instrNmY,
            `600 ${FS.instrNm}px Inter, sans-serif`,
            NAVY
        );

        // — Tacliimi stamp: draw brand logo as circular badge right of FINAL SCORE —
        try {
            const stampImg = await loadImage('/public/assets/images/7e3a1f5e-ba08-492e-87fa-6b1c28129e6c-removebg-preview.png');
            const { stampCX, stampCY, stampR } = ORIG;

            // Dark navy filled circle background
            ctx.save();
            ctx.beginPath();
            ctx.arc(stampCX, stampCY, stampR, 0, Math.PI * 2);
            ctx.fillStyle = NAVY;
            ctx.fill();
            ctx.restore();

            // Gold ring border
            ctx.save();
            ctx.beginPath();
            ctx.arc(stampCX, stampCY, stampR + 7, 0, Math.PI * 2);
            ctx.strokeStyle = GOLD;
            ctx.lineWidth = 6;
            ctx.stroke();
            ctx.restore();

            // Clip and draw logo inside the circle keeping natural aspect ratio (prevents X squeezing)
            const imgW = stampImg.naturalWidth || stampImg.width || 1;
            const imgH = stampImg.naturalHeight || stampImg.height || 1;
            const aspect = imgW / imgH;
            const logoH = stampR * 1.55;
            const logoW = logoH * aspect;

            ctx.save();
            ctx.beginPath();
            ctx.arc(stampCX, stampCY, stampR - 4, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(stampImg, stampCX - logoW / 2, stampCY - logoH / 2, logoW, logoH);
            ctx.restore();
        } catch { /* stamp image failed — skip gracefully */ }

        // Mask out the small pre-drawn cursive signature in the background template using exact image background color (#FBF8F1)
        ctx.fillStyle = '#FBF8F1';
        ctx.fillRect(ORIG.tacliimiSigX - 200, ORIG.tacliimiSigY - 15, 280, 40);

        // — Tacliimi cursive signature (right block over pre-drawn signature line) —
        drawText(ctx,
            'Tacliimi',
            ORIG.tacliimiSigX,
            ORIG.tacliimiSigY,
            `500 ${FS.tacliimiSig}px Caveat, cursive`,
            NAVY
        );

        // Verification code (bottom left)
        drawText(ctx,
            cert.verification_code,
            ORIG.verX,
            ORIG.verY,
            `500 ${FS.ver}px 'IBM Plex Mono', monospace`,
            NAVY,
            'left'
        );

        // Date issued (bottom right)
        drawText(ctx,
            `${dateIssued} · Verify at tacliimi.com/verify`,
            ORIG.issuedX,
            ORIG.issuedY,
            `500 ${FS.issued}px Inter, sans-serif`,
            NAVY,
            'right'
        );

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
 + Number(status.certificate_price || 0).toFixed(2);

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.style.overflow = 'hidden';
    certificateModalStep('method');
}

window.handleCertificateRequest = async function () {
    const studentId = window.currentUser?.id;
    const courseId = window.currentCourseData?.id;
    if (!studentId || !courseId) return;

    const desktopBtn = document.getElementById('li-certificate-btn');
    const mobileBtn = document.getElementById('li-certificate-btn-mobile');
    [desktopBtn, mobileBtn].forEach(btn => {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="animate-spin inline-block w-4 h-4 border-2 border-current/30 border-t-current rounded-full"></span> Checking...';
        }
    });

    try {
        const status = await CourseService.getCertificateGenerationStatus(studentId, courseId);
        if (!status?.eligible) {
            throw new Error(
                status?.reason === 'course_not_completed'
                    ? 'Complete all lessons to unlock your certificate.'
                    : 'Certificates are not enabled for this course.'
            );
        }

        if (!status.requires_payment) {
            await window.generateCertificate();
            return;
        }

        await openCertificatePaymentModal(status);
    } catch (e) {
        alert(e.message || 'Could not check certificate access.');
    } finally {
        const resetHtml = '<span class="material-symbols-outlined text-lg">workspace_premium</span> Generate My Certificate';
        [desktopBtn, mobileBtn].forEach(btn => {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = resetHtml;
            }
        });
    }
};

window.selectCertificateWallet = function (gateway, name, prefixDigit) {
    window._certificatePaymentGateway = gateway;
    document.getElementById('cp-wallet-name').textContent = name;
    const input = document.getElementById('cp-phone-input');
    input.value = '';
    input.placeholder = prefixDigit + 'xxxxxxx';
    document.getElementById('cp-phone-error').classList.add('hidden');
    certificateModalStep('phone');
    setTimeout(() => input.focus(), 250);
};

window.backToCertificateMethod = function () {
    certificateModalStep('method');
};

window.redirectCertificateToSifalo = async function () {
    certificateModalStep('processing');
    document.getElementById('cp-processing-title').textContent = 'Opening secure checkout...';
    document.getElementById('cp-processing-message').textContent = 'Redirecting you to Sifalo Pay.';
    try {
        const result = await PaymentService.startCertificatePayment(window.currentCourseData.id, 'USD');
        if (result?.already_paid) {
            window.closeCertificatePaymentModal();
            await window.generateCertificate();
        }
    } catch (e) {
        showCertificatePaymentResult(false, 'Checkout Failed', e.message, () => certificateModalStep('method'));
    }
};

async function pollCertificatePayment(orderId, sid) {
    for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        try {
            const result = await PaymentService.verifyTransaction(orderId, sid || null);
            if (result.status === 'success' && result.type === 'certificate') return true;
            if (result.status === 'failed') return false;
        } catch (_) {
            // Keep polling while the wallet request remains pending.
        }
    }
    return false;
}

window.submitCertificateDirectPayment = async function () {
    const input = document.getElementById('cp-phone-input');
    const errorEl = document.getElementById('cp-phone-error');
    const phone = input?.value.trim() || '';
    if (!phone || phone.length < 7) {
        errorEl.textContent = 'Please enter a valid phone number.';
        errorEl.classList.remove('hidden');
        return;
    }
    errorEl.classList.add('hidden');

    certificateModalStep('processing');
    document.getElementById('cp-processing-title').textContent = 'Confirm payment on your phone';
    document.getElementById('cp-processing-message').textContent = 'Approve the Sifalo payment request. We will verify it automatically.';

    try {
        const result = await PaymentService.createCertificateDirectPayment({
            courseId: window.currentCourseData.id,
            currency: 'USD',
            gateway: window._certificatePaymentGateway,
            account: phone
        });

        if (result.status === 'success' || result.already_paid) {
            window.closeCertificatePaymentModal();
            await window.generateCertificate();
            return;
        }

        if (result.status === 'pending' && result.order_id) {
            const paid = await pollCertificatePayment(result.order_id, result.sid);
            if (paid) {
                window.closeCertificatePaymentModal();
                await window.generateCertificate();
                return;
            }
            showCertificatePaymentResult(false, 'Payment Still Pending', 'Please approve the request on your phone, then try the payment again.', () => certificateModalStep('method'));
            return;
        }

        throw new Error(result.message || 'Your payment could not be completed.');
    } catch (e) {
        showCertificatePaymentResult(false, 'Payment Failed', e.message, () => certificateModalStep('method'));
    }
}

window.generateCertificate = async function () {
    const btn = document.getElementById('li-certificate-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    try {
        const studentId = window.currentUser?.id;
        const courseId = window.currentCourseData?.id;

        const [cert, studentProfile] = await Promise.all([
            CourseService.generateCertificate(studentId, courseId),
            supabase.from('profiles').select('full_name, avatar_url').eq('id', studentId).single().then(r => r.data),
        ]);

        await loadFonts();
        const bg = await loadImage('/public/assets/images/certificate-background.png');

        const canvas = document.createElement('canvas');
        canvas.width = CANVAS_W;
        canvas.height = CANVAS_H;
        const ctx = canvas.getContext('2d');

        // Draw full unaffected background so corner flames / edge markers stay put perfectly
        ctx.drawImage(bg, 0, 0, CANVAS_W, CANVAS_H);

        let photoImg = null;
        if (studentProfile?.avatar_url) {
            try { photoImg = await loadImage(studentProfile.avatar_url); }
            catch { /* no avatar — placeholder ring will be drawn */ }
        }

        const dateCompleted = new Date(cert.completed_at_snapshot).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const dateIssued = new Date(cert.issued_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

        drawStudentPhotoAndName(
            ctx,
            studentProfile?.full_name || 'Student',
            photoImg,
            ORIG.photoR
        );

        // Course name — centred
        drawText(ctx,
            window.currentCourseData?.title || 'Course',
            CANVAS_W / 2,
            ORIG.courseY,
            `700 ${FS.course}px Fraunces, serif`,
            NAVY
        );

        // Date completed (left block)
        drawText(ctx,
            dateCompleted,
            ORIG.dateCX,
            ORIG.dateCY,
            `600 ${FS.date}px Fraunces, serif`,
            NAVY
        );

        // Quiz score (right block)
        drawText(ctx,
            `${cert.quiz_score_snapshot}%`,
            ORIG.scoreX,
            ORIG.scoreY,
            `600 ${FS.date}px Fraunces, serif`,
            NAVY
        );

        // Instructor cursive signature
        const instrName = window.currentCourseData?.instructor?.full_name || 'Instructor';
        drawText(ctx,
            instrName,
            ORIG.instrSigX,
            ORIG.instrSigY,
            `500 ${FS.sig}px Caveat, cursive`,
            NAVY
        );

        // Instructor name label (below signature line)
        drawText(ctx,
            instrName,
            ORIG.instrNmX,
            ORIG.instrNmY,
            `600 ${FS.instrNm}px Inter, sans-serif`,
            NAVY
        );

        // — Tacliimi stamp: draw brand logo as circular badge right of FINAL SCORE —
        try {
            const stampImg = await loadImage('/public/assets/images/7e3a1f5e-ba08-492e-87fa-6b1c28129e6c-removebg-preview.png');
            const { stampCX, stampCY, stampR } = ORIG;

            // Dark navy filled circle background
            ctx.save();
            ctx.beginPath();
            ctx.arc(stampCX, stampCY, stampR, 0, Math.PI * 2);
            ctx.fillStyle = NAVY;
            ctx.fill();
            ctx.restore();

            // Gold ring border
            ctx.save();
            ctx.beginPath();
            ctx.arc(stampCX, stampCY, stampR + 7, 0, Math.PI * 2);
            ctx.strokeStyle = GOLD;
            ctx.lineWidth = 6;
            ctx.stroke();
            ctx.restore();

            // Clip and draw logo inside the circle keeping natural aspect ratio (prevents X squeezing)
            const imgW = stampImg.naturalWidth || stampImg.width || 1;
            const imgH = stampImg.naturalHeight || stampImg.height || 1;
            const aspect = imgW / imgH;
            const logoH = stampR * 1.55;
            const logoW = logoH * aspect;

            ctx.save();
            ctx.beginPath();
            ctx.arc(stampCX, stampCY, stampR - 4, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(stampImg, stampCX - logoW / 2, stampCY - logoH / 2, logoW, logoH);
            ctx.restore();
        } catch { /* stamp image failed — skip gracefully */ }

        // Mask out the small pre-drawn cursive signature in the background template using exact image background color (#FBF8F1)
        ctx.fillStyle = '#FBF8F1';
        ctx.fillRect(ORIG.tacliimiSigX - 200, ORIG.tacliimiSigY - 15, 280, 40);

        // — Tacliimi cursive signature (right block over pre-drawn signature line) —
        drawText(ctx,
            'Tacliimi',
            ORIG.tacliimiSigX,
            ORIG.tacliimiSigY,
            `500 ${FS.tacliimiSig}px Caveat, cursive`,
            NAVY
        );

        // Verification code (bottom left)
        drawText(ctx,
            cert.verification_code,
            ORIG.verX,
            ORIG.verY,
            `500 ${FS.ver}px 'IBM Plex Mono', monospace`,
            NAVY,
            'left'
        );

        // Date issued (bottom right)
        drawText(ctx,
            `${dateIssued} · Verify at tacliimi.com/verify`,
            ORIG.issuedX,
            ORIG.issuedY,
            `500 ${FS.issued}px Inter, sans-serif`,
            NAVY,
            'right'
        );

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
