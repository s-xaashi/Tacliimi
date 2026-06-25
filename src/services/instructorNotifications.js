/**
 * instructorNotifications.js
 * Shared notification panel logic for all instructor pages.
 * Requires the following HTML elements in the page:
 *   #notif-wrapper, #notif-bell-btn, #notif-badge, #notif-panel, #notif-list, #notif-empty
 */
import { AuthService } from './authService.js';
import { NotificationService } from './notificationService.js';

let currentUserId = null;
let allNotifications = [];
let realtimeChannel = null;

// ---- Helpers ----

function timeAgo(isoDate) {
    const diff = Math.floor((Date.now() - new Date(isoDate)) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
}

function getTypeConfig(type) {
    const configs = {
        course_approved:     { icon: 'check_circle',   color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20',  label: 'Course Approved' },
        course_rejected:     { icon: 'cancel',         color: 'text-red-500',     bg: 'bg-red-50 dark:bg-red-900/20',          label: 'Course Rejected' },
        course_under_review: { icon: 'pending',        color: 'text-amber-500',   bg: 'bg-amber-50 dark:bg-amber-900/20',      label: 'Under Review' },
        profile_approved:    { icon: 'verified_user',  color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20',  label: 'Profile Approved' },
        profile_suspended:   { icon: 'gpp_bad',        color: 'text-red-500',     bg: 'bg-red-50 dark:bg-red-900/20',          label: 'Profile Suspended' },
        booking_created:     { icon: 'event',          color: 'text-indigo-500',  bg: 'bg-indigo-50 dark:bg-indigo-900/20',    label: 'New Booking' },
        booking_confirmed:   { icon: 'event_available',color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20',  label: 'Booking Confirmed' },
        booking_cancelled:   { icon: 'event_busy',     color: 'text-red-500',     bg: 'bg-red-50 dark:bg-red-900/20',          label: 'Booking Cancelled' },
        status_update:       { icon: 'update',         color: 'text-blue-500',    bg: 'bg-blue-50 dark:bg-blue-900/20',          label: 'Status Update' },
        message:             { icon: 'forum',          color: 'text-blue-500',    bg: 'bg-blue-50 dark:bg-blue-900/20',          label: 'New Message' },
        broadcast:           { icon: 'campaign',       color: 'text-purple-500',  bg: 'bg-purple-50 dark:bg-purple-900/20',    label: 'Announcement' },
    };
    return configs[type] || { icon: 'notifications', color: 'text-slate-400', bg: 'bg-slate-50 dark:bg-slate-800', label: 'Notification' };
}

function buildNotifItem(n) {
    const cfg = getTypeConfig(n.notification_type);
    const isBooking = ['booking_created', 'booking_confirmed', 'booking_cancelled', 'status_update', 'message'].includes(n.notification_type);
    const meta = n.metadata || {};

    const avatarSection = isBooking && meta.student_avatar
        ? `<img src="${meta.student_avatar}" class="w-9 h-9 rounded-full object-cover shrink-0 border-2 border-white dark:border-slate-700 shadow-sm" alt="${meta.student_name || 'Student'}">`
        : `<div class="w-9 h-9 rounded-full ${cfg.bg} flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-lg ${cfg.color}">${cfg.icon}</span></div>`;

    const studentMeta = isBooking && (meta.student_name || meta.session_type)
        ? `<div class="flex items-center gap-2 mt-1.5 flex-wrap">
            ${meta.student_name ? `<span class="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300"><span class="material-symbols-outlined text-[13px]">person</span>${meta.student_name}</span>` : ''}
            ${meta.session_type ? `<span class="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400"><span class="material-symbols-outlined text-[13px]">groups</span>${meta.session_type}</span>` : ''}
            ${meta.scheduled_at ? `<span class="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400"><span class="material-symbols-outlined text-[13px]">schedule</span>${new Date(meta.scheduled_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>` : ''}
           </div>` : '';

    return `
    <div id="notif-item-${n.id}" onclick="window.__notifHandleClick('${n.id}')"
        class="flex items-start gap-3 px-5 py-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors ${!n.is_read ? 'border-l-2 border-indigo-500 bg-indigo-50/30 dark:bg-indigo-900/10' : 'border-l-2 border-transparent'}">
        ${avatarSection}
        <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2">
                <p class="text-sm font-semibold text-slate-800 dark:text-white leading-snug">${n.title}</p>
                <span class="text-[10px] text-slate-400 shrink-0 mt-0.5">${timeAgo(n.created_at)}</span>
            </div>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed line-clamp-2">${n.message}</p>
            ${studentMeta}
        </div>
        ${!n.is_read ? '<span class="w-2 h-2 bg-indigo-500 rounded-full shrink-0 mt-2"></span>' : ''}
    </div>`;
}

function renderNotifications() {
    const list = document.getElementById('notif-list');
    const empty = document.getElementById('notif-empty');
    if (!list) return;
    // Remove all notification items (keep empty state element)
    list.querySelectorAll('[id^="notif-item-"]').forEach(el => el.remove());
    if (allNotifications.length === 0) {
        if (empty) empty.classList.remove('hidden');
        return;
    }
    if (empty) empty.classList.add('hidden');
    allNotifications.forEach(n => list.insertAdjacentHTML('beforeend', buildNotifItem(n)));
}

function updateBadge() {
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    const unread = allNotifications.filter(n => !n.is_read).length;
    unread > 0 ? badge.classList.remove('hidden') : badge.classList.add('hidden');
}

// ---- Public functions (attached to window so onclick="" works) ----

window.toggleNotifPanel = function () {
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    panel.classList.toggle('hidden');
};

window.__notifHandleClick = async function (notifId) {
    const notif = allNotifications.find(n => n.id === notifId);
    if (!notif) return;

    if (!notif.is_read) {
        notif.is_read = true;
        await NotificationService.markAsRead(notifId);
        const item = document.getElementById(`notif-item-${notifId}`);
        if (item) {
            item.classList.remove('border-indigo-500', 'bg-indigo-50/30', 'dark:bg-indigo-900/10');
            item.classList.add('border-transparent');
            item.querySelector('.bg-indigo-500.rounded-full')?.remove();
        }
        updateBadge();
    }

    // Redirection Logic
    const type = notif.notification_type;
    if (['booking_created', 'booking_confirmed', 'booking_cancelled'].includes(type)) {
        window.location.href = '/src/pages/instructor/instructor-mentorship/#requests';
    }
};

// Keep old name for backward compat with dashboard onclick
window.handleNotifClick = window.__notifHandleClick;

window.markAllRead = async function () {
    if (!currentUserId) return;
    allNotifications.forEach(n => n.is_read = true);
    await NotificationService.markAllAsRead(currentUserId);
    renderNotifications();
    updateBadge();
};

// ---- Init ----

async function init() {
    try {
        const session = await AuthService.getSession();
        if (!session) return;
        currentUserId = session.user.id;

        // Fetch up to 30 most recent notifications
        allNotifications = await NotificationService.getUserNotifications(currentUserId, 30);
        renderNotifications();
        updateBadge();

        // Real-time subscription: add new notifications instantly
        realtimeChannel = NotificationService.subscribeToNotifications(currentUserId, (newNotif) => {
            allNotifications.unshift(newNotif);
            renderNotifications();
            updateBadge();
            // Flash bell
            const btn = document.getElementById('notif-bell-btn');
            if (btn) {
                btn.classList.add('text-indigo-500');
                setTimeout(() => btn.classList.remove('text-indigo-500'), 2000);
            }
        });
    } catch (e) {
        console.error('[InstructorNotifications] Init error:', e);
    }
}

// Close panel when clicking outside the wrapper
document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('notif-wrapper');
    const panel = document.getElementById('notif-panel');
    if (wrapper && panel && !wrapper.contains(e.target)) {
        panel.classList.add('hidden');
    }
});

// Run on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
