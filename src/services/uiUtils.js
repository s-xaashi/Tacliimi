import { sanitizeUrl } from '../utils/js/sanitize.js';

/**
 * uiUtils.js
 * ===========================================================
 * Standalone Toast and Modal utility functions.
 * Extracted from notificationUI.js so they remain available
 * independently of the notification system.
 * ===========================================================
 */

/**
 * ── Toast Notification System ──
 * Displays a non-blocking floating notification.
 */
export function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'fixed top-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const colors = {
        success: 'bg-emerald-500 text-white shadow-lg shadow-emerald-200/50',
        error: 'bg-rose-500 text-white shadow-lg shadow-rose-200/50',
        warning: 'bg-amber-500 text-white shadow-lg shadow-amber-200/50',
        info: 'bg-indigo-500 text-white shadow-lg shadow-indigo-200/50'
    };
    const icons = {
        success: 'check_circle',
        error: 'error',
        warning: 'warning',
        info: 'info'
    };

    toast.className = `
        pointer-events-auto flex items-center gap-3 px-6 py-4 rounded-2xl 
        animate-[toast-in_0.4s_ease-out] transition-all duration-300
        ${colors[type] || colors.success}
    `;

    // SECURITY: Use DOM API instead of innerHTML to prevent XSS
    const iconEl = document.createElement('span');
    iconEl.className = 'material-symbols-outlined text-xl';
    iconEl.textContent = icons[type] || icons.success;

    const msgEl = document.createElement('p');
    msgEl.className = 'text-sm font-bold tracking-tight';
    msgEl.textContent = message; // textContent escapes all HTML

    toast.appendChild(iconEl);
    toast.appendChild(msgEl);

    container.appendChild(toast);

    const removeToast = () => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(() => toast.remove(), 300);
    };

    const timer = setTimeout(removeToast, 5000);
    toast.onclick = () => {
        clearTimeout(timer);
        removeToast();
    };
}

// Global styles for toast
if (!document.getElementById('toast-styles')) {
    const style = document.createElement('style');
    style.id = 'toast-styles';
    style.textContent = `
        @keyframes toast-in {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
    `;
    document.head.appendChild(style);
}

// Global exposure
window.showToast = showToast;

/**
 * ── Global Modal System ──
 * High-fidelity "pop windows" for confirmations and alerts.
 */

export function showConfirmModal({ title, message, icon = 'help', confirmText = 'Confirm', variant = 'indigo' }, onConfirm) {
    let container = document.getElementById('global-modal-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'global-modal-container';
        container.className = 'fixed inset-0 z-[10000] hidden items-center justify-center p-4';
        container.innerHTML = `
            <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity opacity-0" id="global-modal-overlay"></div>
            <div id="global-confirm-modal" class="relative bg-white dark:bg-slate-900 rounded-[2rem] w-full max-w-sm overflow-hidden shadow-2xl scale-95 opacity-0 transition-all duration-300 transform hidden">
                <div class="px-8 pt-10 pb-6 text-center">
                    <div class="w-16 h-16 bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center mx-auto mb-6" id="global-confirm-icon-bg">
                        <span class="material-symbols-outlined text-indigo-500 text-3xl font-bold" id="global-confirm-icon">help</span>
                    </div>
                    <h3 class="text-xl font-black text-slate-800 dark:text-white mb-2 tracking-tight" id="global-confirm-title">Are you sure?</h3>
                    <p class="text-sm font-medium text-slate-500 dark:text-slate-400 leading-relaxed" id="global-confirm-message">This action cannot be undone.</p>
                </div>
                <div class="px-8 pb-10 flex gap-3">
                    <button id="global-confirm-cancel-btn" class="flex-1 py-4 px-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-2xl font-bold text-xs transition-all active:scale-95">Cancel</button>
                    <button id="global-confirm-proceed-btn" class="flex-1 py-4 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold text-xs shadow-lg transition-all active:scale-95">Confirm</button>
                </div>
            </div>
            <div id="global-alert-modal" class="relative bg-white dark:bg-slate-900 rounded-[2rem] w-full max-w-sm overflow-hidden shadow-2xl scale-95 opacity-0 transition-all duration-300 transform hidden">
                <div class="px-8 pt-10 pb-6 text-center">
                    <div class="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6" id="global-alert-icon-bg">
                        <span class="material-symbols-outlined text-3xl font-bold" id="global-alert-icon">check_circle</span>
                    </div>
                    <h3 class="text-xl font-black text-slate-800 dark:text-white mb-2 tracking-tight" id="global-alert-title">Success</h3>
                    <p class="text-sm font-medium text-slate-500 dark:text-slate-400 leading-relaxed" id="global-alert-message">Action completed successfully.</p>
                </div>
                <div class="px-8 pb-10">
                    <button id="global-alert-close-btn" class="w-full py-4 px-4 bg-slate-900 dark:bg-white dark:text-slate-900 text-white rounded-2xl font-bold text-xs transition-all active:scale-95">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(container);

        if (!document.getElementById('modal-styles')) {
            const style = document.createElement('style');
            style.id = 'modal-styles';
            style.textContent = `
                .modal-backdrop-in { opacity: 1 !important; }
                .modal-content-in { opacity: 1 !important; transform: scale(1) !important; }
            `;
            document.head.appendChild(style);
        }
    }

    const modalContainer = document.getElementById('global-modal-container');
    const overlay = document.getElementById('global-modal-overlay');
    const modal = document.getElementById('global-confirm-modal');
    const alertModal = document.getElementById('global-alert-modal');

    alertModal.classList.add('hidden');
    modal.classList.remove('hidden');
    modalContainer.classList.remove('hidden');
    modalContainer.classList.add('flex');

    document.getElementById('global-confirm-title').textContent = title;
    document.getElementById('global-confirm-message').textContent = message;
    document.getElementById('global-confirm-icon').textContent = icon;

    const iconBg = document.getElementById('global-confirm-icon-bg');
    const proceedBtn = document.getElementById('global-confirm-proceed-btn');
    proceedBtn.textContent = confirmText;

    if (variant === 'danger') {
        iconBg.className = "w-16 h-16 bg-rose-50 dark:bg-rose-900/30 rounded-2xl flex items-center justify-center mx-auto mb-6";
        document.getElementById('global-confirm-icon').className = "material-symbols-outlined text-rose-500 text-3xl font-bold";
        proceedBtn.className = "flex-1 py-4 px-4 bg-rose-600 hover:bg-rose-700 text-white rounded-2xl font-bold text-xs shadow-lg shadow-rose-200 dark:shadow-none transition-all active:scale-95";
    } else {
        iconBg.className = "w-16 h-16 bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center mx-auto mb-6";
        document.getElementById('global-confirm-icon').className = "material-symbols-outlined text-indigo-500 text-3xl font-bold";
        proceedBtn.className = "flex-1 py-4 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold text-xs shadow-lg shadow-indigo-200 dark:shadow-none transition-all active:scale-95";
    }

    setTimeout(() => {
        overlay.classList.add('modal-backdrop-in');
        modal.classList.add('modal-content-in');
    }, 10);

    const close = () => {
        overlay.classList.remove('modal-backdrop-in');
        modal.classList.remove('modal-content-in');
        setTimeout(() => {
            modalContainer.classList.add('hidden');
            modalContainer.classList.remove('flex');
            modal.classList.add('hidden');
        }, 300);
    };

    proceedBtn.onclick = () => {
        close();
        if (onConfirm) onConfirm();
    };

    document.getElementById('global-confirm-cancel-btn').onclick = close;
    overlay.onclick = close;
}

export function showAlertModal({ title, message, type = 'success' }) {
    let container = document.getElementById('global-modal-container');
    if (!container) {
        showConfirmModal({ title: '', message: '' });
        container = document.getElementById('global-modal-container');
    }

    const modalContainer = document.getElementById('global-modal-container');
    const overlay = document.getElementById('global-modal-overlay');
    const confirmModal = document.getElementById('global-confirm-modal');
    const modal = document.getElementById('global-alert-modal');

    confirmModal.classList.add('hidden');
    modal.classList.remove('hidden');
    modalContainer.classList.remove('hidden');
    modalContainer.classList.add('flex');

    document.getElementById('global-alert-title').textContent = title;
    document.getElementById('global-alert-message').textContent = message;

    const iconBg = document.getElementById('global-alert-icon-bg');
    const icon = document.getElementById('global-alert-icon');

    if (type === 'error') {
        iconBg.className = "w-16 h-16 bg-rose-50 dark:bg-rose-900/30 rounded-2xl flex items-center justify-center mx-auto mb-6";
        icon.className = "material-symbols-outlined text-rose-500 text-3xl font-bold";
        icon.textContent = 'error';
    } else {
        iconBg.className = "w-16 h-16 bg-emerald-50 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center mx-auto mb-6";
        icon.className = "material-symbols-outlined text-emerald-500 text-3xl font-bold";
        icon.textContent = 'check_circle';
    }

    setTimeout(() => {
        overlay.classList.add('modal-backdrop-in');
        modal.classList.add('modal-content-in');
    }, 10);

    const close = () => {
        overlay.classList.remove('modal-backdrop-in');
        modal.classList.remove('modal-content-in');
        setTimeout(() => {
            modalContainer.classList.add('hidden');
            modalContainer.classList.remove('flex');
            modal.classList.add('hidden');
        }, 300);
    };

    document.getElementById('global-alert-close-btn').onclick = close;
    overlay.onclick = close;
}

window.showConfirmModal = showConfirmModal;
window.showAlertModal = showAlertModal;
window.renderSocialIconsHtml = renderSocialIconsHtml;

/**
 * ── Shared Social Icons Helper ──
 * Renders social icons from simpleicons.org
 */
export function renderSocialIconsHtml(links, iconColor = 'ffffff', iconClasses = 'w-5 h-5') {
    if (!links || typeof links !== 'object') return '';
    
    const platforms = [
        { key: 'github', icon: 'github' },
        { key: 'linkedin', icon: 'linkedin' },
        { key: 'twitter', icon: 'twitter' },
        { key: 'facebook', icon: 'facebook' },
        { key: 'website', icon: 'linktree' }
    ];

    let html = '';
    platforms.forEach(p => {
        const url = links[p.key];
        if (url && url.trim() !== '') {
            const rawUrl = url.startsWith('http') ? url : `https://${url}`;
            // SECURITY: Validate URL protocol — only allow http/https
            const safeUrl = sanitizeUrl(rawUrl);
            if (!safeUrl) return; // skip unsafe protocols (javascript:, data:, etc.)

            const iconUrl = `https://cdn.simpleicons.org/${p.icon}/${iconColor}`;
            html += `
                <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center hover:bg-slate-700 transition-all group" onclick="event.stopPropagation()">
                    <img src="${iconUrl}" class="${iconClasses} opacity-80 group-hover:opacity-100" alt="${p.key}">
                </a>
            `;
        }
    });

    return html;
}
