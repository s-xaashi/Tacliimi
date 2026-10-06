import { CourseService } from '/src/services/courseService.js';

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('verify-form');
    const input = document.getElementById('verify-code');
    const btn = document.getElementById('verify-btn');
    const resultContainer = document.getElementById('result-container');
    const loadingState = document.getElementById('loading-state');

    const urlParams = new URLSearchParams(window.location.search);
    const urlCode = urlParams.get('code') || urlParams.get('id');

    if (urlCode) {
        input.value = normalizeCode(urlCode);
        if (input.value.length === 8) {
            verifyCode(input.value);
        }
    }

    input.addEventListener('input', (event) => {
        event.target.value = normalizeCode(event.target.value);
        clearResult();
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const code = normalizeCode(input.value);
        input.value = code;

        if (code.length !== 8) {
            showError('Please enter the complete 8-character verification code.');
            input.focus();
            return;
        }

        verifyCode(code);
    });

    async function verifyCode(code) {
        setLoading(true);

        try {
            const result = await CourseService.verifyCertificate(code);
            setLoading(false);

            if (result.valid) {
                showValidCertificate(result.certificate);
            } else {
                showError('We could not find a certificate matching this verification code.');
            }
        } catch (error) {
            console.error('Certificate verification failed:', error);
            setLoading(false);
            showError('We could not connect to the verification service. Please try again.');
        }
    }

    function setLoading(isLoading) {
        input.disabled = isLoading;
        btn.disabled = isLoading;
        loadingState.classList.toggle('hidden', !isLoading);
        resultContainer.classList.add('hidden');

        btn.innerHTML = isLoading
            ? '<svg class="btn-icon loading-icon spin" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 5v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Verifying...</span>'
            : '<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Verify certificate</span>';
    }

    function showValidCertificate(cert) {
        const completed = formatDate(cert.completed_at_snapshot);
        const issued = formatDate(cert.issued_at);

        resultContainer.innerHTML = `
            <div class="result-card valid">
                <div class="result-header">
                    <div class="result-icon">
                        <svg class="result-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2 1.2 2.3-.1 1.1 2 2 1.1-.1 2.3 1.2 2-1.2 2 .1 2.3-2 1.1-1.1 2-2.3-.1L12 21l-2-1.2-2.3.1-1.1-2-2-1.1.1-2.3-1.2-2 1.2-2-.1-2.3 2-1.1 1.1-2 2.3.1L12 3z" fill="currentColor"/><path d="m8.5 12 2.2 2.2 4.8-5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </div>
                    <div>
                        <h2 class="result-title">Certificate verified</h2>
                        <p class="result-subtitle">This certificate is authentic and recorded by Tacliimi.</p>
                    </div>
                </div>

                <div class="details">
                    <div class="detail">
                        <p class="detail-label">Recipient</p>
                        <p class="detail-value">${escapeHtml(cert.student_name)}</p>
                    </div>

                    <div class="detail">
                        <p class="detail-label">Course</p>
                        <p class="detail-value">${escapeHtml(cert.course_title)}</p>
                    </div>

                    <div class="dates">
                        <div class="detail">
                            <p class="detail-label">Completed</p>
                            <p class="detail-value">${completed}</p>
                        </div>
                        <div class="detail">
                            <p class="detail-label">Issued</p>
                            <p class="detail-value">${issued}</p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        resultContainer.classList.remove('hidden');
    }

    function showError(message) {
        loadingState.classList.add('hidden');
        resultContainer.innerHTML = `
            <div class="result-card invalid">
                <div class="result-icon">
                    <svg class="result-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a8 8 0 1 0 8 8 8 8 0 0 0-8-8z" fill="currentColor"/><path d="M12 8v5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1" fill="#fff"/></svg>
                </div>
                <h2 class="result-title">Verification unsuccessful</h2>
                <p class="invalid-message">${escapeHtml(message)}</p>
            </div>
        `;
        resultContainer.classList.remove('hidden');
    }

    function normalizeCode(value) {
        const withoutPrefix = String(value ?? '')
            .toUpperCase()
            .trim()
            .replace(/^CERT[\s-]*/, '');

        return withoutPrefix
            .replace(/[^A-Z0-9]/g, '')
            .slice(0, 8);
    }

    function clearResult() {
        resultContainer.classList.add('hidden');
    }

    function formatDate(value) {
        if (!value) return '—';

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '—';

        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
});
