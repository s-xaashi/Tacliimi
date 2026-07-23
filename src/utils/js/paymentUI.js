import { PaymentService } from '/src/services/paymentService.js';

export function injectSecureWalletModal() {
    if (document.getElementById('payment-modal')) return;

    const modalHtml = `
    <!-- ═══════════════════════════════════════════════════════
         PAYMENT MODAL — Premium Tacliimi Pay
    ════════════════════════════════════════════════════════ -->
    <div id="payment-modal" class="fixed inset-0 z-[9999] hidden text-left" role="dialog" aria-modal="true">
        <!-- Backdrop: Fixed separate layer -->
        <div id="payment-backdrop"
            class="fixed inset-0 bg-slate-900/40 dark:bg-[#0f0c29]/80 backdrop-blur-xl transition-all duration-500"
            onclick="closePaymentModal()"></div>

        <!-- Scrollable Wrapper -->
        <div class="fixed inset-0 overflow-y-auto flex items-start justify-center p-4 sm:p-8 pointer-events-none">
            <!-- Modal card with Theme Adaptation -->
            <div class="relative z-10 w-full max-w-[440px] my-auto pointer-events-auto rounded-3xl overflow-hidden shadow-2xl dark:shadow-[0_40px_100px_rgba(0,0,0,0.8)] border border-slate-200 dark:border-white/10 animate-in fade-in zoom-in duration-500 bg-white dark:bg-slate-900">

                <!-- Glow Effect -->
                <div class="absolute -top-24 -left-24 w-48 h-48 bg-indigo-500/20 rounded-full blur-[80px]"></div>
                <div class="absolute -bottom-24 -right-24 w-48 h-48 bg-purple-500/20 rounded-full blur-[80px]"></div>

                <div class="relative z-20">
                    <!-- Header -->
                    <div class="px-8 pt-8 pb-6 flex items-center justify-between">
                        <div class="flex items-center gap-4">
                            <div class="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg transform rotate-3 hover:rotate-0 transition-transform duration-300"
                                style="background: linear-gradient(135deg, #6c63ff, #4f46e5);">
                                <span class="material-symbols-outlined text-white text-2xl">account_balance_wallet</span>
                            </div>
                            <div>
                                <h2 class="text-slate-900 dark:text-white font-bold text-xl tracking-tight">Tacliimi Pay
                                </h2>
                                <p
                                    class="text-primary dark:text-indigo-300/60 text-xs font-medium uppercase tracking-widest">
                                    Secure Checkout</p>
                            </div>
                        </div>
                        <button onclick="closePaymentModal()"
                            class="w-10 h-10 rounded-full flex items-center justify-center text-slate-400 dark:text-white/30 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-all">
                            <span class="material-symbols-outlined text-xl">close</span>
                        </button>
                    </div>

                    <!-- Dynamic Summary -->
                    <div class="mx-8 mb-6 p-5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                        
                        <div class="flex gap-4 mb-4" id="pm-summary-content">
                            <div class="relative w-16 h-16 rounded-xl overflow-hidden bg-primary/10 flex items-center justify-center border border-primary/20 shadow-sm flex-shrink-0">
                                <span id="pm-summary-icon" class="material-symbols-outlined text-primary text-3xl">rocket_launch</span>
                            </div>
                            <div class="flex-1 flex flex-col justify-center min-w-0">
                                <p id="pm-summary-overline" class="text-primary/70 dark:text-indigo-300/70 text-[10px] font-bold uppercase tracking-widest mb-1">Boosting</p>
                                <h3 id="pm-summary-title" class="text-slate-900 dark:text-white font-bold text-base leading-tight line-clamp-2">Premium Profile Boost</h3>
                            </div>
                        </div>

                        <div class="pt-4 border-t border-slate-200 dark:border-white/5 flex items-center justify-between">
                            <div class="flex items-center gap-2">
                                <span id="pm-animation-dot" class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                <p id="pm-summary-footer" class="text-slate-500 dark:text-white/40 text-[11px] font-medium italic">Boost activates automatically</p>
                            </div>
                            <div class="text-right">
                                <p
                                    class="text-primary/50 dark:text-indigo-300/50 text-[10px] font-bold uppercase tracking-widest">
                                    Total Due</p>
                                <p id="pm-price"
                                    class="text-xl font-bold text-slate-900 dark:text-white tracking-tight">$0.00</p>
                            </div>
                        </div>
                    </div>

                    <!-- Content Area (Scrollable if needed) -->
                    <div class="px-8 pb-8">
                        <!-- Step 1: Selection -->
                        <div id="pm-step-method">
                            <p class="text-slate-600 dark:text-white/80 text-sm font-semibold mb-4">Select Payment
                                Method</p>
                            <div class="grid grid-cols-1 gap-3" id="pm-wallet-grid">
                                <!-- EVC Plus -->
                                <button onclick="selectWallet('waafi', 'EVC Plus / Zaad / Sahal', '61')"
                                    class="group relative flex items-center gap-4 p-4 rounded-2xl border border-slate-200 dark:border-white/5 bg-white dark:bg-white/[0.02] hover:bg-slate-50 dark:hover:bg-white/[0.08] hover:border-primary/50 dark:hover:border-indigo-500/50 transition-all duration-300 text-left shadow-sm hover:shadow-md">
                                    <div
                                        class="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                                        <span
                                            class="material-symbols-outlined text-orange-600 dark:text-orange-400">smartphone</span>
                                    </div>
                                    <div class="flex-1">
                                        <p class="text-slate-900 dark:text-white text-sm font-bold">EVC Plus / Zaad /
                                            Sahal</p>
                                        <p class="text-slate-500 dark:text-white/40 text-[11px]">Primary Choice ·
                                            Instant Mobile Pay</p>
                                    </div>
                                    <span
                                        class="material-symbols-outlined text-slate-300 dark:text-white/10 group-hover:text-primary dark:group-hover:text-indigo-400 group-hover:translate-x-1 transition-all">chevron_right</span>
                                </button>

                                <!-- eDahab -->
                                <button onclick="selectWallet('edahab', 'eDahab', '63')"
                                    class="group relative flex items-center gap-4 p-4 rounded-2xl border border-slate-200 dark:border-white/5 bg-white dark:bg-white/[0.02] hover:bg-slate-50 dark:hover:bg-white/[0.08] hover:border-primary/50 dark:hover:border-indigo-500/50 transition-all duration-300 text-left shadow-sm hover:shadow-md">
                                    <div
                                        class="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                                        <span
                                            class="material-symbols-outlined text-blue-600 dark:text-blue-400">account_balance</span>
                                    </div>
                                    <div class="flex-1">
                                        <p class="text-slate-900 dark:text-white text-sm font-bold">eDahab</p>
                                        <p class="text-slate-500 dark:text-white/40 text-[11px]">Dahabshiil Group · Fast
                                            & Secure</p>
                                    </div>
                                    <span
                                        class="material-symbols-outlined text-slate-300 dark:text-white/10 group-hover:text-primary dark:group-hover:text-indigo-400 group-hover:translate-x-1 transition-all">chevron_right</span>
                                </button>

                                <!-- Premier Wallet -->
                                <button onclick="selectWallet('pbwallet', 'Premier Wallet', '65')"
                                    class="group relative flex items-center gap-4 p-4 rounded-2xl border border-slate-200 dark:border-white/5 bg-white dark:bg-white/[0.02] hover:bg-slate-50 dark:hover:bg-white/[0.08] hover:border-primary/50 dark:hover:border-indigo-500/50 transition-all duration-300 text-left shadow-sm hover:shadow-md">
                                    <div
                                        class="w-10 h-10 rounded-xl bg-teal-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                                        <span
                                            class="material-symbols-outlined text-teal-600 dark:text-teal-400">payments</span>
                                    </div>
                                    <div class="flex-1">
                                        <p class="text-slate-900 dark:text-white text-sm font-bold">Premier Wallet</p>
                                        <p class="text-slate-500 dark:text-white/40 text-[11px]">Direct Bank Sync · VIP
                                            Experience</p>
                                    </div>
                                    <span
                                        class="material-symbols-outlined text-slate-300 dark:text-white/10 group-hover:text-primary dark:group-hover:text-indigo-400 group-hover:translate-x-1 transition-all">chevron_right</span>
                                </button>

                                <!-- International -->
                                <div class="h-[1px] bg-slate-100 dark:bg-white/5 my-2"></div>
                                <button onclick="redirectToSifalo()"
                                    class="group relative flex items-center gap-4 p-4 rounded-2xl border border-slate-200 dark:border-white/5 bg-white dark:bg-white/[0.02] hover:bg-slate-50 dark:hover:bg-white/[0.08] hover:border-primary/50 dark:hover:border-indigo-500/50 transition-all duration-300 text-left shadow-sm hover:shadow-md">
                                    <div
                                        class="w-10 h-10 rounded-xl bg-slate-100 dark:bg-white/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                                        <span
                                            class="material-symbols-outlined text-slate-600 dark:text-white/60">public</span>
                                    </div>
                                    <div class="flex-1">
                                        <p class="text-slate-900 dark:text-white text-sm font-bold">International (Card
                                            / Apple / Google)</p>
                                        <p class="text-slate-500 dark:text-white/40 text-[11px]">Visa · Mastercard · Pay
                                            via Sifalo Checkout</p>
                                    </div>
                                    <span
                                        class="material-symbols-outlined text-slate-300 dark:text-white/10 group-hover:text-primary dark:group-hover:text-indigo-400 group-hover:translate-x-1 transition-all">chevron_right</span>
                                </button>
                            </div>
                        </div>

                        <!-- Step 2: Phone Input -->
                        <div id="pm-step-phone" class="hidden animate-in slide-in-from-right-4 duration-300">
                            <button onclick="backToMethodSelect()"
                                class="flex items-center gap-2 text-indigo-400 text-xs font-bold mb-6 hover:text-indigo-300 transition-colors uppercase tracking-widest">
                                <span class="material-symbols-outlined text-sm">arrow_back</span>
                                Change Method
                            </button>

                            <div class="mb-6">
                                <h3 class="text-slate-900 dark:text-white font-bold text-lg mb-1">Mobile Details</h3>
                                <p class="text-slate-500 dark:text-white/50 text-xs">Enter your <span
                                        id="pm-wallet-name" class="text-primary dark:text-indigo-300 font-bold"></span>
                                    mobile number</p>
                            </div>

                            <div class="relative group">
                                <div
                                    class="absolute inset-y-0 left-4 flex items-center gap-2 pr-2 border-r border-slate-200 dark:border-white/10">
                                    <span class="text-slate-400 dark:text-white/60 font-mono text-sm"
                                        id="pm-country-code">+252</span>
                                </div>
                                <input id="pm-phone-input" type="tel" inputmode="numeric" maxlength="9"
                                    placeholder="61xxxxxxx"
                                    class="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl pl-[72px] pr-4 py-4 text-slate-900 dark:text-white text-base font-mono outline-none focus:border-primary/50 dark:focus:border-indigo-500/50 focus:bg-white dark:focus:bg-white/[0.08] transition-all"
                                    oninput="this.value=this.value.replace(/\D/g,'')">
                            </div>
                            <p id="pm-phone-error" class="text-red-400 text-xs mt-3 flex items-center gap-2 hidden">
                                <span class="material-symbols-outlined text-[14px]">error_outline</span>
                                <span id="pm-phone-error-text">Please enter a valid number</span>
                            </p>

                            <button id="pm-pay-btn" onclick="submitDirectPayment()"
                                class="mt-8 w-full py-4 rounded-2xl font-bold border-0 text-white shadow-[0_10px_20px_rgba(79,70,229,0.3)] hover:shadow-[0_15px_25px_rgba(79,70,229,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center justify-center gap-3"
                                style="background: linear-gradient(135deg, #6c63ff, #4f46e5);">
                                <span class="material-symbols-outlined">bolt</span>
                                Proceed to Pay
                            </button>
                        </div>

                        <!-- Step 3: Processing -->
                        <div id="pm-step-processing"
                            class="hidden py-12 text-center animate-in zoom-in-95 duration-500">
                            <div class="relative w-24 h-24 mx-auto mb-8">
                                <div
                                    class="absolute inset-0 border-4 border-slate-100 dark:border-white/5 rounded-full">
                                </div>
                                <div
                                    class="absolute inset-0 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin">
                                </div>
                                <div
                                    class="absolute inset-4 bg-indigo-500/10 rounded-full flex items-center justify-center">
                                    <span
                                        class="material-symbols-outlined text-indigo-400 text-3xl animate-pulse">sync</span>
                                </div>
                            </div>
                            <h3 class="text-slate-900 dark:text-white font-bold text-xl mb-2">Securing your spot...</h3>
                            <p class="text-slate-500 dark:text-white/40 text-sm">Validating payment details with Sifalo
                                Pay Gateway</p>
                        </div>

                        <!-- Step 4: Result -->
                        <div id="pm-step-result" class="hidden py-6 text-center animate-in zoom-in-95 duration-500">
                            <div id="pm-result-container"
                                class="w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-6 text-4xl shadow-xl">
                                <!-- Icon and color set by JS -->
                                <span id="pm-result-icon">✅</span>
                            </div>
                            <h3 id="pm-result-title" class="text-slate-900 dark:text-white font-bold text-2xl mb-2">
                                Success!</h3>
                            <p id="pm-result-msg"
                                class="text-slate-500 dark:text-white/50 text-sm mb-10 leading-relaxed px-4"></p>

                            <button id="pm-result-btn"
                                class="w-full py-4 rounded-2xl font-bold text-white transition-all shadow-lg hover:brightness-110 hover:-translate-y-0.5 active:translate-y-0">
                                Continue
                            </button>
                        </div>
                    </div>

                    <!-- Footer -->
                    <div
                        class="px-8 py-4 bg-slate-50 dark:bg-black/20 border-t border-slate-200 dark:border-white/5 flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <span class="material-symbols-outlined text-emerald-500/50 text-base">verified_user</span>
                            <p
                                class="text-slate-400 dark:text-white/20 text-[10px] font-bold uppercase tracking-widest">
                                Sifalo Certified</p>
                        </div>
                        <div class="flex gap-4">
                            <span
                                class="material-symbols-outlined text-slate-300 dark:text-white/10 text-xl hover:text-primary dark:hover:text-white/30 transition-colors cursor-help"
                                title="256-bit SSL Protection">lock</span>
                            <span
                                class="material-symbols-outlined text-slate-300 dark:text-white/10 text-xl hover:text-primary dark:hover:text-white/30 transition-colors cursor-help"
                                title="Card Anti-Fraud Monitoring">security</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Current payment context
    window._pmContext = { type: null, referenceId: null, amount: 0, currency: 'USD', gateway: null, bannerText: null, planDays: null };

    // Standard DOM global logic
    window.showPaymentModal = function (amount, currency, context) {
        window._pmContext = { amount, currency, ...context };
        document.getElementById('pm-price').textContent = '$' + parseFloat(amount).toFixed(2);
        
        // Dynamic Label Rendering
        if (context.type === 'boost' || context.type === 'banner') {
             document.getElementById('pm-summary-overline').textContent = 'Securing Add-on';
             document.getElementById('pm-summary-title').textContent = context.type === 'banner' ? 'Promotional Banner Placement' : 'Premium Visibility Boost';
             document.getElementById('pm-summary-footer').textContent = 'Boost activates immediately';
             document.getElementById('pm-summary-icon').textContent = 'rocket_launch';
        } else {
             document.getElementById('pm-summary-overline').textContent = 'Enrolling In';
             document.getElementById('pm-summary-title').textContent = context.title || 'Course Access';
             document.getElementById('pm-summary-footer').textContent = 'Instant access after pay';
             document.getElementById('pm-summary-icon').textContent = 'school';
        }

        const modal = document.getElementById('payment-modal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        document.body.style.overflow = 'hidden';
        
        showStep('method'); // Make sure we show initial step
    };

    function showModal() {
        const modal = document.getElementById('payment-modal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        document.body.style.overflow = 'hidden';
    }

    window.closePaymentModal = function () {
        const modal = document.getElementById('payment-modal');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        document.body.style.overflow = '';
    };

    function showStep(step) {
        ['method', 'phone', 'processing', 'result'].forEach(s => {
            const el = document.getElementById('pm-step-' + s);
            if (el) el.classList.add('hidden');
        });
        const target = document.getElementById('pm-step-' + step);
        if (target) {
            target.classList.remove('hidden');
            target.style.animation = 'none';
            target.offsetHeight;
            target.style.animation = null;
        }
    }

    function showResult(success, title, message, details = null) {
        const container = document.getElementById('pm-result-container');
        const icon = document.getElementById('pm-result-icon');
        const btn = document.getElementById('pm-result-btn');

        if (success) {
            container.style.background = 'rgba(16, 185, 129, 0.1)';
            container.style.color = '#10b981';
            container.style.border = '2px solid rgba(16, 185, 129, 0.2)';
            icon.textContent = 'check_circle';
            icon.className = 'material-symbols-outlined text-5xl';
        } else {
            container.style.background = 'rgba(239, 68, 68, 0.1)';
            container.style.color = '#ef4444';
            container.style.border = '2px solid rgba(239, 68, 68, 0.2)';
            icon.textContent = 'error_outline';
            icon.className = 'material-symbols-outlined text-5xl';
        }

        document.getElementById('pm-result-title').textContent = title;

        let displayMsg = message;
        if (details) {
            if (details.message) displayMsg += ': ' + details.message;
            if (details.hint) displayMsg += ' (Hint: ' + details.hint + ')';
            if (details.code) displayMsg += ' [Code: ' + details.code + ']';
        }
        document.getElementById('pm-result-msg').textContent = displayMsg;

        if (success) {
            btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
            btn.textContent = 'Done';
            btn.onclick = () => { 
                window.closePaymentModal();
                window.location.reload(); 
            };
        } else {
            btn.style.background = 'linear-gradient(135deg, #6c63ff, #4f46e5)';
            btn.textContent = 'Try Again';
            btn.onclick = () => showStep('method');
        }
        showStep('result');
        if (success) {
            document.body.style.overflow = 'hidden';
        } else {
            showModal();
        }
    }

    window.selectWallet = function (gateway, name, prefixDigit) {
        window._pmContext.gateway = gateway;
        document.getElementById('pm-wallet-name').textContent = name;
        const input = document.getElementById('pm-phone-input');
        input.value = '';
        input.placeholder = prefixDigit + 'xxxxxxx';
        document.getElementById('pm-phone-error').classList.add('hidden');
        showStep('phone');
        setTimeout(() => input.focus(), 300);
    };

    window.backToMethodSelect = function () {
        showStep('method');
    };

    window.redirectToSifalo = async function () {
        showStep('processing');
        try {
            // Note: For instructor-courses/instructor-mentorship this flow is 
            // naturally handled if the backend responds { method: 'redirect' }. 
            // If they reach here on a boost via redirect block, it would be weird.
            // But we implement it for completeness to not break external buttons
            const action = window._pmContext.type === 'banner' ? 'startBannerPayment' : 'startBoostPayment';
            await PaymentService[action](
                window._pmContext.entityType,
                window._pmContext.referenceId,
                window._pmContext.amount,
                window._pmContext.planDays,
                window._pmContext.bannerText
            );
        } catch (err) {
            showResult(false, 'Checkout Failed', err.message);
        }
    };

    window.submitDirectPayment = async function () {
        const phone = document.getElementById('pm-phone-input').value.trim();
        const errEl = document.getElementById('pm-phone-error');

        if (!phone || phone.length < 7) {
            errEl.textContent = 'Please enter a valid phone number';
            errEl.classList.remove('hidden');
            return;
        }
        errEl.classList.add('hidden');

        showStep('processing');

        try {
            const ctx = window._pmContext;
            const result = await PaymentService.createDirectPayment({
                type: ctx.type,
                referenceId: ctx.referenceId,
                entityType: ctx.entityType,
                planDays: ctx.planDays,
                bannerText: ctx.bannerText,
                amount: ctx.amount,
                currency: ctx.currency,
                gateway: ctx.gateway,
                account: phone,
            });

            if (result.status === 'success') {
                showResult(true, 'Payment Successful! 🎉', 'Your payment was successfully verified securely and your boost has been activated.');
            } else {
                showResult(false, 'Payment Failed', result.message || 'Your payment could not be processed. Please try again.');
            }
        } catch (err) {
            showResult(false, 'Payment Failed', err.message);
        }
    };
}
