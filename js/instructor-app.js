/**
 * SPA Router for Instructor Application
 * Intercepts navigation clicks to instructor routes, fetching and swapping
 * the main content area seamlessly without reloading the shell (sidebar/header).
 */

document.addEventListener('DOMContentLoaded', () => {
    const contentArea = document.getElementById('instructor-content-area');
    const pageTitle = document.getElementById('header-page-title');
    const navLinks = document.querySelectorAll('#instructor-sidebar-nav .nav-link');

    // Helper: Update Active Nav State
    function updateActiveNav(urlPath) {
        navLinks.forEach(link => {
            const linkPath = new URL(link.href).pathname;
            // Exact match or active section
            if (urlPath === linkPath || (linkPath !== '/' && urlPath.startsWith(linkPath))) {
                // Add active styles (Stitch uses bg-indigo-50 text-primary for active)
                link.classList.remove('text-slate-600', 'dark:text-slate-400', 'hover:bg-slate-50', 'dark:hover:bg-slate-800');
                link.classList.add('bg-indigo-50', 'dark:bg-indigo-900/20', 'text-primary', 'font-medium');
            } else {
                // Remove active styles, restore inactive styles
                link.classList.remove('bg-indigo-50', 'dark:bg-indigo-900/20', 'text-primary', 'font-medium');
                link.classList.add('text-slate-600', 'dark:text-slate-400', 'hover:bg-slate-50', 'dark:hover:bg-slate-800');
            }
        });
    }

    // Helper: Format pathname to Header Title
    function formatTitle(pathname) {
        // e.g. /instructor-mentorship/ -> Mentorship
        if (pathname === '/instructor-dashboard/' || pathname === '/instructor-dashboard') return 'Dashboard';
        const parts = pathname.replace(/\/$/, '').split('/');
        const lastPart = parts[parts.length - 1]; // e.g. instructor-mentorship
        if (!lastPart || !lastPart.startsWith('instructor-')) return 'Dashboard';
        const name = lastPart.replace('instructor-', '');
        return name.charAt(0).toUpperCase() + name.slice(1);
    }

    // Helper: Fetch and Swap Content
    async function loadPage(url, push = true) {
        contentArea.classList.add('loading');
        
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Network response was not ok');
            const htmlText = await response.text();
            
            // Parse the fetched HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlText, 'text/html');
            
            // Extract the new main content
            const newContent = doc.getElementById('instructor-content-area');
            
            if (newContent) {
                // Swap the inner HTML
                contentArea.innerHTML = newContent.innerHTML;
                
                // Update the Header Title
                const path = new URL(url, window.location.origin).pathname;
                if (pageTitle) pageTitle.textContent = formatTitle(path);
                
                // Update the Browser Title
                document.title = doc.title || 'Tacliimi Learn';
                
                // Update active nav state
                updateActiveNav(path);

                // Push state to history
                if (push) {
                    window.history.pushState({ path: path }, '', path);
                }
                
                // Trigger an event so page-specific scripts know they were loaded
                const event = new CustomEvent('instructor-page-loaded', { detail: { path: path } });
                document.dispatchEvent(event);
            }
        } catch (error) {
            console.error('Error loading page:', error);
            contentArea.innerHTML = `
                <div class="flex flex-col items-center justify-center p-12 text-center h-[50vh]">
                    <span class="material-symbols-outlined text-4xl text-slate-300 mb-4">error</span>
                    <h2 class="text-xl font-bold dark:text-white mb-2">Failed to load content</h2>
                    <p class="text-slate-500">Please check your connection or try refreshing the page.</p>
                </div>
            `;
        } finally {
            contentArea.classList.remove('loading');
        }
    }

    // Intercept navigation clicks
    document.body.addEventListener('click', e => {
        // Find the closest anchor tag
        const link = e.target.closest('a');
        
        // Only intercept actual application routing links (must start with /instructor- and not be hard escapes)
        if (link && link.href) {
            const url = new URL(link.href);
            // Ignore external links or non-instructor routes
            if (url.origin === window.location.origin && url.pathname.startsWith('/instructor-')) {
                // Allow login/availability to be their own standalone / hard refresh if we want, 
                // but if we want them inside SPA, leave them. 
                // Exception: login/register should be outside the core shell layout.
                if (url.pathname.includes('login') || url.pathname.includes('become')) return;
                
                e.preventDefault();
                // Prevent duplicate loading
                if (url.pathname !== window.location.pathname) {
                    loadPage(url.href);
                }
            }
        }
    });

    // Handle Back/Forward browser buttons
    window.addEventListener('popstate', e => {
        if (e.state && e.state.path) {
            loadPage(e.state.path, false);
        } else {
            loadPage(window.location.pathname, false);
        }
    });

    // Initialization run
    updateActiveNav(window.location.pathname);
    if (pageTitle) pageTitle.textContent = formatTitle(window.location.pathname);
    // Replace initial state so popstate works consistently
    window.history.replaceState({ path: window.location.pathname }, '', window.location.pathname);
});
