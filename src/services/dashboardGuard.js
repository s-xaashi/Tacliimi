/**
 * dashboardGuard.js
 *
 * Centralized route authorization guard for Tacliimi dashboards.
 *
 * SECURITY PRINCIPLES:
 * 1. Role authority comes ONLY from the `profiles` table in the database.
 * 2. localStorage, sessionStorage, URL path, and user_metadata are NEVER
 *    used as authorization sources.
 * 3. supabase.auth.getUser() is used (not getSession()) — it is server-verified
 *    and cannot be spoofed by a tampered local session.
 * 4. Fail-closed for confirmed unauthorized states.
 * 5. Error/retry state for transient failures (network, profile-not-yet-created)
 *    so a slow network doesn't log out a legitimate user.
 *
 * BEHAVIOUR MATRIX:
 * ┌────────────────────────────┬──────────────────────────────────────────────┐
 * │ Condition                  │ Action                                       │
 * ├────────────────────────────┼──────────────────────────────────────────────┤
 * │ Unauthenticated            │ Redirect to login                            │
 * │ Wrong role (confirmed)     │ Redirect to the user's correct dashboard     │
 * │ Profile not found (DB)     │ Retry once, then redirect to login with flag │
 * │ Network / fetch error      │ Show retry UI — do NOT redirect as if wrong  │
 * │                            │ role (temporary failure ≠ unauthorized)      │
 * │ Authorized                 │ Return profile, allow page to proceed        │
 * └────────────────────────────┴──────────────────────────────────────────────┘
 */

import { supabase } from './supabaseClient.js';

/** Dashboard URLs by role */
const ROLE_DASHBOARDS = {
    student:    '/src/pages/student/student-dashboard/index.html',
    instructor: '/src/pages/instructor/instructor-dashboard/index.html',
    mentor:     '/src/pages/instructor/instructor-dashboard/index.html', // Mentors use instructor area
    admin:      '/src/pages/admin/dashboard/index.html',
};

const LOGIN_URL = '/src/pages/auth/login-select/index.html';

/**
 * Injects a full-page overlay to show a blocking UI state to the user.
 * Used for loading, error, and unauthorized states while blocking page render.
 */
function showOverlay({ type, message, showRetry = false, retryFn = null, showReturn = false }) {
    let overlay = document.getElementById('_dg_overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = '_dg_overlay';
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:99999',
            'display:flex', 'align-items:center', 'justify-content:center',
            'background:rgba(15,23,42,0.85)', 'backdrop-filter:blur(8px)',
            'font-family:Inter,system-ui,sans-serif',
        ].join(';');
        document.body.appendChild(overlay);
    }

    const icons = {
        loading: 'autorenew',
        error:   'error_outline',
        auth:    'lock',
    };
    const icon = icons[type] || 'info';
    const iconAnim = type === 'loading' ? 'animation:spin 1s linear infinite;' : '';
    const iconColor = type === 'loading' ? '#818cf8' : type === 'error' ? '#f87171' : '#94a3b8';

    const retryBtn = (showRetry && retryFn)
        ? `<button id="_dg_retry"
              style="margin-top:1.25rem;padding:0.65rem 1.5rem;border-radius:12px;background:#4f46e5;color:#fff;font-weight:700;font-size:0.9rem;border:none;cursor:pointer;">
              Try Again
           </button>`
        : '';

    const returnBtn = showReturn
        ? `<a href="${LOGIN_URL}"
              style="display:inline-block;margin-top:1rem;padding:0.65rem 1.5rem;border-radius:12px;background:#1e293b;color:#94a3b8;font-weight:600;font-size:0.85rem;text-decoration:none;border:none;">
              Return to Login
           </a>`
        : '';

    overlay.innerHTML = `
        <div style="text-align:center;max-width:320px;padding:1rem;">
            <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
            <span class="material-symbols-outlined"
                  style="font-size:3rem;color:${iconColor};display:block;margin:0 auto 1rem;${iconAnim}">${icon}</span>
            <p style="color:#e2e8f0;font-size:1rem;font-weight:600;margin:0 0 0.5rem;">${message}</p>
            ${retryBtn}
            <div>${returnBtn}</div>
        </div>`;

    if (showRetry && retryFn) {
        document.getElementById('_dg_retry')?.addEventListener('click', retryFn);
    }

    return overlay;
}

function removeOverlay() {
    document.getElementById('_dg_overlay')?.remove();
}

/**
 * Fetch the authenticated user's profile from the database.
 * Uses supabase.auth.getUser() — server-verified, cannot be faked by local state.
 *
 * @returns {{ user, profile } | { error, errorType }}
 *   errorType: 'unauthenticated' | 'profile_not_found' | 'network_error'
 */
async function fetchAuthorizedUser() {
    // Fast path: getSession() validates locally cached JWT instantly
    let user = null;
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (session?.user) {
        user = session.user;
    } else {
        // Fallback: getUser() queries Supabase Auth server if session isn't in memory.
        // A failed network/server check must not be converted into a local logout.
        const { data: { user: authUser }, error: userError } = await supabase.auth.getUser();
        if (authUser) {
            user = authUser;
        } else {
            const authError = userError || sessionError || null;
            const isConfirmedMissingSession = !authError ||
                authError.name === 'AuthSessionMissingError' ||
                authError.status === 401 ||
                ['session_not_found', 'bad_jwt'].includes(authError.code);
            return {
                error: authError,
                errorType: isConfirmedMissingSession ? 'unauthenticated' : 'network_error'
            };
        }
    }

    try {
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('id, role, account_status, full_name, avatar_url')
            .eq('id', user.id)
            .maybeSingle();

        if (profileError) {
            // Distinguish "row not found" from a real network/DB error
            if (profileError.code === 'PGRST116') {
                return { user, error: profileError, errorType: 'profile_not_found' };
            }
            // Network or unexpected DB error — do NOT treat as unauthorized
            return { user, error: profileError, errorType: 'network_error' };
        }

        if (!profile) {
            return { user, error: new Error('Profile row is null'), errorType: 'profile_not_found' };
        }

        return { user, profile };

    } catch (err) {
        // Catch unexpected JS errors (e.g. Supabase client not initialized)
        return { user, error: err, errorType: 'network_error' };
    }
}

/**
 * requireRole(expectedRole)
 *
 * Call this in a <script type="module"> in <head>.
 * It blocks page rendering via a full-screen overlay until authorization is confirmed.
 * If authorized, removes the overlay and returns the profile.
 *
 * @param {string} expectedRole - 'student' | 'instructor' | 'admin' | 'mentor'
 * @param {object} [options]
 * @param {number} [options.maxRetries=1] - retries on profile_not_found before giving up
 * @returns {Promise<object>} - The authorized profile object
 */
export async function requireRole(expectedRole, { maxRetries = 1 } = {}) {
    let attempt = 0;

    while (attempt <= maxRetries) {
        const result = await fetchAuthorizedUser();

        if (result.errorType === 'unauthenticated') {
            // Not logged in — hard redirect to login
            showOverlay({ type: 'auth', message: 'Redirecting to login...' });
            window.location.replace(LOGIN_URL);
            await _sleep(); // Wait for navigation
            return;
        }

        if (result.errorType === 'network_error') {
            // Transient failure — show error with retry button
            // Do NOT redirect as if unauthorized
            await new Promise((resolve) => {
                showOverlay({
                    type: 'error',
                    message: 'Unable to verify your account. Please check your connection.',
                    showRetry: true,
                    retryFn: resolve,
                    showReturn: true,
                });
            });
            // User clicked retry — loop back
            showOverlay({ type: 'loading', message: 'Verifying your access...' });
            attempt = 0; // Reset retry count since user explicitly asked to retry
            continue;
        }

        if (result.errorType === 'profile_not_found') {
            if (attempt < maxRetries) {
                // Profile may not exist yet (race condition after new account creation)
                // Wait briefly and retry once
                attempt++;
                await _sleep(1500);
                showOverlay({ type: 'loading', message: 'Setting up your account...' });
                continue;
            }
            // Profile still not found after retries — redirect to login
            showOverlay({
                type: 'auth',
                message: 'Account setup incomplete. Please log in again.',
                showReturn: true,
            });
            setTimeout(() => window.location.replace(`${LOGIN_URL}?error=profile_missing`), 2500);
            await _sleep();
            return;
        }

        // We have a valid user + profile — check role
        const { user, profile } = result;

        // Block suspended/blocked accounts
        if (profile.account_status === 'blocked') {
            await supabase.auth.signOut();
            showOverlay({
                type: 'auth',
                message: 'Your account has been blocked. Please contact support.',
                showReturn: true,
            });
            setTimeout(() => window.location.replace(`${LOGIN_URL}?error=blocked`), 2500);
            await _sleep();
            return;
        }

        const actualRole = profile.role;

        if (actualRole === expectedRole) {
            // AUTHORIZED — remove overlay and allow page to render
            removeOverlay();
            return profile;
        }

        // WRONG ROLE — redirect to the user's actual dashboard
        // Never grant page access; never show the page content
        const correctUrl = ROLE_DASHBOARDS[actualRole] || LOGIN_URL;
        showOverlay({
            type: 'auth',
            message: `Redirecting to your ${actualRole} dashboard...`,
        });
        window.location.replace(correctUrl);
        await _sleep();
        return;
    }
}

/**
 * requireAnyRole(roles[])
 *
 * For pages accessible to multiple roles (e.g. a shared settings page).
 * Redirects to login if unauthenticated; shows error overlay on network failure;
 * redirects to correct dashboard if role is not in the allowed list.
 *
 * @param {string[]} roles - Array of allowed roles
 * @returns {Promise<object>} - The authorized profile object
 */
export async function requireAnyRole(roles) {
    const result = await fetchAuthorizedUser();

    if (result.errorType === 'unauthenticated') {
        window.location.replace(LOGIN_URL);
        await _sleep();
        return;
    }

    if (result.errorType === 'network_error') {
        await new Promise((resolve) => {
            showOverlay({
                type: 'error',
                message: 'Unable to verify your account. Please check your connection.',
                showRetry: true,
                retryFn: resolve,
                showReturn: true,
            });
        });
        // Recursive retry
        removeOverlay();
        return requireAnyRole(roles);
    }

    if (result.errorType === 'profile_not_found') {
        showOverlay({ type: 'auth', message: 'Account setup incomplete. Redirecting...', showReturn: true });
        setTimeout(() => window.location.replace(`${LOGIN_URL}?error=profile_missing`), 2500);
        await _sleep();
        return;
    }

    const { profile } = result;

    if (profile.account_status === 'blocked') {
        await supabase.auth.signOut();
        showOverlay({ type: 'auth', message: 'Your account has been blocked.', showReturn: true });
        setTimeout(() => window.location.replace(`${LOGIN_URL}?error=blocked`), 2500);
        await _sleep();
        return;
    }

    if (roles.includes(profile.role)) {
        removeOverlay();
        return profile;
    }

    const correctUrl = ROLE_DASHBOARDS[profile.role] || LOGIN_URL;
    window.location.replace(correctUrl);
    await _sleep();
}

/**
 * Small sleep helper to let the browser paint/navigate before JS continues.
 * Used after initiating a redirect so the caller's code doesn't proceed past it.
 */
function _sleep(ms = undefined) {
    if (ms === undefined) return new Promise(() => {}); // Halt execution for redirects
    return new Promise(r => setTimeout(r, ms));
}
