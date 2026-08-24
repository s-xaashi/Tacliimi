import { AuthService } from './authService.js';
import { supabase } from './supabaseClient.js';
import './uiUtils.js';

export const GlobalProfile = {
    async init() {
        this.injectGlobalCSS();
        this.initTheme();
        this.monitorNetwork();
        document.addEventListener('DOMContentLoaded', () => {
            this.applyProfile();
            this.bindThemeToggles();
        });

        // Sometimes scripts load after DOMContentLoaded
        if (document.readyState === 'interactive' || document.readyState === 'complete') {
            this.applyProfile();
            this.bindThemeToggles();
        }
    },

    injectGlobalCSS() {
        if (document.getElementById('tacliimi-global-css')) return;
        const style = document.createElement('style');
        style.id = 'tacliimi-global-css';
        style.textContent = `
            /* Fix native button styling inheritance causing white backgrounds in iOS/Safari */
            button, select, input[type="submit"], input[type="button"] {
                -webkit-appearance: none !important;
                appearance: none !important;
            }
            /* Explicit fallback for dark mode logos since PNG has artifacts */
            html.dark img[src*="IMG_7454.png"], html.dark img[src*="IMG_7448.png"] {
                background-color: white;
                padding: 4px;
                border-radius: 8px;
            }
        `;
        document.head.appendChild(style);
    },

    initTheme() {
        const isDark = localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
        if (isDark) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    },

    bindThemeToggles() {
        const html = document.documentElement;
        const themeToggleButtons = document.querySelectorAll('#theme-toggle, #themeToggle, #global-theme-toggle, button[onclick*="dark"]');

        themeToggleButtons.forEach(btn => {
            if (btn.hasAttribute('onclick') && (btn.getAttribute('onclick').includes('toggle') || btn.getAttribute('onclick').includes('dark'))) {
                btn.removeAttribute('onclick');
            }
            if (!btn.dataset.themeBound) {
                btn.dataset.themeBound = 'true';
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (html.classList.contains('dark')) {
                        html.classList.remove('dark');
                        localStorage.theme = 'light';
                    } else {
                        html.classList.add('dark');
                        localStorage.theme = 'dark';
                    }
                });
            }
        });
    },

    monitorNetwork() {
        const handleOffline = () => {
            if (document.getElementById('global-offline-overlay')) return;
            const overlay = document.createElement('div');
            overlay.id = 'global-offline-overlay';
            // Use extremely high z-index to cover sidebars, modals, and headers
            overlay.className = 'fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-slate-900/90 backdrop-blur-sm transition-opacity duration-300 pointer-events-auto';
            overlay.innerHTML = `
                <div class="bg-white dark:bg-slate-900 max-w-sm w-full rounded-2xl p-8 border border-slate-200 dark:border-slate-800 shadow-2xl text-center shadow-[0_0_50px_rgba(239,68,68,0.15)]">
                    <div class="w-20 h-20 bg-red-50 dark:bg-red-900/30 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
                        <span class="material-symbols-outlined text-[2.5rem]">wifi_off</span>
                    </div>
                    <h2 class="text-2xl font-bold text-slate-900 dark:text-white mb-3">No Internet Connection</h2>
                    <p class="text-slate-500 dark:text-slate-400 mb-6">
                        You have lost your connection to the internet. Please check your network to continue using Tacliimi.
                    </p>
                    <div class="flex items-center justify-center gap-2 text-sm text-slate-400 font-medium">
                        <span class="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse relative top-px"></span> Offline Mode
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            document.body.style.overflow = 'hidden';
        };

        const handleOnline = () => {
            const overlay = document.getElementById('global-offline-overlay');
            if (overlay) {
                overlay.style.opacity = '0';
                setTimeout(() => {
                    overlay.remove();
                    document.body.style.overflow = '';
                }, 300);
            }
        };

        window.addEventListener('offline', handleOffline);
        window.addEventListener('online', handleOnline);

        if (!navigator.onLine) {
            if (document.body) {
                handleOffline();
            } else {
                window.addEventListener('DOMContentLoaded', handleOffline, { once: true });
            }
        }
    },

    async applyProfile() {
        let session = null;
        let profile = null;

        try {
            session = await AuthService.getSession();
            if (session) {
                profile = await AuthService.getCurrentProfile();
            }
        } catch (e) {
            console.error("Error fetching session for global profile", e);
        }

        if (!session) return;

        // --- ACCOUNT STATUS CHECK ---
        const accountStatus = profile?.account_status || 'active';
        if (accountStatus === 'blocked' && !window.location.pathname.includes('/auth/')) {
            // Force logout and redirect if blocked
            await AuthService.logout();
            window.location.href = '/src/pages/auth/login-select/index.html?error=blocked';
            return;
        }

        // Marketplace Restriction Notice for Suspended Users
        if (accountStatus === 'suspended') {
            const path = window.location.pathname;
            const isMarketplacePage = path.includes('/marketplace/') || 
                                     path.includes('/course-details/') ||
                                     path.includes('/instructor/public-profile/') ||
                                     path.includes('/mentorship/mentor-marketplace/') ||
                                     path.includes('/mentorship/mentor-booking/') ||
                                     path.includes('/mentorship/mentor-profile/');
            if (isMarketplacePage) {
                this.showSuspensionNotice();
            }
        }

        // Process Names
        const nameElements = document.querySelectorAll('.text-right p.font-semibold, .user-display-name, h1.text-3xl.font-bold, .profile-name, .auto-welcome-name');

        const isAdmin = profile ? (profile.role === 'admin' || profile.is_admin === true) : false;
        const isInstructor = profile ? (profile.role === 'instructor') : false;
        let defaultName = isAdmin ? 'Admin' : (isInstructor ? 'Instructor' : 'Student');
        if (session.user.email && !isAdmin) {
            let prefix = session.user.email.split('@')[0];
            defaultName = prefix.charAt(0).toUpperCase() + prefix.slice(1);
        }

        const fullName = (profile && profile.full_name) ? profile.full_name : defaultName;

        nameElements.forEach(el => {
            if (el.tagName === 'H1' && el.textContent.includes('Welcome back')) {
                el.innerText = `Welcome back, ${fullName}! 👋`;
            } else if (!el.classList.contains('text-3xl') || el.classList.contains('auto-welcome-name')) {
                if (el.closest('.text-right') || el.classList.contains('user-display-name') || el.classList.contains('profile-name') || el.classList.contains('auto-welcome-name')) {
                    el.innerText = fullName;
                }
            }
        });

        // Process Roles/Meta
        const idElements = document.querySelectorAll('[data-role="profile-meta"]');
        idElements.forEach(el => {
            const txt = (el.innerText || '').toLowerCase();
            if (txt.includes('id:') || txt.includes('account') || txt.includes('student') || txt.includes('instructor') || txt.includes('admin')) {
                if (isAdmin) el.innerText = "Admin Account";
                else el.innerText = isInstructor ? "Instructor Account" : "Student Account";
            }
        });

        // Process Avatars
        const avatarUrl = profile && profile.avatar_url ? profile.avatar_url : null;
        if (avatarUrl) {
            // (Avatar update code will be handled later if needed)
        }

        // Removed legacy alert-based notifications to prioritize the new notification bell system

        const imgElements = document.querySelectorAll('[data-role="profile-image"] img, img.profile-picture-img');
        imgElements.forEach(img => {
            img.src = avatarUrl;
        });

        // Empty placeholders
        const emptyPlaceholders = document.querySelectorAll('[data-role="profile-image"], .profile-image-container');
        emptyPlaceholders.forEach(el => {
            if (!el.querySelector('img')) {
                el.innerHTML = `<img src="${avatarUrl}" class="w-full h-full object-cover rounded-full" />`;
                el.classList.add('overflow-hidden');
            }
        });
        this.injectHeaderControls(session, profile, fullName, avatarUrl, isInstructor, isAdmin);
    },

    injectHeaderControls(session, profile, fullName, avatarUrl, isInstructor, isAdmin) {
        if (document.querySelector('.tacliimi-injected-profile')) return;
        
        // Find potential placeholders to remove
        let authElements = Array.from(document.querySelectorAll('nav, header')).flatMap(parent => {
            return Array.from(parent.querySelectorAll('a, button, div')).filter(el => {
                const href = el.getAttribute('href') || el.getAttribute('onclick') || '';
                const html = el.innerHTML || '';
                if (el.id === 'mobile-menu' || el.closest('#mobile-menu') || el.children.length > 3) return false;
                const txt = (el.innerText || '').toLowerCase();
                const isLoginLink = (href.includes('/src/pages/auth/login') && !href.includes('instructor-login') && !href.includes('login-select')) || 
                                    href.includes('user-login') || 
                                    (el.tagName === 'BUTTON' && (txt.includes('log in') || txt.includes('sign up')));
                const isLogoutLink = (el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'DIV') && (txt.includes('logout') || txt.includes('log out') || html.includes('logout'));
                const isPlaceholderProfile = (html.includes('account_circle') || html.includes('Student Name') || html.includes('Instructor account') || html.includes('Admin Account') || html.includes('ID: ') || html.includes('JD') || html.includes('User Profile') || html.includes('Student Profile') || html.includes('Admin Profile') || el.classList.contains('user-display-name') || el.querySelector('.user-display-name') || txt.includes('student') || (fullName && txt === fullName.toLowerCase())) &&
                    (el.tagName === 'DIV' || el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'SPAN');
                return isLoginLink || isLogoutLink || isPlaceholderProfile;
            });
        });

        authElements = authElements.filter(el => {
            const isInsideHeader = el.closest('header') || el.closest('nav');
            if (!isInsideHeader) return false;

            const header = el.closest('header');
            if (header && header.querySelector('h1')) {
                const headerClasses = header.className || '';
                const isDashboardHeader = headerClasses.includes('h-16') || headerClasses.includes('sticky') || header.id?.includes('header');
                if (isDashboardHeader) return true;
                
                if (document.querySelector('nav')) return false;
            }

            return !authElements.some(other => other !== el && el.contains(other));
        });

        // Priority 0: Explicit container
        const explicitContainer = document.getElementById('global-profile-header-container');
        if (explicitContainer && !explicitContainer.closest('.tacliimi-injected-profile')) {
            // Only pass elements that are NOT the explicit container itself, NOT its ancestors,
            // and NOT its descendants — removing any of those would delete the freshly-injected content.
            const safeToPrune = authElements.filter(el =>
                el !== explicitContainer &&
                !explicitContainer.contains(el) &&
                !el.contains(explicitContainer)
            );
            this.renderToContainer(explicitContainer, session, profile, fullName, avatarUrl, isInstructor, isAdmin, safeToPrune);
            return;
        }

        const parentMap = new Map();
        if (authElements.length === 0) {
            let fallbackContainer = null;
            document.querySelectorAll('div').forEach(div => {
                if (div.innerHTML.includes('Global Profile Injected Below') && (div.closest('header') || div.closest('nav'))) {
                    fallbackContainer = div;
                }
            });
            if (!fallbackContainer) {
                const navOrHeader = document.querySelector('header') || document.querySelector('nav');
                if (navOrHeader) {
                    if (navOrHeader.tagName === 'HEADER' && navOrHeader.querySelector('h1')) {
                        const headerClasses = navOrHeader.className || '';
                        const isDashboardHeader = headerClasses.includes('h-16') || headerClasses.includes('sticky');
                        
                        if (!isDashboardHeader) {
                            const nav = document.querySelector('nav');
                            if (nav) {
                                const navDivs = Array.from(nav.children).filter(c => c.tagName === 'DIV');
                                fallbackContainer = navDivs.length > 0 ? navDivs[navDivs.length - 1] : nav;
                            }
                        }
                    }

                    if (!fallbackContainer) {
                        const rootDivs = Array.from(navOrHeader.children).filter(c => c.tagName === 'DIV');
                        if (rootDivs.length > 0) {
                            fallbackContainer = rootDivs[rootDivs.length - 1];
                        } else {
                            fallbackContainer = navOrHeader;
                        }
                    }
                }
            }
            if (fallbackContainer && !fallbackContainer.closest('.tacliimi-injected-profile')) {
                parentMap.set(fallbackContainer, []);
            }
        }

        authElements.forEach(el => {
            if (el.closest('.tacliimi-injected-profile')) return;
            if (!parentMap.has(el.parentElement)) parentMap.set(el.parentElement, []);
            parentMap.get(el.parentElement).push(el);
        });

        parentMap.forEach((elementsToRemove, container) => {
            this.renderToContainer(container, session, profile, fullName, avatarUrl, isInstructor, isAdmin, elementsToRemove);
        });

        this.applyGlobalUIUpdates(session, isInstructor, isAdmin);
    },

    renderToContainer(container, session, profile, fullName, avatarUrl, isInstructor, isAdmin, elementsToRemove = []) {
        if (container.querySelector('.tacliimi-injected-profile')) return;

        // Clear existing content if it's the explicit container or has placeholders
        if (container.id === 'global-profile-header-container' || container.innerHTML.includes('Global Profile Injected Below')) {
            container.innerHTML = '';
        }

        let dashboardLink = '/src/pages/student/student-dashboard/index.html';
        let roleName = 'Student';
        let settingsLink = '/src/pages/student/account-settings/index.html';

        if (isAdmin) {
            dashboardLink = '/src/pages/admin/dashboard/index.html';
            roleName = 'Admin';
            settingsLink = '/src/pages/admin/profile/index.html';
        } else if (isInstructor) {
            dashboardLink = '/src/pages/instructor/instructor-dashboard/index.html';
            roleName = 'Instructor';
            settingsLink = '/src/pages/instructor/instructor-profile/index.html';
        }

        const isPublicPage = !window.location.pathname.includes('dashboard') && !window.location.pathname.includes('settings') && !window.location.pathname.includes('profile') && !window.location.pathname.includes('admin');

        // Static-only HTML — NOTE: picHtml is built from avatarUrl here but
        // overwritten safely via setAttribute below after injection.
        const picHtml = `<span class="material-symbols-outlined text-2xl relative top-0.5 pointer-events-none">account_circle</span>`;

        // Determine if we should show a dropdown or a simple profile block
        // Admins want a simplified view (no dropdown, just info)
        // SECURITY: All text slots use empty placeholders — filled via textContent below
        const profileDisplayHtml = isAdmin ? `
            <div class="flex items-center gap-3" id="global-admin-profile-header">
                <div class="h-10 w-10 shrink-0 rounded-xl bg-slate-200 dark:bg-slate-700 flex items-center justify-center border-2 border-white dark:border-slate-800 shadow-sm overflow-hidden" data-role="profile-image">
                    ${picHtml}
                </div>
            </div>
        ` : `
            <div class="relative group flex items-center gap-3 cursor-pointer" id="global-profile-dropdown">
                <div class="h-10 w-10 shrink-0 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center border-2 border-primary/20 text-slate-400 overflow-hidden pointer-events-none" data-role="profile-image">
                    ${picHtml}
                </div>
            
                <div class="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-slate-800 rounded-xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-700 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100] overflow-hidden text-left cursor-default">
                    <div class="p-4 border-b border-slate-100 dark:border-slate-700">
                        <p class="text-sm font-semibold text-slate-900 dark:text-white" id="gp-dropdown-name"></p>
                        <p class="text-xs text-slate-500" id="gp-dropdown-email"></p>
                    </div>
                    <a href="${dashboardLink}" class="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-primary transition-colors border-b border-slate-100 dark:border-slate-700/50">
                        <span class="material-symbols-outlined text-lg">dashboard</span> Dashboard
                    </a>
                    <a href="${settingsLink}" class="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-primary transition-colors border-b border-slate-100 dark:border-slate-700/50">
                        <span class="material-symbols-outlined text-lg">settings</span> Settings
                    </a>
                    <button id="global-dropdown-logout" class="w-full text-left flex items-center gap-3 px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                        <span class="material-symbols-outlined text-lg pointer-events-none">logout</span> Logout
                    </button>
                </div>
            </div>
        `;

        document.querySelectorAll('nav button, header button').forEach(btn => {
            const text = (btn.innerText + btn.innerHTML).toLowerCase();
            const title = (btn.getAttribute('title') || '').toLowerCase();
            const id = btn.id || '';
            // Only remove theme-toggle duplicates — DO NOT remove notification buttons
            if (text.includes('dark_mode') || text.includes('light_mode') || title.includes('theme') || id.includes('theme')) {
                if (!btn.closest('.tacliimi-injected-profile')) {
                    btn.remove();
                }
            }
        });

        const themeToggleHtml = `
            <button type="button" id="global-theme-toggle" class="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full flex items-center justify-center transition-colors !outline-none" title="Toggle Theme">
                <span class="material-symbols-outlined dark:hidden text-[22px]">dark_mode</span>
                <span class="material-symbols-outlined hidden dark:block text-[22px]">light_mode</span>
            </button>
        `;

        const headerControlsHtml = `
            <div class="hidden md:flex items-center gap-1 tacliimi-injected-profile">
                ${themeToggleHtml}

                <div class="flex items-center justify-end pl-3 ml-2 border-l border-slate-200 dark:border-slate-700">
                    ${profileDisplayHtml}
                </div>
            </div>
        `;

        if (!container.querySelector('.tacliimi-injected-profile')) {
            container.insertAdjacentHTML('beforeend', headerControlsHtml);
        }

        // SECURITY: Apply all user-controlled text via textContent AFTER injection.
        // The HTML template above uses empty placeholders — user data never touches innerHTML.
        const nameEls = container.querySelectorAll('.user-display-name');
        nameEls.forEach(el => { el.textContent = fullName; });

        const adminRoleLabel = container.querySelector('#gp-admin-role-label');
        if (adminRoleLabel) {
            adminRoleLabel.textContent = (profile?.admin_role || 'administrator').replace('_', ' ');
        }

        const dropdownNameEl = container.querySelector('#gp-dropdown-name');
        if (dropdownNameEl) dropdownNameEl.textContent = fullName;

        const dropdownEmailEl = container.querySelector('#gp-dropdown-email');
        if (dropdownEmailEl) dropdownEmailEl.textContent = session.user.email || roleName;

        // SECURITY: Set avatar image via setAttribute — never injected into innerHTML
        if (avatarUrl) {
            container.querySelectorAll('[data-role="profile-image"]').forEach(wrapper => {
                let img = wrapper.querySelector('img');
                if (!img) {
                    // Replace the icon span with an img
                    wrapper.innerHTML = '';
                    img = document.createElement('img');
                    img.className = 'w-full h-full object-cover rounded-full pointer-events-none';
                    img.alt = '';
                    wrapper.appendChild(img);
                }
                img.setAttribute('src', avatarUrl);
            });
        }

        // Remove elements to replace
        elementsToRemove.forEach(el => {
            if (el && el.parentNode) {
                const sibling = el.previousElementSibling;
                // Try grabbing sibling text properly
                if (sibling) {
                    const siblingTxt = (sibling.innerText || sibling.textContent || '').toLowerCase();
                    const n = fullName ? fullName.toLowerCase() : '';
                    if (n && siblingTxt.includes(n) || siblingTxt.includes('student name') || siblingTxt.includes('instructor account') || siblingTxt.includes('id:') || siblingTxt.includes('logout')) {
                        sibling.remove();
                    }
                }
                el.remove();
            }
        });

        container.querySelectorAll('div').forEach(emptyDiv => {
            if (emptyDiv !== container && emptyDiv.innerHTML.trim() === '<!-- Global Profile Injected Below via TacliimiDB -->') {
                emptyDiv.remove();
            }
        });

        // Rebind logout and theme buttons in THIS container
        container.querySelectorAll('#global-logout, #global-dropdown-logout').forEach(btn => {
            btn.addEventListener('click', async () => {
                await AuthService.logout();
                window.location.href = '/src/pages/auth/login-select/index.html';
            });
        });

        this.bindThemeToggles();
    },

    applyGlobalUIUpdates(session, isInstructor, isAdmin) {
        let dashboardLink = '/src/pages/student/student-dashboard/index.html';
        if (isAdmin) dashboardLink = '/src/pages/admin/dashboard/index.html';
        else if (isInstructor) dashboardLink = '/src/pages/instructor/instructor-dashboard/index.html';

        const mobileMenu = document.getElementById('mobile-menu');

        // NEW STRUCTURED MENU: If the menu already has #mobile-menu-profile (our new design),
        // skip legacy injection and only populate profile info.
        if (mobileMenu && mobileMenu.querySelector('#mobile-menu-profile')) {
            // Populate name — grab from already-injected header profile name, fallback to email
            const nameEl = mobileMenu.querySelector('.user-display-name');
            if (nameEl) {
                const headerName = document.querySelector('.tacliimi-injected-profile .user-display-name');
                const displayName = headerName ? headerName.innerText :
                    (session.user.email ? (session.user.email.split('@')[0].charAt(0).toUpperCase() + session.user.email.split('@')[0].slice(1)) : 'User');
                nameEl.innerText = displayName;
            }

            // Wire profile area click to correct settings page
            const profileArea = mobileMenu.querySelector('#mobile-menu-profile');
            let settingsLink = '/src/pages/student/account-settings/index.html';
            if (isAdmin) settingsLink = '/src/pages/admin/profile/index.html';
            else if (isInstructor) settingsLink = '/src/pages/instructor/instructor-profile/index.html';
            if (profileArea) profileArea.setAttribute('onclick', `window.location.href='${settingsLink}'`);

            // Wire theme toggle in new menu
            const mobileThemeToggle = document.getElementById('mobile-theme-toggle');
            if (mobileThemeToggle && !mobileThemeToggle.dataset.themeBound) {
                mobileThemeToggle.dataset.themeBound = 'true';
                mobileThemeToggle.addEventListener('click', () => {
                    const html = document.documentElement;
                    if (html.classList.contains('dark')) {
                        html.classList.remove('dark');
                        localStorage.theme = 'light';
                    } else {
                        html.classList.add('dark');
                        localStorage.theme = 'dark';
                    }
                });
            }

            return; // Skip legacy injection
        }

        // LEGACY MENU: Update mobile menu with old button-based structure
        const legacyMenuAuth = document.querySelectorAll('#mobile-menu button:not(#mobile-theme-toggle):not(.tacliimi-mobile-injected)');
        if (legacyMenuAuth.length >= 2) {
            legacyMenuAuth[0].innerText = 'Dashboard';
            legacyMenuAuth[0].onclick = () => window.location.href = dashboardLink;
            legacyMenuAuth[1].innerText = 'Log Out';
            legacyMenuAuth[1].classList.add('!text-red-500');
            legacyMenuAuth[1].onclick = async () => {
                await AuthService.logout();
                window.location.href = '/src/pages/auth/login-select/index.html';
            };
        } else {
            if (mobileMenu && !mobileMenu.querySelector('.tacliimi-mobile-injected')) {
                let settingsLink = '/src/pages/student/account-settings/index.html';
                if (isAdmin) settingsLink = '/src/pages/admin/profile/index.html';
                else if (isInstructor) settingsLink = '/src/pages/instructor/instructor-profile/index.html';
                
                const settingsBtn = document.createElement('a');
                settingsBtn.className = 'tacliimi-mobile-injected block text-base font-medium text-slate-700 dark:text-slate-200 hover:text-primary transition-colors cursor-pointer';
                settingsBtn.href = settingsLink;
                settingsBtn.innerText = 'Settings';
                
                const logoutBtn = document.createElement('a');
                logoutBtn.className = 'tacliimi-mobile-injected block text-base font-medium !text-red-500 hover:text-red-600 transition-colors cursor-pointer';
                logoutBtn.innerText = 'Log Out';
                logoutBtn.onclick = async () => {
                    await AuthService.logout();
                    window.location.href = '/src/pages/auth/login-select/index.html';
                };
                
                mobileMenu.appendChild(settingsBtn);
                mobileMenu.appendChild(logoutBtn);
            }
        }

        // Handle Instructor CTA Links
        if (isInstructor) {
            // Hide for logged-in instructors
            document.querySelectorAll('a, button').forEach(el => {
                const attr = el.getAttribute('href') || el.getAttribute('onclick') || '';
                const txt = (el.innerText || '').toLowerCase();
                if (attr.includes('/src/pages/instructor/become-instructor/') || txt.includes('become a teacher') || txt.includes('teach on tacliimi')) {
                    el.style.display = 'none';
                }
            });
        } else {
            // Un-squeeze for others by shrinking padding/text
            document.querySelectorAll('a, button').forEach(el => {
                const attr = el.getAttribute('href') || el.getAttribute('onclick') || '';
                const txt = (el.innerText || '').toLowerCase();
                if ((attr.includes('/src/pages/instructor/become-instructor/') || txt.includes('become a teacher')) && (el.closest('nav') || el.closest('header'))) {
                    el.classList.remove('whitespace-nowrap', 'px-4', 'py-2');
                    el.classList.add('px-3', 'py-1.5', 'text-[13px]');
                    if (txt.includes('become a teacher')) {
                        el.innerHTML = el.innerHTML.replace(/Become a Teacher/gi, 'Teach');
                    }
                }
            });
        }
    },

    showSuspensionNotice() {
        if (document.getElementById('suspension-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'suspension-overlay';
        overlay.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-xl animate-in fade-in duration-500';
        overlay.innerHTML = `
            <div class="bg-white dark:bg-slate-900 max-w-md w-full rounded-[2.5rem] p-10 border border-slate-200 dark:border-slate-800 shadow-2xl text-center scale-in-center animate-in zoom-in duration-300">
                <div class="w-20 h-20 bg-amber-50 dark:bg-amber-900/20 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-inner">
                    <span class="material-symbols-outlined text-amber-500 text-5xl">pause_circle</span>
                </div>
                <h2 class="text-3xl font-black text-slate-900 dark:text-white mb-4 tracking-tight">Account Suspended</h2>
                <p class="text-slate-500 dark:text-slate-400 mb-10 leading-relaxed font-medium">
                    Your marketplace access has been temporarily restricted by the administration. You can still access your currently enrolled courses from your dashboard, but you cannot browse or join new courses at this time.
                </p>
                <div class="space-y-4 pt-4">
                    <a href="/src/pages/student/student-dashboard/index.html" class="block w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl transition-all shadow-lg shadow-indigo-200 dark:shadow-none hover:scale-[1.02] active:scale-[0.98]">
                        Return to Dashboard
                    </a>
                    <p class="text-xs text-slate-400 mt-6 pt-6 border-t border-slate-100 dark:border-slate-800 font-medium">
                        Please contact administration if you believe this is a mistake.
                    </p>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
    }
};

GlobalProfile.init();
