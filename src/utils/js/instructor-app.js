/**
 * instructor-app.js
 * SPA Router for the Instructor Dashboard shell.
 * Uses ROUTES constants — no hardcoded paths.
 * Includes a retry/reload error boundary on network failure.
 */

import { INSTRUCTOR } from './routes.js';

document.addEventListener('DOMContentLoaded', () => {
    const contentArea = document.getElementById('instructor-content-area');
    const pageTitle   = document.getElementById('header-page-title');
    const navLinks    = document.querySelectorAll('#instructor-sidebar-nav .nav-link');

    // ── Active Nav ─────────────────────────────────────────────
    function updateActiveNav(urlPath) {
        // Clean URLs (e.g. /instructor-courses/) and legacy file paths
        // (e.g. /src/pages/instructor/instructor-courses/) refer to the same page.
        // Compare the instructor route segment rather than the full pathname.
        const getInstructorRoute = (path) => {
            const normalized = path.replace(/\/index\.html$/, '').replace(/\/+$/, '') || '/';
            const parts = normalized.split('/').filter(Boolean);

            // Canonical clean URLs use /instructor/courses/, while the
            // existing sidebar anchors still use /src/pages/instructor/instructor-courses/.
            // Normalize both formats to the same route key.
            const cleanRouteNames = new Set([
                'dashboard', 'courses', 'mentorship',
                'analytics', 'earnings', 'communications'
            ]);
            const instructorIndex = parts.lastIndexOf('instructor');
            if (instructorIndex !== -1 && cleanRouteNames.has(parts[instructorIndex + 1])) {
                return 'instructor-' + parts[instructorIndex + 1];
            }

            for (let i = parts.length - 1; i >= 0; i--) {
                if (parts[i].startsWith('instructor-')) return parts[i];
            }
            return '';
        };
        const currentRoute = getInstructorRoute(urlPath);

        navLinks.forEach(link => {
            const linkPath = new URL(link.href, window.location.origin).pathname;
            const linkRoute = getInstructorRoute(linkPath);
            const isActive = Boolean(currentRoute && linkRoute && currentRoute === linkRoute);
            link.classList.toggle('bg-indigo-50',          isActive);
            link.classList.toggle('dark:bg-indigo-900/20', isActive);
            link.classList.toggle('text-primary',          isActive);
            link.classList.toggle('font-medium',           isActive);
            link.classList.toggle('text-slate-600',        !isActive);
            link.classList.toggle('dark:text-slate-400',   !isActive);
            link.classList.toggle('hover:bg-slate-50',     !isActive);
            link.classList.toggle('dark:hover:bg-slate-800', !isActive);

            // Explicit styles ensure the selected item remains clearly visible
            // even if dark-mode utility CSS or cached styles differ on mobile.
            link.style.backgroundColor = isActive ? 'rgba(99, 102, 241, 0.20)' : '';
            link.style.borderLeft = isActive ? '3px solid #818cf8' : '';
            link.style.color = isActive ? '#a5b4fc' : '';
            link.style.paddingLeft = isActive ? '13px' : '';
            if (isActive) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
    }

    // ── Title Formatter ────────────────────────────────────────
    function formatTitle(pathname) {
        if (pathname === INSTRUCTOR.DASHBOARD) return 'Dashboard';
        const parts    = pathname.replace(/\/$/, '').split('/');
        const lastPart = parts[parts.length - 1];
        if (!lastPart || !lastPart.startsWith('instructor-')) return 'Dashboard';
        const name = lastPart.replace('instructor-', '');
        return name.charAt(0).toUpperCase() + name.slice(1);
    }

    // ── Error Boundary ─────────────────────────────────────────
    // Uses createElement so no innerHTML XSS surface is created.
    function showErrorBoundary(url) {
        contentArea.innerHTML = '';

        const wrapper = document.createElement('div');
        wrapper.className = 'flex flex-col items-center justify-center p-12 text-center h-[50vh]';

        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined text-4xl text-slate-300 mb-4';
        icon.textContent = 'cloud_off';

        const heading = document.createElement('h2');
        heading.className = 'text-xl font-bold dark:text-white mb-2';
        heading.textContent = 'Failed to load content';

        const sub = document.createElement('p');
        sub.className = 'text-slate-500 mb-6';
        sub.textContent = 'A network error occurred. Check your connection and try again.';

        const btnRow = document.createElement('div');
        btnRow.className = 'flex gap-3';

        const retryBtn = document.createElement('button');
        retryBtn.className = 'px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors';
        retryBtn.textContent = 'Retry';
        retryBtn.addEventListener('click', () => loadPage(url));

        const reloadBtn = document.createElement('button');
        reloadBtn.className = 'px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors';
        reloadBtn.textContent = 'Full Reload';
        reloadBtn.addEventListener('click', () => window.location.reload());

        btnRow.appendChild(retryBtn);
        btnRow.appendChild(reloadBtn);
        wrapper.appendChild(icon);
        wrapper.appendChild(heading);
        wrapper.appendChild(sub);
        wrapper.appendChild(btnRow);
        contentArea.appendChild(wrapper);
    }

    // ── Page Loader ────────────────────────────────────────────
    async function loadPage(url, push = true) {
        contentArea.classList.add('loading');
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const htmlText = await response.text();

            const doc        = new DOMParser().parseFromString(htmlText, 'text/html');
            const newContent = doc.getElementById('instructor-content-area');

            if (newContent) {
                contentArea.innerHTML = newContent.innerHTML;
                const path = new URL(url, window.location.origin).pathname;
                if (pageTitle) pageTitle.textContent = formatTitle(path);
                document.title = doc.title || 'Tacliimi Learn';
                updateActiveNav(path);
                if (push) window.history.pushState({ path }, '', path);
                document.dispatchEvent(new CustomEvent('instructor-page-loaded', { detail: { path } }));
            }
        } catch (error) {
            console.error('[Router] Page load failed:', error);
            showErrorBoundary(url);
        } finally {
            contentArea.classList.remove('loading');
        }
    }

    // ── Click Interception ─────────────────────────────────────
    document.body.addEventListener('click', e => {
        const link = e.target.closest('a');
        if (!link?.href) return;
        const url = new URL(link.href);
        if (
            url.origin === window.location.origin &&
            url.pathname.startsWith('/instructor-') &&
            !url.pathname.includes('login') &&
            !url.pathname.includes('become')
        ) {
            e.preventDefault();
            if (url.pathname !== window.location.pathname) loadPage(url.href);
        }
    });

    // ── Browser Back/Forward ───────────────────────────────────
    window.addEventListener('popstate', e => {
        loadPage(e.state?.path || window.location.pathname, false);
    });

    // ── Init ───────────────────────────────────────────────────
    updateActiveNav(window.location.pathname);
    if (pageTitle) pageTitle.textContent = formatTitle(window.location.pathname);
    window.history.replaceState({ path: window.location.pathname }, '', window.location.pathname);
});
