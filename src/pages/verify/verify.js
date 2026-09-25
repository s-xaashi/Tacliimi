import { CourseService } from '/src/services/courseService.js';

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('verify-form');
    const input = document.getElementById('verify-code');
    const btn = document.getElementById('verify-btn');
    const resultContainer = document.getElementById('result-container');
    const loadingState = document.getElementById('loading-state');

    // Auto-fill from URL params if available
    const urlParams = new URLSearchParams(window.location.search);
    const urlCode = urlParams.get('code') || urlParams.get('id');
    if (urlCode) {
        input.value = urlCode.toUpperCase();
        verifyCode(urlCode);
    }

    // Restrict input to alphanumeric
    input.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const code = input.value.trim();
        if (code.length > 0) {
            verifyCode(code);
        }
    });

    async function verifyCode(code) {
        input.disabled = true;
        btn.disabled = true;
        resultContainer.classList.add('hidden');
        loadingState.classList.remove('hidden');

        try {
            const result = await CourseService.verifyCertificate(code);
            loadingState.classList.add('hidden');
            resultContainer.classList.remove('hidden');

            if (result.valid) {
                const cert = result.certificate;
                const dCompleted = new Date(cert.completed_at_snapshot).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                const dIssued = new Date(cert.issued_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

                resultContainer.innerHTML = `
                    <div class="bg-emerald-50 dark:bg-emerald-900/20 border-2 border-emerald-500 rounded-2xl p-6 relative overflow-hidden">
                        <div class="absolute -right-4 -top-4 opacity-10">
                            <span class="material-symbols-outlined text-[100px] text-emerald-500">workspace_premium</span>
                        </div>
                        <div class="flex items-start gap-4 relative z-10">
                            <div class="shrink-0 w-12 h-12 bg-emerald-500 text-white rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/30">
                                <span class="material-symbols-outlined text-2xl">verified</span>
                            </div>
                            <div>
                                <h3 class="text-xl font-bold text-emerald-700 dark:text-emerald-400 mb-1">Valid Certificate</h3>
                                <p class="text-sm font-medium text-emerald-600/80 dark:text-emerald-500 mb-6">Authenticity verified securely</p>
                                
                                <div class="space-y-4">
                                    <div>
                                        <p class="text-[10px] font-bold text-emerald-600/60 uppercase tracking-wider mb-1">Recipient</p>
                                        <p class="font-bold text-slate-800 dark:text-white text-lg">${cert.student_name}</p>
                                    </div>
                                    <div>
                                        <p class="text-[10px] font-bold text-emerald-600/60 uppercase tracking-wider mb-1">Course</p>
                                        <p class="font-bold text-slate-800 dark:text-white">${cert.course_title}</p>
                                    </div>
                                    <div class="grid grid-cols-2 gap-4">
                                        <div>
                                            <p class="text-[10px] font-bold text-emerald-600/60 uppercase tracking-wider mb-1">Completed On</p>
                                            <p class="font-medium text-sm text-slate-700 dark:text-slate-300">${dCompleted}</p>
                                        </div>
                                        <div>
                                            <p class="text-[10px] font-bold text-emerald-600/60 uppercase tracking-wider mb-1">Issued On</p>
                                            <p class="font-medium text-sm text-slate-700 dark:text-slate-300">${dIssued}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                showError('Invalid or unrecognized verification code.');
            }
        } catch (e) {
            loadingState.classList.add('hidden');
            resultContainer.classList.remove('hidden');
            showError('Unable to connect to the verification service. Please try again.');
        } finally {
            input.disabled = false;
            btn.disabled = false;
        }
    }

    function showError(msg) {
        resultContainer.innerHTML = `
            <div class="bg-rose-50 dark:bg-rose-900/20 border-2 border-rose-500 rounded-2xl p-6 flex flex-col items-center text-center">
                <div class="w-16 h-16 bg-rose-500 text-white rounded-full flex items-center justify-center mb-4 shadow-lg shadow-rose-500/30">
                    <span class="material-symbols-outlined text-4xl">gpp_maybe</span>
                </div>
                <h3 class="text-lg font-bold text-rose-700 dark:text-rose-400 mb-2">Verification Failed</h3>
                <p class="text-sm font-medium text-rose-600">${msg}</p>
            </div>
        `;
    }
});
