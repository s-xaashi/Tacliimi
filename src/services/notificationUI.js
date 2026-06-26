/**
 * notificationUI.js
 * ==============================================================
 * Shared notification panel logic for ALL roles (instructor, student).
 * Addresses M2 (XSS): All user-generated strings (names, messages)
 * are assigned via element.textContent — NEVER through innerHTML
 * interpolation. The structural HTML skeleton is built safely via
 * createElement, with untrusted data sandboxed inside text nodes.
 *
 * Usage:
 *   import { initNotifications } from './notificationUI.js';
 *
 *   initNotifications({
 *     role: 'instructor' | 'student',
 *     typeConfigs: { ... },        // role-specific icon/colour map
 *     onNotifClick: (notif) => {}, // role-specific redirect logic
 *   });
 * ==============================================================
 */

import { AuthService } from './authService.js';
import { NotificationService } from './notificationService.js';

// ── Shared Helpers ──────────────────────────────────────────────────────────

/** Safe relative-time label from an ISO date string */
export function timeAgo(isoDate) {
    const diff = Math.floor((Date.now() - new Date(isoDate)) / 1000);
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
}

/**
 * Safe locale-formatted date string (no HTML, used in textContent).
 * Returns empty string for null/undefined.
 */
function formatScheduled(isoDate) {
    if (!isoDate) return '';
    return new Date(isoDate).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
}

// ── XSS-safe DOM builder ────────────────────────────────────────────────────

/**
 * Builds a notification list item using createElement (never innerHTML).
 * All untrusted values (title, message, names) are set via .textContent.
 *
 * @param {Object} n           - notification record from Supabase
 * @param {Object} typeConfigs - role-specific icon/colour map
 * @returns {HTMLElement}
 */
export function buildNotifItem(n, typeConfigs) {
    const cfg = typeConfigs[n.notification_type] || {
        icon: 'notifications', color: 'text-slate-400', bg: 'bg-slate-50 dark:bg-slate-800'
    };
    const meta = n.metadata || {};
    const isRead = !!n.is_read;

    // -- Root container --
    const root = document.createElement('div');
    root.id = `notif-item-${n.id}`;
    root.className = [
        'flex items-start gap-3 px-5 py-4 cursor-pointer',
        'hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors',
        isRead
            ? 'border-l-2 border-transparent'
            : 'border-l-2 border-indigo-500 bg-indigo-50/30 dark:bg-indigo-900/10'
    ].join(' ');
    root.dataset.notifId = n.id;

    // -- Avatar section (structured; avatar src comes from Supabase Storage, not user text) --
    const avatarUrl = meta.mentor_avatar || meta.student_avatar;
    const avatarAlt = meta.mentor_name  || meta.student_name || 'User';
    const avatar = document.createElement('div');
    avatar.className = `w-9 h-9 rounded-full shrink-0 flex items-center justify-center ${cfg.bg}`;

    if (avatarUrl) {
        const img = document.createElement('img');
        img.src = avatarUrl; // storage URL — not user-provided text
        img.className = 'w-9 h-9 rounded-full object-cover border-2 border-white dark:border-slate-700 shadow-sm';
        img.alt = avatarAlt; // text node equivalent for alt
        // Fallback: if img fails to load, show icon
        img.onerror = () => { img.replaceWith(iconEl(cfg)); };
        avatar.appendChild(img);
    } else {
        avatar.appendChild(iconEl(cfg));
    }

    // -- Body wrapper --
    const body = document.createElement('div');
    body.className = 'flex-1 min-w-0';

    const headerRow = document.createElement('div');
    headerRow.className = 'flex items-start justify-between gap-2';

    const titleEl = document.createElement('p');
    titleEl.className = 'text-sm font-semibold text-slate-800 dark:text-white leading-snug';
    titleEl.textContent = n.title; // SAFE: textContent, not innerHTML

    const timeEl = document.createElement('span');
    timeEl.className = 'text-[10px] text-slate-400 shrink-0 mt-0.5';
    timeEl.textContent = timeAgo(n.created_at); // SAFE

    headerRow.appendChild(titleEl);
    headerRow.appendChild(timeEl);

    const msgEl = document.createElement('p');
    msgEl.className = 'text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed line-clamp-2';
    msgEl.textContent = n.message; // SAFE

    body.appendChild(headerRow);
    body.appendChild(msgEl);

    // -- Optional meta row (name, type, scheduled) --
    const personName = meta.mentor_name || meta.student_name;
    const sessionType = meta.session_type;
    const scheduledAt = formatScheduled(meta.scheduled_at);

    if (personName || sessionType || scheduledAt) {
        const metaRow = document.createElement('div');
        metaRow.className = 'flex items-center gap-2 mt-1.5 flex-wrap';

        if (personName)    metaRow.appendChild(metaChip('person',   personName));
        if (sessionType)   metaRow.appendChild(metaChip('groups',   sessionType));
        if (scheduledAt)   metaRow.appendChild(metaChip('schedule', scheduledAt));

        body.appendChild(metaRow);
    }

    // -- Unread dot --
    let unreadDot = null;
    if (!isRead) {
        unreadDot = document.createElement('span');
        unreadDot.className = 'w-2 h-2 bg-indigo-500 rounded-full shrink-0 mt-2';
    }

    root.appendChild(avatar);
    root.appendChild(body);
    if (unreadDot) root.appendChild(unreadDot);

    return root;
}

/** Creates a Material Symbol icon element */
function iconEl(cfg) {
    const span = document.createElement('span');
    span.className = `material-symbols-outlined text-lg ${cfg.color}`;
    span.textContent = cfg.icon;
    return span;
}

/** Creates a small metadata chip with an icon and safe text */
function metaChip(icon, text) {
    const chip = document.createElement('span');
    chip.className = 'inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'material-symbols-outlined text-[13px]';
    iconSpan.textContent = icon;

    const textNode = document.createTextNode(text); // SAFE: text node

    chip.appendChild(iconSpan);
    chip.appendChild(textNode);
    return chip;
}

// ── Render & Badge ──────────────────────────────────────────────────────────

export function renderNotifications(allNotifications, typeConfigs) {
    const list  = document.getElementById('notif-list');
    const empty = document.getElementById('notif-empty');
    if (!list) return;

    // Remove existing items
    list.querySelectorAll('[data-notif-id]').forEach(el => el.remove());

    if (allNotifications.length === 0) {
        empty?.classList.remove('hidden');
        return;
    }

    empty?.classList.add('hidden');
    allNotifications.forEach(n => list.appendChild(buildNotifItem(n, typeConfigs)));
}

export function updateBadge(allNotifications) {
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    const unread = allNotifications.filter(n => !n.is_read).length;
    unread > 0 ? badge.classList.remove('hidden') : badge.classList.add('hidden');
}

// ── Main Init (called by role-specific wrapper) ─────────────────────────────

/**
 * @param {Object} config
 * @param {Object} config.typeConfigs    — role-specific notification type map
 * @param {Function} config.onNotifClick — receives the notification object; handles redirect
 */
export function initNotifications({ typeConfigs, onNotifClick }) {
    let currentUserId = null;
    let allNotifications = [];
    let realtimeChannel = null;

    // -- Public window actions --
    window.toggleNotifPanel = function () {
        document.getElementById('notif-panel')?.classList.toggle('hidden');
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
            updateBadge(allNotifications);
        }

        onNotifClick(notif);
    };

    window.handleNotifClick = window.__notifHandleClick; // backward compat alias

    window.markAllRead = async function () {
        if (!currentUserId) return;
        allNotifications.forEach(n => { n.is_read = true; });
        await NotificationService.markAllAsRead(currentUserId);
        renderNotifications(allNotifications, typeConfigs);
        updateBadge(allNotifications);
    };

    // -- Close panel on outside click --
    document.addEventListener('click', (e) => {
        const wrapper = document.getElementById('notif-wrapper');
        const panel   = document.getElementById('notif-panel');
        if (wrapper && panel && !wrapper.contains(e.target)) {
            panel.classList.add('hidden');
        }
    });

    // -- Delegation: handle clicks on notification items --
    document.getElementById('notif-list')?.addEventListener('click', (e) => {
        const item = e.target.closest('[data-notif-id]');
        if (item) window.__notifHandleClick(item.dataset.notifId);
    });

    // -- Async init --
    async function init() {
        try {
            const session = await AuthService.getSession();
            if (!session) return;
            currentUserId = session.user.id;

            allNotifications = await NotificationService.getUserNotifications(currentUserId, 30);
            renderNotifications(allNotifications, typeConfigs);
            updateBadge(allNotifications);

            realtimeChannel = NotificationService.subscribeToNotifications(currentUserId, (newNotif) => {
                if (allNotifications.some(n => n.id === newNotif.id)) return; // deduplicate
                allNotifications.unshift(newNotif);
                renderNotifications(allNotifications, typeConfigs);
                updateBadge(allNotifications);

                const btn = document.getElementById('notif-bell-btn');
                if (btn) {
                    btn.classList.add('text-indigo-500');
                    setTimeout(() => btn.classList.remove('text-indigo-500'), 2000);
                }
            });
        } catch (e) {
            console.error('[NotificationUI] Init error:', e);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}
