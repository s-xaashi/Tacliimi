/**
 * instructorNotifications.js
 * ===========================================================
 * Thin role-specific wrapper for the instructor notification panel.
 * All rendering, XSS-safe DOM construction, real-time subscriptions,
 * and badge logic live in notificationUI.js.
 * ===========================================================
 */
import { initNotifications } from './notificationUI.js';

/** Instructor-specific notification type icon/colour map */
const TYPE_CONFIGS = {
    course_approved:     { icon: 'check_circle',   color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
    course_rejected:     { icon: 'cancel',          color: 'text-red-500',     bg: 'bg-red-50 dark:bg-red-900/20' },
    course_under_review: { icon: 'pending',         color: 'text-amber-500',   bg: 'bg-amber-50 dark:bg-amber-900/20' },
    profile_approved:    { icon: 'verified_user',   color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
    profile_suspended:   { icon: 'gpp_bad',         color: 'text-red-500',     bg: 'bg-red-50 dark:bg-red-900/20' },
    booking_created:     { icon: 'event',           color: 'text-indigo-500',  bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
    booking_confirmed:   { icon: 'event_available', color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
    booking_cancelled:   { icon: 'event_busy',      color: 'text-red-500',     bg: 'bg-red-50 dark:bg-red-900/20' },
    status_update:       { icon: 'update',          color: 'text-blue-500',    bg: 'bg-blue-50 dark:bg-blue-900/20' },
    message:             { icon: 'forum',           color: 'text-blue-500',    bg: 'bg-blue-50 dark:bg-blue-900/20' },
    broadcast:           { icon: 'campaign',        color: 'text-purple-500',  bg: 'bg-purple-50 dark:bg-purple-900/20' },
};

/** Instructor-specific deep-link on notification click */
function onNotifClick(notif) {
    const bookingTypes = ['booking_created', 'booking_confirmed', 'booking_cancelled', 'status_update', 'message'];
    if (bookingTypes.includes(notif.notification_type)) {
        window.location.href = '/src/pages/instructor/instructor-mentorship/#requests';
    }
}

initNotifications({ typeConfigs: TYPE_CONFIGS, onNotifClick });
