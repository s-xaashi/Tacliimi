import { AuthService } from './authService.js';
import { supabase } from './supabaseClient.js';

export const GlobalProfile = {
    async init() {
        this.initTheme();
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

        // Process Names
        const nameElements = document.querySelectorAll('.text-right p.font-semibold, .user-display-name, h1.text-3xl.font-bold, .profile-name, .auto-welcome-name');

        const isInstructor = profile ? (profile.role === 'instructor') : false;
        let defaultName = isInstructor ? 'Instructor' : 'Student';
        if (session.user.email) {
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
            if (txt.includes('id:') || txt.includes('account') || txt.includes('student') || txt.includes('instructor')) {
                el.innerText = isInstructor ? "Instructor Account" : "Student Account";
            }
        });

        // Process Avatars
        const avatarUrl = profile && profile.avatar_url ? profile.avatar_url : null;
        if (avatarUrl) {
            // (Avatar update code will be handled later if needed)
        }

        // --- NOTIFICATIONS CHECK ---
        try {
            const { data: notifications } = await supabase
                .from('notifications')
                .select('*')
                .eq('user_id', session.user.id)
                .is('is_read', false); // using .is() because boolean might be false or null based on schema defaults

            if (notifications && notifications.length > 0) {
                const unread = notifications.filter(n => n.is_read !== true);
                if (unread.length > 0) {
                    // Show standard alert to user
                    setTimeout(() => {
                        unread.forEach(n => alert(`🔔 NOTIFICATION: ${n.title}\n\n${n.message}`));
                    }, 500);

                    // Mark as read so we don't spam multiple times
                    const idsToUpdate = unread.map(n => n.id);
                    await supabase.from('notifications').update({ is_read: true }).in('id', idsToUpdate);
                }
            }
        } catch (e) {
            console.warn("Failed to fetch notifications:", e);
        }

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
        this.injectHeaderControls(session, profile, fullName, avatarUrl, isInstructor);
    },

    injectHeaderControls(session, profile, fullName, avatarUrl, isInstructor) {
        let authElements = Array.from(document.querySelectorAll('nav, header')).flatMap(parent => {
            return Array.from(parent.querySelectorAll('a, button, div')).filter(el => {
                const href = el.getAttribute('href') || el.getAttribute('onclick') || '';
                const html = el.innerHTML || '';
                if (el.id === 'mobile-menu' || el.closest('#mobile-menu') || el.children.length > 3) return false;
                const isLoginLink = (href.includes('/src/pages/auth/login/') && !href.includes('instructor-login') && !href.includes('login-select')) || href.includes('user-login');
                const isPlaceholderProfile = (html.includes('account_circle') || html.includes('Student Name') || html.includes('Instructor account') || html.includes('ID: ') || html.includes('JD') || html.includes('User Profile') || html.includes('Student Profile')) &&
                    (el.tagName === 'DIV' && (el.classList.contains('rounded-full') || html.includes('Student Name') || html.includes('Instructor account')));
                return isLoginLink || isPlaceholderProfile;
            });
        });

        authElements = authElements.filter(el => {
            const isInsideHeader = el.closest('header') || el.closest('nav');
            return isInsideHeader && !authElements.some(other => other !== el && el.contains(other));
        });

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
                    const rootDivs = Array.from(navOrHeader.children).filter(c => c.tagName === 'DIV');
                    if (rootDivs.length > 0) {
                        fallbackContainer = rootDivs[rootDivs.length - 1];
                    } else {
                        fallbackContainer = navOrHeader;
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

        const dashboardLink = isInstructor ? '/src/pages/instructor/instructor-dashboard/index.html' : '/src/pages/student/student-dashboard/index.html';
        const roleName = isInstructor ? 'Instructor' : 'Student';
        const settingsLink = isInstructor ? '/src/pages/instructor/instructor-profile/index.html' : '/src/pages/student/account-settings/index.html';
        const isPublicPage = !window.location.pathname.includes('dashboard') && !window.location.pathname.includes('settings') && !window.location.pathname.includes('profile') && !window.location.pathname.includes('admin');

        const picHtml = avatarUrl
            ? `< img src = "${avatarUrl}" class= "w-full h-full object-cover rounded-full pointer-events-none" /> `
            : `< span class= "material-symbols-outlined text-2xl relative top-0.5 pointer-events-none" > account_circle</span > `;

        parentMap.forEach((elementsToRemove, container) => {
            document.querySelectorAll('nav button, header button').forEach(btn => {
                const text = (btn.innerText + btn.innerHTML).toLowerCase();
                const title = (btn.getAttribute('title') || '').toLowerCase();
                const id = btn.id || '';
                if (text.includes('notifications') || text.includes('dark_mode') || text.includes('light_mode') || title.includes('theme') || id.includes('theme')) {
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

            const logoutHtml = `
            <button id="global-logout" class="p-2 text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 dark:hover:text-red-400 rounded-full flex items-center justify-center transition-colors !outline-none" title="Log Out">
                <span class="material-symbols-outlined text-[20px] pointer-events-none">logout</span>
            </button>
        `;

            const avatarHtml = `
            <div class="relative group flex items-center gap-3 cursor-pointer" id="global-profile-dropdown">
                <div class="hidden sm:block text-right group-hover:opacity-80 transition-opacity">
                    <p class="user-display-name text-sm font-semibold text-slate-900 dark:text-white capitalize pointer-events-none">${fullName}</p>
                </div>
                <div class="h-10 w-10 shrink-0 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center border-2 border-primary/20 text-slate-400 overflow-hidden pointer-events-none" data-role="profile-image">
                    ${picHtml}
                </div>
            
                <div class="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-slate-800 rounded-xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-700 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100] overflow-hidden text-left cursor-default">
                    <div class="p-4 border-b border-slate-100 dark:border-slate-700">
                        <p class="text-sm font-semibold text-slate-900 dark:text-white">${fullName}</p>
                        <p class="text-xs text-slate-500">${session.user.email || roleName}</p>
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

            const headerControlsHtml = `
            <div class="flex items-center gap-1 tacliimi-injected-profile">
                <!-- Notifications Block -->
                <button class="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full hidden sm:flex items-center justify-center transition-colors !outline-none relative">
                    <span class="material-symbols-outlined text-[22px]">notifications</span>
                    <span class="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full"></span>
                </button>
                            
                ${themeToggleHtml}
                ${!isPublicPage ? logoutHtml : ''}

                <div class="flex items-center justify-end pl-3 ml-2 border-l border-slate-200 dark:border-slate-700">
                    ${avatarHtml}
                </div>
            </div>
        `;

            if (!container.querySelector('.tacliimi-injected-profile')) {
                container.insertAdjacentHTML('beforeend', headerControlsHtml);
            }
            elementsToRemove.forEach(el => {
                if (el && el.parentNode) {
                    const sibling = el.previousElementSibling;
                    if (sibling && (sibling.innerText.includes(fullName) || sibling.innerText.includes('Student Name') || sibling.innerText.includes('Instructor Account') || sibling.innerText.includes('ID:'))) {
                        sibling.remove();
                    }
                    el.remove();
                }
            });

            container.querySelectorAll('div').forEach(emptyDiv => {
                if (emptyDiv !== container && emptyDiv.innerHTML.trim() === '<!-- Global Profile Injected Below via TacliimiDB -->') {
                    emptyDiv.remove();
                }
            });
        });

        // Rebind logout buttons
        document.querySelectorAll('#global-logout, #global-dropdown-logout').forEach(btn => {
            btn.addEventListener('click', async () => {
                await AuthService.logout();
                window.location.href = '/src/pages/auth/login-select/index.html';
            });
        });

        this.bindThemeToggles();

        // Update mobile menu
        const mobileMenuAuth = document.querySelectorAll('#mobile-menu button');
        if (mobileMenuAuth.length >= 2) {
            mobileMenuAuth[0].innerText = 'Dashboard';
            mobileMenuAuth[0].onclick = () => window.location.href = dashboardLink;
            mobileMenuAuth[1].innerText = 'Log Out';
            mobileMenuAuth[1].classList.add('!text-red-500');
            mobileMenuAuth[1].onclick = async () => {
                await AuthService.logout();
                window.location.href = '/src/pages/auth/login-select/index.html';
            };
        }

        // Hide instructor CTA links for logged-in instructors
        if (isInstructor) {
            document.querySelectorAll('a, button').forEach(el => {
                const attr = el.getAttribute('href') || el.getAttribute('onclick') || '';
                const txt = (el.innerText || '').toLowerCase();
                if (attr.includes('/src/pages/instructor/become-instructor/') || txt.includes('become a teacher') || txt.includes('teach on tacliimi')) {
                    el.style.display = 'none';
                }
            });
        }
    }
};

GlobalProfile.init();
