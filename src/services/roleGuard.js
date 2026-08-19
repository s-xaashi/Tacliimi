/**
 * roleGuard.js
 * Utility to enforce student-only access for enrollment and booking actions.
 * Shows a friendly modal prompting instructors/mentors to switch accounts.
 */

import { supabase } from './supabaseClient.js';

const MODAL_ID = 'role-guard-modal';

function injectModalIfNeeded() {
    if (document.getElementById(MODAL_ID)) return;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:99999;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(6px);';
    modal.innerHTML = `
        <div style="background:#fff;border-radius:20px;padding:2rem;max-width:420px;width:90%;box-shadow:0 30px 80px rgba(0,0,0,0.3);text-align:center;position:relative;" class="dark:bg-slate-900">
            <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#ef4444);display:flex;align-items:center;justify-content:center;margin:0 auto 1.25rem auto;">
                <span class="material-symbols-outlined" style="color:#fff;font-size:2rem;">person_alert</span>
            </div>
            <h2 style="font-size:1.35rem;font-weight:800;color:#0f172a;margin-bottom:0.5rem;" class="dark:text-white">Student Account Required</h2>
            <p style="color:#64748b;font-size:0.9rem;margin-bottom:1.75rem;line-height:1.6;" class="dark:text-slate-400">
                You're currently logged in as an <strong>instructor or mentor</strong>. 
                Enrolling in courses and booking mentorship sessions is reserved for student accounts.
            </p>
            <a href="/src/pages/auth/login-select/index.html"
               style="display:block;width:100%;padding:0.85rem 1.5rem;border-radius:14px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;font-weight:700;font-size:0.95rem;text-decoration:none;margin-bottom:0.75rem;cursor:pointer;">
                🔄 Login with Student Account
            </a>
            <button onclick="document.getElementById('${MODAL_ID}').style.display='none';"
                    style="background:none;border:1px solid #e2e8f0;border-radius:14px;width:100%;padding:0.75rem;font-weight:600;color:#64748b;cursor:pointer;font-size:0.9rem;" class="dark:border-slate-700 dark:text-slate-400">
                Cancel
            </button>
        </div>
    `;
    document.body.appendChild(modal);
}

/**
 * Checks if the current user is an instructor or mentor.
 * Returns true if they should be blocked (i.e. are NOT a student).
 * SECURITY: Role is read from the `profiles` table (server-authoritative),
 * NOT from session.user.user_metadata.role which is client-writable.
 * @returns {Promise<boolean>}
 */
export async function isNonStudentRole() {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return false;

        const { data: profile, error } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .maybeSingle();

        if (error || !profile) return false;
        return profile.role === 'instructor' || profile.role === 'mentor';
    } catch {
        return false;
    }
}

/**
 * Shows the "Login to Student Account" modal and blocks further action.
 */
export function showStudentOnlyModal() {
    injectModalIfNeeded();
    const modal = document.getElementById(MODAL_ID);
    if (modal) {
        modal.style.display = 'flex';
    }
}
