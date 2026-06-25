/**
 * studentNotifications.js
 * Shared notification panel logic for all student pages.
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
        booking_created:     { icon: 'history_edu',    color: 'text-indigo-500',  bg: 'bg-indigo-50 dark:bg-indigo-900/20',    label: 'Booking Request' },
        booking_confirmed:   { icon: 'event_available',color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20',  label: 'Session Accepted' },
        booking_negotiating: { icon: 'handshake',      color: 'text-amber-500',   bg: 'bg-amber-50 dark:bg-amber-900/20',      label: 'Negotiation Started' },
        link_provided:       { icon: 'link',           color: 'text-blue-500',    bg: 'bg-blue-50 dark:bg-blue-900/20',          label: 'Meeting Link Ready' },
        booking_cancelled:   { icon: 'event_busy',     color: 'text-red-500',     bg: 'bg-red-50 dark:bg-red-900/20',          label: 'Session Cancelled' },
        pending_rejection_review: { icon: 'gavel',     color: 'text-rose-500',    bg: 'bg-rose-50 dark:bg-rose-900/20',        label: 'Under Admin Review' },
        status_update:       { icon: 'update',         color: 'text-blue-500',    bg: 'bg-blue-50 dark:bg-blue-900/20',          label: 'Status Update' },
        message:             { icon: 'forum',          color: 'text-blue-500',    bg: 'bg-blue-50 dark:bg-blue-900/20',          label: 'New Message' },
        broadcast:           { icon: 'campaign',       color: 'text-purple-500',  bg: 'bg-purple-50 dark:bg-purple-900/20',    label: 'Announcement' },
    };
    return configs[type] || { icon: 'notifications', color: 'text-slate-400', bg: 'bg-slate-50 dark:bg-slate-800', label: 'Notification' };
}

function buildNotifItem(n) {
    const cfg = getTypeConfig(n.notification_type);
    const isBooking = ['booking_created', 'booking_confirmed', 'booking_cancelled', 'booking_negotiating', 'link_provided', 'pending_rejection_review', 'status_update', 'message'].includes(n.notification_type);
    const meta = n.metadata || {};

    const avatarSection = isBooking && meta.mentor_avatar
        ? `<img src="${meta.mentor_avatar}" class="w-9 h-9 rounded-full object-cover shrink-0 border-2 border-white dark:border-slate-700 shadow-sm" alt="${meta.mentor_name || 'Mentor'}">`
        : `<div class="w-9 h-9 rounded-full ${cfg.bg} flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-lg ${cfg.color}">${cfg.icon}</span></div>`;

    const mentorMeta = isBooking && (meta.mentor_name || meta.session_type)
        ? `<div class="flex items-center gap-2 mt-1.5 flex-wrap">
            ${meta.mentor_name ? `<span class="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300"><span class="material-symbols-outlined text-[13px]">person</span>${meta.mentor_name}</span>` : ''}
            ${meta.session_type ? `<span class="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400"><span class="material-symbols-outlined text-[13px]">groups</span>${meta.session_type}</span>` : ''}
            ${meta.scheduled_at ? `<span class="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400"><span class="material-symbols-outlined text-[13px]">schedule</span>${new Date(meta.scheduled_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>` : ''}
           </div>` : '';

    return `
    <div id="notif-item-${n.id}" onclick="window.__notifHandleClick('${n.id}')"
        class="flex items-start gap-3 px-5 py-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors ${!n.is_read ? 'border-l-2 border-primary bg-primary/5' : 'border-l-2 border-transparent'}">
        ${avatarSection}
        <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2">
                <p class="text-sm font-semibold text-slate-800 dark:text-white leading-snug">${n.title}</p>
                <span class="text-[10px] text-slate-400 shrink-0 mt-0.5">${timeAgo(n.created_at)}</span>
            </div>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed line-clamp-2">${n.message}</p>
            ${mentorMeta}
        </div>
        ${!n.is_read ? '<span class="w-2 h-2 bg-primary rounded-full shrink-0 mt-2"></span>' : ''}
    </div>`;
}

function renderNotifications() {
    const list = document.getElementById('notif-list');
    const empty = document.getElementById('notif-empty');
    if (!list) return;
    
    // Clear list but keep empty state element
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

// ---- Public functions ----

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
            item.classList.remove('border-primary', 'bg-primary/5');
            item.classList.add('border-transparent');
            item.querySelector('.bg-primary.rounded-full')?.remove();
        }
        updateBadge();
    }

    // Redirection Logic: Redirect to student dashboard with hash to switch tab
    const type = notif.notification_type;
    const bookingRelated = ['booking_created', 'booking_confirmed', 'booking_cancelled', 'booking_negotiating', 'link_provided', 'pending_rejection_review', 'status_update', 'message'].includes(type);
    
    if (bookingRelated) {
        // We use a hash to tell the dashboard to switch to my-mentors tab
        window.location.href = `/src/pages/student/student-dashboard/#my-mentors`;
        
        // If we're already on the dashboard, the hash change won't trigger a reload, 
        // so we call the switch function directly if it exists.
        if (typeof window.switchDashboardTab === 'function') {
            window.switchDashboardTab('my-mentors');
        }
    }
};

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

        // Real-time subscription
        realtimeChannel = NotificationService.subscribeToNotifications(currentUserId, (newNotif) => {
            // Avoid duplicates
            if (allNotifications.some(n => n.id === newNotif.id)) return;
            
            allNotifications.unshift(newNotif);
            renderNotifications();
            updateBadge();
            
            // Visual feedback on the bell
            const btn = document.getElementById('notif-bell-btn');
            if (btn) {
                btn.classList.add('text-primary');
                setTimeout(() => btn.classList.remove('text-primary'), 2000);
            }
        });
    } catch (e) {
        console.error('[StudentNotifications] Init error:', e);
    }
}

// Close panel when clicking outside
document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('notif-wrapper');
    const panel = document.getElementById('notif-panel');
    if (wrapper && panel && !wrapper.contains(e.target)) {
        panel.classList.add('hidden');
    }
});

// Run on ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
