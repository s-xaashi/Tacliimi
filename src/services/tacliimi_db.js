// Tacliimi Global DB Simulator using LocalStorage
// This file should be included in any page that interacts with courses.

const TACLIIMI_DB_KEY = 'tacliimi_courses';
const TACLIIMI_ENROLLED_KEY = 'tacliimi_enrolled';
const TACLIIMI_WISHLIST_KEY = 'tacliimi_wishlist';
const TACLIIMI_USERS_KEY = 'tacliimi_users';
const TACLIIMI_SESSION_KEY = 'tacliimi_session';
const TACLIIMI_RESETS_KEY = 'tacliimi_password_resets';

const defaultCourses = [
    {
        id: 'course-ux-design',
        title: 'Mastering Modern User Experience Design',
        category: 'Design',
        instructor: 'Daniel Walter Scott',
        instructorRole: 'Senior Product Designer',
        thumbnailUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAoxv0lnn9g0hqpV8k7IbB4nHlU5WRInPNUzsbsOw4MERt6qUu-wKJ8hZF1fP5O-AjmvXUsc5jRabFqVdbT7QHymxerTNfftiAKfaqUXneH0jyuu1m3pwea8k5jYqm7t9vGN4_SVlTGZT5NANZh8ZosozBi_L46evR9BzIZIkLuG_gk4P1TV31HsRiM_LvsfbXMJwk0UWfc25apMiGooKsz9O73_bVbnHGE97ZnziwtaSn9hnZzBxxQrky3czU-h_LG31PTYSYujV9S',
        price: 12.99,
        originalPrice: 84.99,
        rating: 4.8,
        reviews: 24532,
        duration: '24h',
        isBestseller: true,
        previewVideo: 'https://www.w3schools.com/html/mov_bbb.mp4' // placeholder preview
    },
    {
        id: 'course-python-ds',
        title: 'Python for Data Science and Machine Learning',
        category: 'Development',
        instructor: 'Jose Portilla',
        instructorRole: 'Head of Data Science at Pierian Data Inc.',
        thumbnailUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDWkES2Yh-DOOjliSjirOlQIpnoSvQ7awv_EbU-ccP1CSoQv9npKHJtLcg1h51El9JFrY5QDmGid5KE83YWILqWSXur2wHlvrSObqu4vkjbZnOUKM7s7epPwTQ-fDll47YcirdWF4WDZBBslD-Vrzc-Wpyd6lm6Ee2UwrEhIvdTX0FoGiXxZPSlDp_LpR4yv4ZRzSt_g4Z_c1ckEUVjVD6ZB0oMjpc8PnNu2x7dc0eWLRpa9kc_ZP5pPPQPmUMcskEHLSgFaN9rI_eV',
        price: 14.99,
        originalPrice: 94.99,
        rating: 4.7,
        reviews: 18912,
        duration: '22.5h',
        isBestseller: true,
        previewVideo: 'https://www.w3schools.com/html/mov_bbb.mp4'
    },
    {
        id: 'course-cyber-security',
        title: 'The Complete Cyber Security Course: Hackers Exposed!',
        category: 'IT & Software',
        instructor: 'Nathan House',
        instructorRole: 'CEO of Station X',
        thumbnailUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuC3pP1-o2Jo_01c-yjRQuvIWQhjBIzjt-CmeOALnYnFxfFCn-1VciBADGbvMKihikD_1Xqoth0VvGPYnXtm1OjWkAIHzrsXCVRynMjrb2gMLbthp80NbcBiMk2O3qMLEsDZYM6M5x5quF80QF68xQd-CuqVwFN6vIVNvu_8y0dgIdMKczfS5a8CCtuYHaxUnQ11DrLRXAZzMxWImw5Kkc1y3ikVAzrdcVY4HjU3l9aZbSzqeMm8xVfolZc9Zt9eoP5jwQEvbVZFlrsQ',
        price: 15.99,
        originalPrice: 119.99,
        rating: 4.5,
        reviews: 12001,
        duration: '12h',
        isBestseller: false,
        previewVideo: 'https://www.w3schools.com/html/mov_bbb.mp4'
    },
    {
        id: 'course-marketing',
        title: 'Digital Marketing Strategy Course 2024',
        category: 'Marketing',
        instructor: 'Phil Ebiner',
        instructorRole: 'Video School Online Inc',
        thumbnailUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuA3CSG7MTDBodlUIBlY3lMpZKI20hDueherr1_BG9tl83T3_76rBLgcRVyvp8XdUIjBx2WWEY0Pr83WpsAfMx4PfcIhB0CHs5Ld-dVqc3ut-6jqE2AYjnAIFykNHfDnU3dIiPRSR9apdplRwBz4iOGDm8u5RVXrX26SmjvviSIr70jqE9OoWRXx7U9UdVJwe0Ayv2FdGGQ6dr4uhBTqF__WtzOnNQNF_fxJl_vYkTK_Ts1F2Ufy2TClWAItRxleq8J9W2mdoIgbIkY-',
        price: 12.99,
        originalPrice: 84.99,
        rating: 4.6,
        reviews: 5420,
        duration: '24h',
        isBestseller: false,
        previewVideo: 'https://www.w3schools.com/html/mov_bbb.mp4'
    },
    {
        id: 'course-management',
        title: 'Modern Management: Lead Your Team to Success',
        category: 'Business',
        instructor: 'Sheryl Sandberg',
        instructorRole: 'Former COO of Meta',
        thumbnailUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuC0Ii7N67n4p6i2piP2gPPooXxZXbRIy-PqGatLG5XfNiIaVCxQz_3bFVxfFsweHCZLSDqOIVs_nNE0nIeJOGCid2nClNYyFNPeZmvPVn9Os7PuP2GCmoD_yZK5hY_rMXZi7i4xBXCAfMpAE55r0oBXmhXkqnzhBg_DA-OHQBjqb7_UQnkjr5mo_8vByCe9isniMZp_trdGkl42bO7DhQOUELkNEqAM9hr8ea4CUYVYOSZeQDN6ODkRkXSYtHNQpkEJ6waHA1qHxGtV',
        price: 13.99,
        originalPrice: 89.99,
        rating: 4.8,
        reviews: 3105,
        duration: '8.5h',
        isBestseller: false,
        previewVideo: 'https://www.w3schools.com/html/mov_bbb.mp4'
    }
];

class TacliimiDB {

    // ==========================================
    // INITIALIZATION
    // ==========================================
    static init() {
        if (!localStorage.getItem(TACLIIMI_DB_KEY)) {
            localStorage.setItem(TACLIIMI_DB_KEY, JSON.stringify(defaultCourses));
        }
        if (!localStorage.getItem(TACLIIMI_ENROLLED_KEY)) {
            localStorage.setItem(TACLIIMI_ENROLLED_KEY, JSON.stringify([]));
        }
        if (!localStorage.getItem(TACLIIMI_USERS_KEY)) {
            localStorage.setItem(TACLIIMI_USERS_KEY, JSON.stringify([]));
        }
        if (!localStorage.getItem(TACLIIMI_RESETS_KEY)) {
            localStorage.setItem(TACLIIMI_RESETS_KEY, JSON.stringify([]));
        }
        if (!localStorage.getItem(TACLIIMI_WISHLIST_KEY)) {
            // Check legacy wishlist key used in earlier version
            const legacyWishlist = localStorage.getItem('tacliimi_wishlist');
            if (legacyWishlist) {
                // Migrate the IDs instead of full objects
                try {
                    const parsed = JSON.parse(legacyWishlist);
                    if (parsed.length > 0 && parsed[0] !== null && typeof parsed[0] === 'object') {
                        const ids = parsed.map(c => c.id);
                        localStorage.setItem(TACLIIMI_WISHLIST_KEY, JSON.stringify(ids));
                    }
                } catch (e) { }
            } else {
                localStorage.setItem(TACLIIMI_WISHLIST_KEY, JSON.stringify([]));
            }
        }
    }

    // ==========================================
    // COURSES
    // ==========================================
    static getAllCourses() {
        this.init();
        return JSON.parse(localStorage.getItem(TACLIIMI_DB_KEY)) || [];
    }

    static getCourseById(id) {
        const courses = this.getAllCourses();
        return courses.find(c => c.id === id) || null;
    }

    static addCourse(course) {
        const courses = this.getAllCourses();
        courses.unshift(course); // Add to beginning (newest first)
        localStorage.setItem(TACLIIMI_DB_KEY, JSON.stringify(courses));
    }

    // ==========================================
    // ENROLLMENTS
    // ==========================================
    static getEnrolledCourseIds() {
        this.init();
        return JSON.parse(localStorage.getItem(TACLIIMI_ENROLLED_KEY)) || [];
    }

    static getEnrolledCourses() {
        const ids = this.getEnrolledCourseIds();
        return ids.map(id => this.getCourseById(id)).filter(c => c !== null);
    }

    static enrollCourse(courseId) {
        let enrolled = this.getEnrolledCourseIds();
        if (!enrolled.includes(courseId)) {
            enrolled.push(courseId);
            localStorage.setItem(TACLIIMI_ENROLLED_KEY, JSON.stringify(enrolled));
            // Automatically remove from wishlist if enrolled
            this.removeFromWishlist(courseId);
        }
    }

    static isEnrolled(courseId) {
        return this.getEnrolledCourseIds().includes(courseId);
    }

    // ==========================================
    // WISHLIST
    // ==========================================
    static getWishlistCourseIds() {
        this.init();
        return JSON.parse(localStorage.getItem(TACLIIMI_WISHLIST_KEY)) || [];
    }

    static getWishlistedCourses() {
        const ids = this.getWishlistCourseIds();
        return ids.map(id => this.getCourseById(id)).filter(c => c !== null);
    }

    static addToWishlist(courseId) {
        let wishlist = this.getWishlistCourseIds();
        if (!wishlist.includes(courseId)) {
            wishlist.push(courseId);
            localStorage.setItem(TACLIIMI_WISHLIST_KEY, JSON.stringify(wishlist));
        }
        return true;
    }

    static removeFromWishlist(courseId) {
        let wishlist = this.getWishlistCourseIds();
        wishlist = wishlist.filter(id => id !== courseId);
        localStorage.setItem(TACLIIMI_WISHLIST_KEY, JSON.stringify(wishlist));
    }

    static isWishlisted(courseId) {
        return this.getWishlistCourseIds().includes(courseId);
    }

    static toggleWishlist(courseId) {
        if (this.isWishlisted(courseId)) {
            this.removeFromWishlist(courseId);
            return false;
        } else {
            this.addToWishlist(courseId);
            return true;
        }
    }

    // ==========================================
    // AUTHENTICATION & USERS
    // ==========================================

    /**
     * Helper to simulate hashing (for demonstration purposes)
     */
    static _hashPassword(password) {
        // In a real app this would use bcrypt/argon2.
        // For the frontend simulator, a basic base64 or custom string shift is enough to "hash" it.
        return btoa(password + "_tacliimi_salt");
    }

    static getAllUsers() {
        this.init();
        return JSON.parse(localStorage.getItem(TACLIIMI_USERS_KEY)) || [];
    }

    static saveUsers(users) {
        localStorage.setItem(TACLIIMI_USERS_KEY, JSON.stringify(users));
    }

    /**
     * Registers a new user. Throws error if email already exists.
     */
    static registerUser(userData) {
        const users = this.getAllUsers();
        if (users.find(u => u.email === userData.email)) {
            throw new Error("Email is already registered.");
        }

        const newUser = {
            id: 'user_' + Date.now().toString(36) + Math.random().toString(36).substr(2),
            fullName: userData.fullName || '',
            displayName: userData.displayName || userData.fullName,
            email: userData.email,
            passwordHash: this._hashPassword(userData.password),
            role: userData.role || 'student', // 'student' or 'instructor'
            profileImage: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        users.push(newUser);
        this.saveUsers(users);

        // Auto-login after registration
        this._createSession(newUser);
        return newUser;
    }

    /**
     * Log in a user. Strictly validates email and password constraints.
     */
    static loginUser(email, password) {
        const users = this.getAllUsers();
        const user = users.find(u => u.email === email);

        if (!user) {
            throw new Error("Account not found");
        }

        if (user.passwordHash !== this._hashPassword(password)) {
            throw new Error("Incorrect password");
        }

        this._createSession(user);
        return user;
    }

    static logout() {
        localStorage.removeItem(TACLIIMI_SESSION_KEY);
    }

    static _createSession(user) {
        const session = {
            userId: user.id,
            role: user.role,
            email: user.email,
            displayName: user.displayName,
            fullName: user.fullName,
            expires: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
        };
        localStorage.setItem(TACLIIMI_SESSION_KEY, JSON.stringify(session));
    }

    static getCurrentSession() {
        const sessionData = localStorage.getItem(TACLIIMI_SESSION_KEY);
        if (!sessionData) return null;

        const session = JSON.parse(sessionData);
        if (Date.now() > session.expires) {
            this.logout();
            return null;
        }
        return session;
    }

    static getCurrentUser() {
        const session = this.getCurrentSession();
        if (!session) return null;

        const users = this.getAllUsers();
        return users.find(u => u.id === session.userId) || null;
    }

    /**
     * Change user password (for logged-in users inside Account Settings)
     */
    static changePassword(currentPassword, newPassword) {
        const session = this.getCurrentSession();
        if (!session) throw new Error("Must be logged in to change password.");

        const users = this.getAllUsers();
        let userIndex = users.findIndex(u => u.id === session.userId);

        if (userIndex === -1) throw new Error("User not found.");

        let user = users[userIndex];
        if (user.passwordHash !== this._hashPassword(currentPassword)) {
            throw new Error("Current password is incorrect.");
        }

        user.passwordHash = this._hashPassword(newPassword);
        user.updatedAt = new Date().toISOString();
        users[userIndex] = user;
        this.saveUsers(users);
        return true;
    }

    // ==========================================
    // PASSWORD RESET (Forgot Password Flow)
    // ==========================================
    static createResetToken(email) {
        const users = this.getAllUsers();
        const user = users.find(u => u.email === email);
        if (!user) {
            throw new Error("No account is registered with this email.");
        }

        let resets = JSON.parse(localStorage.getItem(TACLIIMI_RESETS_KEY)) || [];
        // Clean out older tokens for this user
        resets = resets.filter(r => r.userId !== user.id);

        const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        const resetData = {
            token,
            userId: user.id,
            expires: Date.now() + 10 * 60 * 1000 // 10 minutes from now
        };

        resets.push(resetData);
        localStorage.setItem(TACLIIMI_RESETS_KEY, JSON.stringify(resets));
        return token;
    }

    static verifyResetToken(token) {
        let resets = JSON.parse(localStorage.getItem(TACLIIMI_RESETS_KEY)) || [];
        const resetData = resets.find(r => r.token === token);

        if (!resetData) return false;
        if (Date.now() > resetData.expires) {
            // Expired, clear it out
            resets = resets.filter(r => r.token !== token);
            localStorage.setItem(TACLIIMI_RESETS_KEY, JSON.stringify(resets));
            return false;
        }
        return resetData;
    }

    static applyPasswordReset(token, newPassword) {
        const resetData = this.verifyResetToken(token);
        if (!resetData) {
            throw new Error("Invalid or expired reset token.");
        }

        const users = this.getAllUsers();
        const userIndex = users.findIndex(u => u.id === resetData.userId);

        if (userIndex === -1) throw new Error("User associated with this token no longer exists.");

        let user = users[userIndex];
        user.passwordHash = this._hashPassword(newPassword);
        user.updatedAt = new Date().toISOString();
        users[userIndex] = user;
        this.saveUsers(users);

        // Remove token now that it is consumed
        let resets = JSON.parse(localStorage.getItem(TACLIIMI_RESETS_KEY)) || [];
        resets = resets.filter(r => r.token !== token);
        localStorage.setItem(TACLIIMI_RESETS_KEY, JSON.stringify(resets));

        // Auto login user after successful reset
        this._createSession(user);
        return user;
    }

    // ==========================================
    // GLOBAL PROFILE HELPER
    // ==========================================
    static updateProfileInfo(info) {
        const session = this.getCurrentSession();
        if (!session) return;

        const users = this.getAllUsers();
        let userIndex = users.findIndex(u => u.id === session.userId);
        if (userIndex !== -1) {
            users[userIndex] = { ...users[userIndex], ...info };
            this.saveUsers(users);
        }

        Object.assign(session, info);
        localStorage.setItem(TACLIIMI_SESSION_KEY, JSON.stringify(session));

        this.applyGlobalProfile();
    }

    static updateProfileImage(imageUrl) {
        const session = this.getCurrentSession();
        if (!session) throw new Error("Must be logged in.");

        const users = this.getAllUsers();
        let userIndex = users.findIndex(u => u.id === session.userId);
        if (userIndex !== -1) {
            users[userIndex].profileImage = imageUrl;
            this.saveUsers(users);
        }

        // Also update session
        session.profileImage = imageUrl;
        localStorage.setItem(TACLIIMI_SESSION_KEY, JSON.stringify(session));

        // Immediately apply
        this.applyGlobalProfile();
    }

    static applyGlobalProfile() {
        const session = this.getCurrentSession();
        if (!session) return;

        // Common classes in Tacliimi for name displays
        const nameElements = document.querySelectorAll('.text-right p.font-semibold, .user-display-name, h1.text-3xl.font-bold, .profile-name');

        nameElements.forEach(el => {
            if (el.tagName === 'H1' && el.textContent.includes('Welcome back')) {
                // Keep the emoji structure
                el.innerText = `Welcome back, ${session.displayName || session.fullName}! 👋`;
            } else if (!el.classList.contains('text-3xl')) {
                // Regular names
                if (el.closest('.text-right') || el.classList.contains('user-display-name') || el.classList.contains('profile-name')) {
                    el.innerText = session.displayName || session.fullName || 'Learner';
                }
            }
        });

        const idElements = document.querySelectorAll('[data-role="profile-meta"]');
        idElements.forEach(el => {
            const txt = (el.innerText || '').toLowerCase();
            if (txt.includes('id:') || txt.includes('account') || txt.includes('student') || txt.includes('instructor')) {
                el.innerText = session.role === 'instructor' ? "Instructor Account" : "Student Account";
            }
        });

        // Profile pictures
        if (session.profileImage || session.profilePicture) {
            const imgSrc = session.profileImage || session.profilePicture;
            // Use safe data attributes instead of bracketed tailwind selectors
            const imgElements = document.querySelectorAll('[data-role="profile-image"] img, img.profile-picture-img');
            imgElements.forEach(img => {
                img.src = imgSrc;
            });

            // Also create image inside empty placeholders
            const emptyPlaceholders = document.querySelectorAll('[data-role="profile-image"], .profile-image-container');
            emptyPlaceholders.forEach(el => {
                if (!el.querySelector('img')) {
                    el.innerHTML = `<img src="${imgSrc}" class="w-full h-full object-cover rounded-full" />`;
                    el.classList.add('overflow-hidden');
                }
            });
        }

        // Public page navigation swap
        // Instead of replacing a whole container and risking destroying sibling links, we will find the specific 
        // login/signup elements or placeholder account circles and replace them with a new container.
        let authElements = Array.from(document.querySelectorAll('nav, header')).flatMap(parent => {
            return Array.from(parent.querySelectorAll('a, button, div')).filter(el => {
                const href = el.getAttribute('href') || el.getAttribute('onclick') || '';
                const html = el.innerHTML || '';

                // Exclude mobile menus and large wrapper divs
                if (el.id === 'mobile-menu' || el.closest('#mobile-menu') || el.children.length > 3) return false;

                const isLoginLink = (href.includes('/src/pages/auth/login/') && !href.includes('instructor-login') && !href.includes('login-select')) || href.includes('user-login');
                const isPlaceholderProfile = (html.includes('account_circle') || html.includes('Student Name') || html.includes('Instructor account') || html.includes('ID: ') || html.includes('JD') || html.includes('User Profile') || html.includes('Student Profile')) &&
                    (el.tagName === 'DIV' && (el.classList.contains('rounded-full') || html.includes('Student Name') || html.includes('Instructor account')));

                return isLoginLink || isPlaceholderProfile;
            });
        });

        // Filter out nodes that are ancestors of other matched nodes,
        // AND STRICTLY require that the elements are inside a <header> or <nav>
        authElements = authElements.filter(el => {
            const isInsideHeader = el.closest('header') || el.closest('nav');
            return isInsideHeader && !authElements.some(other => other !== el && el.contains(other));
        });

        // Group auth elements by parent so we can replace them collectively per-navbar
        const parentMap = new Map();

        if (authElements.length === 0) {
            // Find a suitable right-aligned header container to attach to
            let fallbackContainer = null;

            // First, see if the developer explicitly left the TacliimiDB comment placeholder
            document.querySelectorAll('div').forEach(div => {
                if (div.innerHTML.includes('Global Profile Injected Below via TacliimiDB') && (div.closest('header') || div.closest('nav'))) {
                    fallbackContainer = div;
                }
            });

            // If not found, intelligently target the far-right controls container inside the nav/header
            if (!fallbackContainer) {
                const navOrHeader = document.querySelector('header') || document.querySelector('nav');
                if (navOrHeader) {
                    // Get the last div child which usually represents the right side flex container
                    const rootDivs = Array.from(navOrHeader.children).filter(c => c.tagName === 'DIV');
                    if (rootDivs.length > 0) {
                        fallbackContainer = rootDivs[rootDivs.length - 1]; // Far right group
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
            // Avoid selecting the injected profile again if running multiple times
            if (el.closest('.tacliimi-injected-profile')) return;
            if (!parentMap.has(el.parentElement)) parentMap.set(el.parentElement, []);
            parentMap.get(el.parentElement).push(el);
        });

        const roleDesc = session.role === 'instructor' ? 'Instructor' : 'Student';
        let defaultName = roleDesc;
        if (session.email) {
            let prefix = session.email.split('@')[0];
            defaultName = prefix.charAt(0).toUpperCase() + prefix.slice(1);
        }
        const displayName = session.displayName || session.fullName || defaultName;
        const profileImage = session.profileImage || session.profilePicture;

        const dashboardLink = session.role === 'instructor' ? '/src/pages/instructor/instructor-dashboard/index.html' : '/src/pages/student/student-dashboard/index.html';
        const roleName = session.role === 'instructor' ? 'Instructor' : 'Student';
        const imgSrc = profileImage;
        const picHtml = imgSrc
            ? `<img src="${imgSrc}" class="w-full h-full object-cover rounded-full" />`
            : `<span class="material-symbols-outlined text-2xl relative top-0.5">account_circle</span>`;
        const settingsLink = session.role === 'instructor' ? '/src/pages/instructor/instructor-profile/index.html' : '/src/pages/student/account-settings/index.html';

        const isPublicPage = !window.location.pathname.includes('dashboard') && !window.location.pathname.includes('settings') && !window.location.pathname.includes('profile') && !window.location.pathname.includes('admin');

        parentMap.forEach((elementsToRemove, container) => {
            // Remove existing duplicate notification bells and theme toggles in the navigation beforehand
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

            // Theme toggle icon (Sun/Moon).
            const themeToggleHtml = `
                <button type="button" onclick="event.preventDefault(); event.stopPropagation(); TacliimiDB.toggleTheme();" id="global-theme-toggle" class="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full flex items-center justify-center transition-colors !outline-none" title="Toggle Theme">
                    <span class="material-symbols-outlined dark:hidden text-[22px]">dark_mode</span>
                    <span class="material-symbols-outlined hidden dark:block text-[22px]">light_mode</span>
                </button>
            `;

            // Logout icon.
            const logoutHtml = `
                <button onclick="TacliimiDB.logout(); window.location.href='/src/pages/auth/login-select/index.html';" class="p-2 text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 dark:hover:text-red-400 rounded-full flex items-center justify-center transition-colors !outline-none" title="Log Out">
                    <span class="material-symbols-outlined text-[20px]">logout</span>
                </button>
            `;

            // Avatar and name dropdown logic. Now always shown.
            const avatarHtml = `
            <div class="relative group flex items-center gap-3 cursor-pointer" id="global-profile-dropdown">
                <div class="hidden sm:block text-right group-hover:opacity-80 transition-opacity">
                    <p class="user-display-name text-sm font-semibold text-slate-900 dark:text-white capitalize">${displayName}</p>
                </div>
                <div class="h-10 w-10 shrink-0 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center border-2 border-primary/20 text-slate-400 overflow-hidden" data-role="profile-image">
                    ${picHtml}
                </div>
            
                <!-- Dropdown Menu -->
                <div class="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-slate-800 rounded-xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-700 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100] overflow-hidden text-left cursor-default">
                    <div class="p-4 border-b border-slate-100 dark:border-slate-700">
                        <p class="text-sm font-semibold text-slate-900 dark:text-white">${displayName}</p>
                        <p class="text-xs text-slate-500">${session.email || roleName}</p>
                    </div>
                    <a href="${dashboardLink}" class="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-primary transition-colors border-b border-slate-100 dark:border-slate-700/50">
                        <span class="material-symbols-outlined text-lg">dashboard</span> Dashboard
                    </a>
                    <a href="${settingsLink}" class="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-primary transition-colors border-b border-slate-100 dark:border-slate-700/50">
                        <span class="material-symbols-outlined text-lg">settings</span> Settings
                    </a>
                    <button onclick="TacliimiDB.logout(); window.location.href='/src/pages/auth/login-select/index.html';" class="w-full text-left flex items-center gap-3 px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                        <span class="material-symbols-outlined text-lg">logout</span> Logout
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
                    // Remove adjacent hardcoded text blocks (like Name & ID) if present
                    const sibling = el.previousElementSibling;
                    if (sibling && (sibling.innerText.includes(session.displayName) || sibling.innerText.includes('Student Name') || sibling.innerText.includes('Instructor Account') || sibling.innerText.includes('ID:'))) {
                        sibling.remove();
                    }
                    el.remove();
                }
            });

            // Additionally clean up empty placeholder divs in the header
            container.querySelectorAll('div').forEach(emptyDiv => {
                if (emptyDiv !== container && emptyDiv.innerHTML.trim() === '<!-- Global Profile Injected Below via TacliimiDB -->') {
                    emptyDiv.remove();
                }
            });
        });

        // Globally update generic "Welcome, Instructor!" labels and display names
        document.querySelectorAll('.auto-welcome-name, .user-display-name').forEach(el => {
            el.innerText = displayName;
        });

        // Update mobile menu buttons if they exist
        const mobileMenuAuth = document.querySelectorAll('#mobile-menu button');
        if (mobileMenuAuth.length >= 2) {
            mobileMenuAuth[0].innerText = 'Dashboard';
            mobileMenuAuth[0].onclick = () => window.location.href = dashboardLink;
            mobileMenuAuth[1].innerText = 'Log Out';
            mobileMenuAuth[1].classList.add('!text-red-500');
            mobileMenuAuth[1].onclick = () => { TacliimiDB.logout(); window.location.href = '/src/pages/auth/login-select/index.html'; };
        }

        // Hide instructor CTA links for logged-in instructors
        if (session.role === 'instructor') {
            document.querySelectorAll('a, button').forEach(el => {
                const attr = el.getAttribute('href') || el.getAttribute('onclick') || '';
                const txt = (el.innerText || '').toLowerCase();

                if (attr.includes('/src/pages/instructor/become-instructor/') || txt.includes('become a teacher') || txt.includes('teach on tacliimi')) {
                    el.style.display = 'none';
                }
            });
        }
    }
}

// Ensure init runs
TacliimiDB.init();

// Apply global profile automatically when DB script loads (so it sticks on all pages)
document.addEventListener('DOMContentLoaded', () => {
    try {
        TacliimiDB.applyGlobalProfile();

        // 1. Universal Profile Updates: Also find anything with data-role="profile-meta" or raw ID labels

        // Auto-save form mechanism for all dashboards
        const session = TacliimiDB.getCurrentSession();
        if (session) {
            // Target all data-entry fields except passwords, files, and hidden inputs
            const inputs = document.querySelectorAll('input:not([type="password"]):not([type="file"]):not([type="hidden"]), textarea, select');

            inputs.forEach(input => {
                // Generate a reliable key based on ID, name, or preceding label text
                let key = input.id || input.name;
                if (!key && input.previousElementSibling && input.previousElementSibling.tagName === 'LABEL') {
                    key = input.previousElementSibling.innerText.trim().replace(/\s+/g, '_').toLowerCase();
                }

                if (key) {
                    // Map common variations of full name
                    if (key === 'full-name' || key.toLowerCase() === 'fullname') key = 'fullName';
                    if (key === 'display-name' || key.toLowerCase() === 'displayname') key = 'displayName';

                    // Load saved data into input
                    if (session[key] !== undefined) {
                        input.value = session[key];
                    }

                    // REMOVED 'change' auto-save listener. Profile only saves on 'Save Changes' button click.
                }
            });

            // For instructor specific "Save Changes" buttons to provide manual feedback
            const saveBtns = document.querySelectorAll('button');
            saveBtns.forEach(btn => {
                if (btn.innerText.includes('Save Changes') || btn.innerText.includes('Save Profile')) {
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();

                        // If it's the personal info form, trigger the inputs to save
                        const form = btn.closest('form, .settings-panel, section, main');
                        if (form) {
                            form.querySelectorAll('input, select, textarea').forEach(input => {
                                let key = input.id || input.name;
                                if (!key && input.previousElementSibling && input.previousElementSibling.tagName === 'LABEL') {
                                    key = input.previousElementSibling.innerText.trim().replace(/\s+/g, '_').toLowerCase();
                                }
                                if (key === 'full-name' || key === 'full_name' || key.toLowerCase() === 'fullname') key = 'fullName';
                                if (key === 'display-name' || key.toLowerCase() === 'displayname') key = 'displayName';

                                if (key) TacliimiDB.updateProfileInfo({ [key]: input.value });
                            });
                            // Immediately re-apply the global profile to update the header
                            TacliimiDB.applyGlobalProfile();
                        }

                        const origText = btn.innerHTML;
                        btn.innerHTML = `<span class="material-symbols-outlined text-[18px]">check</span> Saved Successfully`;
                        setTimeout(() => { btn.innerHTML = origText; }, 2000);
                    });
                }
            });

            // Add logout button next to dashboard profile blocks logic removed,
            // as the global logout button injection now handles logout consistently.


        } // End of if (session)

        // Global Theme Manager Initialization
        (function initGlobalTheme() {
            const html = document.documentElement;

            // Function to apply theme to DOM based on localStorage or OS pref
            function applyTheme() {
                const isDark = localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
                if (isDark) {
                    html.classList.add('dark');
                } else {
                    html.classList.remove('dark');
                }
            }

            // Always sync on page load
            applyTheme();

            // Find and bind all known theme toggle buttons globally, including our newly injected one
            const themeToggleButtons = document.querySelectorAll('#theme-toggle, #themeToggle, #global-theme-toggle, button[onclick*="dark"]');
            themeToggleButtons.forEach(btn => {
                // Remove inline onclick so our robust logic takes over
                if (btn.hasAttribute('onclick') && (btn.getAttribute('onclick').includes('toggle') || btn.getAttribute('onclick').includes('dark'))) {
                    btn.removeAttribute('onclick');
                }
                if (!btn.dataset.themeBound) {
                    btn.dataset.themeBound = 'true';
                    btn.addEventListener('click', () => {
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
        })();

    } catch (err) { }
});
