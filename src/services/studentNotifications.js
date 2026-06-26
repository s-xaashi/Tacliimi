/**
 * studentNotifications.js
 * ===========================================================
 * Thin role-specific wrapper for the student notification panel.
 * All rendering, XSS-safe DOM construction, real-time subscriptions,
 * and badge logic live in notificationUI.js.
 * ===========================================================
 */
import { initNotifications } from './notificationUI.js';

/** Student-specific notification type icon/colour map */
const TYPE_CONFIGS = {
    booking_created:          { icon: 'history_edu',   color: 'text-indigo-500',  bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
    booking_confirmed:        { icon: 'event_available',color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
    booking_negotiating:      { icon: 'handshake',     color: 'text-amber-500',   bg: 'bg-amber-50 dark:bg-amber-900/20' },
    link_provided:            { icon: 'link',          color: 'text-blue-500',    bg: 'bg-blue-50 dark:bg-blue-900/20' },
    booking_cancelled:        { icon: 'event_busy',    color: 'text-red-500',     bg: 'bg-red-50 dark:bg-red-900/20' },
    pending_rejection_review: { icon: 'gavel',         color: 'text-rose-500',    bg: 'bg-rose-50 dark:bg-rose-900/20' },
    status_update:            { icon: 'update',        color: 'text-blue-500',    bg: 'bg-blue-50 dark:bg-blue-900/20' },
    message:                  { icon: 'forum',         color: 'text-blue-500',    bg: 'bg-blue-50 dark:bg-blue-900/20' },
    broadcast:                { icon: 'campaign',      color: 'text-purple-500',  bg: 'bg-purple-50 dark:bg-purple-900/20' },
};

/** Student-specific deep-link on notification click */
function onNotifClick(notif) {
    const bookingTypes = [
        'booking_created', 'booking_confirmed', 'booking_cancelled',
        'booking_negotiating', 'link_provided', 'pending_rejection_review',
        'status_update', 'message'
    ];
    if (bookingTypes.includes(notif.notification_type)) {
        window.location.href = '/src/pages/student/student-dashboard/#my-mentors';
        if (typeof window.switchDashboardTab === 'function') {
            window.switchDashboardTab('my-mentors');
        }
    }
}

initNotifications({ typeConfigs: TYPE_CONFIGS, onNotifClick });
