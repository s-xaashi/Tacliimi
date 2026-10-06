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
        input.value = urlCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
        if (input.value.length === 8) {
            verifyCode(input.value);
        }
    }

    input.addEventListener('input', (event) => {
        event.target.value = event.target.value
            .replace(/[^A-Za-z0-9]/g, '')
            .toUpperCase()
            .slice(0, 8);
        clearResult();
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const code = input.value.trim();

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
            ? '<span class="material-symbols-outlined spin">sync</span><span>Verifying...</span>'
            : '<span class="material-symbols-outlined">search</span><span>Verify certificate</span>';
    }

    function showValidCertificate(cert) {
        const completed = formatDate(cert.completed_at_snapshot);
        const issued = formatDate(cert.issued_at);

        resultContainer.innerHTML = `
            <div class="result-card valid">
                <div class="result-header">
                    <div class="result-icon">
                        <span class="material-symbols-outlined">verified</span>
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
                    <span class="material-symbols-outlined">error</span>
                </div>
                <h2 class="result-title">Verification unsuccessful</h2>
                <p class="invalid-message">${escapeHtml(message)}</p>
            </div>
        `;
        resultContainer.classList.remove('hidden');
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
