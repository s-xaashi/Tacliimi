import { AuthService } from './authService.js';
import { ThemeService } from './themeService.js';

/**
 * AdminSidebar Service
 * Handles role-based UI visibility, page guarding, profile header injection,
 * profile quick-edit popup, and global theme synchronization.
 */

// Global flicker protection logic — inject IMMEDIATELY
(function() {
    const style = document.createElement('style');
    style.id = 'admin-sidebar-flicker-protection';
    style.innerHTML = `
        #sidebar nav, .admin-nav-el { 
            opacity: 0 !important; 
            visibility: hidden !important; 
            transition: opacity 0.3s ease-in-out !important;
        }
        #sidebar nav.is-visible, .admin-nav-el.is-visible { 
            opacity: 1 !important; 
            visibility: visible !important; 
        }
    `;
    document.head.appendChild(style);
})();

// Inject the profile quick-edit popup HTML into every admin page
function injectProfilePopup() {
    const popupHTML = `
    <!-- Admin Profile Quick-Edit Popup -->
    <div id="admin-profile-popup" style="display:none; position:fixed; inset:0; z-index:9999; background:rgba(15,23,42,0.7); backdrop-filter:blur(8px); align-items:center; justify-content:center; padding:16px;">
        <div style="background:#fff; border-radius:24px; width:100%; max-width:480px; padding:32px; box-shadow:0 32px 80px rgba(0,0,0,0.25); border:1px solid #e2e8f0; max-height:90vh; overflow-y:auto;" id="popup-inner" class="dark:bg-slate-900 dark:border-slate-700">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:24px;">
                <div>
                    <h3 style="font-size:18px; font-weight:900; color:#0f172a; margin:0;" class="dark:text-white">My Profile</h3>
                    <p style="font-size:10px; font-weight:700; color:#6366f1; text-transform:uppercase; letter-spacing:0.15em; margin:4px 0 0;" id="popup-role-label">Administrator</p>
                </div>
                <button id="popup-close-btn" style="width:36px; height:36px; border-radius:50%; border:none; background:#f1f5f9; cursor:pointer; display:flex; align-items:center; justify-content:center; color:#64748b; font-size:20px;" class="dark:bg-slate-800 dark:text-slate-400">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>

            <!-- Avatar -->
            <div style="text-align:center; margin-bottom:24px;">
                <img id="popup-avatar-preview" src="" alt="Avatar" style="width:100px; height:100px; border-radius:30px; object-fit:cover; border:4px solid #e0e7ff; box-shadow:0 12px 32px rgba(79,70,229,0.15); display:block; margin:0 auto 12px;">
                <p style="font-size:11px; color:#94a3b8; font-weight:600; text-align:center;">Click "Save" after changing avatar URL</p>
            </div>

            <!-- Form -->
            <form id="popup-profile-form" style="display:flex; flex-direction:column; gap:16px;">
                <div>
                    <label style="font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:0.12em; color:#94a3b8; display:block; margin-bottom:6px;">Full Name</label>
                    <input type="text" id="popup-full-name" required placeholder="Your full name" style="width:100%; padding:14px 18px; background:#f8fafc; border:none; border-radius:14px; font-size:14px; font-weight:700; outline:none; box-sizing:border-box;" class="dark:bg-slate-800 dark:text-white">
                </div>
                <div>
                    <label style="font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:0.12em; color:#94a3b8; display:block; margin-bottom:6px;">Phone Number</label>
                    <input type="tel" id="popup-phone" placeholder="+1 (555) 000-0000" style="width:100%; padding:14px 18px; background:#f8fafc; border:none; border-radius:14px; font-size:14px; font-weight:700; outline:none; box-sizing:border-box;" class="dark:bg-slate-800 dark:text-white">
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:0.12em; color:#94a3b8; display:block; margin-bottom:6px;">City</label>
                        <input type="text" id="popup-city" placeholder="San Francisco" style="width:100%; padding:14px 18px; background:#f8fafc; border:none; border-radius:14px; font-size:14px; font-weight:700; outline:none; box-sizing:border-box;" class="dark:bg-slate-800 dark:text-white">
                    </div>
                    <div>
                        <label style="font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:0.12em; color:#94a3b8; display:block; margin-bottom:6px;">Address</label>
                        <input type="text" id="popup-address" placeholder="123 Admin Way" style="width:100%; padding:14px 18px; background:#f8fafc; border:none; border-radius:14px; font-size:14px; font-weight:700; outline:none; box-sizing:border-box;" class="dark:bg-slate-800 dark:text-white">
                    </div>
                </div>
                <div>
                    <label style="font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:0.12em; color:#94a3b8; display:block; margin-bottom:6px;">Avatar URL (optional)</label>
                    <input type="url" id="popup-avatar-url" placeholder="https://example.com/photo.jpg" style="width:100%; padding:14px 18px; background:#f8fafc; border:none; border-radius:14px; font-size:14px; font-weight:700; outline:none; box-sizing:border-box;" class="dark:bg-slate-800 dark:text-white">
                </div>

                <div id="popup-msg" style="display:none; padding:12px 16px; border-radius:12px; font-size:12px; font-weight:700;"></div>

                <div style="display:flex; gap:12px; margin-top:8px;">
                    <button type="button" id="popup-cancel-btn" style="flex:1; padding:14px; background:#f1f5f9; border:none; border-radius:14px; font-size:11px; font-weight:900; text-transform:uppercase; letter-spacing:0.1em; cursor:pointer; color:#64748b;" class="dark:bg-slate-800 dark:text-slate-400">
                        Cancel
                    </button>
                    <button type="submit" id="popup-save-btn" style="flex:2; padding:14px; background:#4f46e5; border:none; border-radius:14px; font-size:11px; font-weight:900; text-transform:uppercase; letter-spacing:0.1em; cursor:pointer; color:#fff; box-shadow:0 4px 16px rgba(79,70,229,0.3);">
                        Save Changes
                    </button>
                </div>
            </form>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', popupHTML);
}

document.addEventListener('DOMContentLoaded', async () => {
    // 0. Initialize Global Theme
    ThemeService.init();

    // Inject popup modal
    injectProfilePopup();

    try {
        const session = await AuthService.getSession();
        if (!session) {
            window.location.href = '/src/pages/auth/login.html';
            return;
        }

        const role = session.admin_role;
        const accessRules = {
            'superadmin': ['dashboard', 'courses-review', 'bookings-review', 'users', 'instructors', 'categories', 'admin-management', 'finance', 'settings', 'profile', 'analytics', 'course-manager'],
            'course_manager': ['dashboard', 'courses-review', 'bookings-review', 'categories', 'profile', 'course-manager'],
            'finance_manager': ['dashboard', 'finance', 'profile']
        };

        const allowedModules = accessRules[role] || ['dashboard', 'profile'];
        
        // Save role for other components
        session.admin_role = role;

        // 4. Guard current page access
        const currentPath = window.location.pathname;
        const currentModule = currentPath.split('/admin/')[1]?.split('/')[0];
        if (currentModule && currentModule !== 'dashboard' && !allowedModules.includes(currentModule)) {
            console.warn(`Role ${role} is not authorized for module: ${currentModule}. Redirecting to dashboard.`);
            window.location.replace('/src/pages/admin/dashboard/index.html');
            return;
        }

        // 5. Update Sidebar UI — hide disallowed links
        const sidebar = document.getElementById('sidebar');
        const nav = sidebar?.querySelector('nav');
        
        if (nav) {
            const navLinks = nav.querySelectorAll('a');
            navLinks.forEach(link => {
                const href = link.getAttribute('href');
                const moduleName = href.split('/admin/')[1]?.split('/')[0];
                if (moduleName && moduleName !== 'dashboard' && !allowedModules.includes(moduleName)) {
                    link.style.display = 'none';
                }
            });
            
            // Show nav after filtering is done
            nav.classList.add('is-visible');
        }

        // 5. Load profile and populate header
        const profile = await AuthService.getCurrentProfile();

        // Try multiple ID patterns for maximum compatibility across pages
        const avatarEl = document.getElementById('header-avatar') || document.getElementById('admin-avatar-img');
        const nameEl = document.getElementById('header-admin-name') || document.getElementById('admin-name-header');

        const avatarUrl = profile?.avatar_url ||
            `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.full_name || 'Admin')}&background=4F46E5&color=fff`;

        if (avatarEl && avatarEl.tagName === 'IMG') {
            avatarEl.src = avatarUrl;
            avatarEl.alt = profile?.full_name || 'Admin';
        }
        if (nameEl) {
            nameEl.textContent = profile?.full_name || profile?.username || 'Admin';
        }

        // Also set welcome-name if present (dashboard)
        const welcomeNameEl = document.getElementById('admin-name');
        if (welcomeNameEl) {
            welcomeNameEl.textContent = profile?.full_name || profile?.username || 'Admin';
        }

        // 6. Make header profile area clickable → open popup
        const headerProfileArea = document.getElementById('header-profile-area');
        if (headerProfileArea) {
            headerProfileArea.style.cursor = 'pointer';
            headerProfileArea.addEventListener('click', () => openProfilePopup(profile));
        }

        // 7. Set up profile popup logic
        setupProfilePopup(profile);

        // 8. Global Theme Toggle Listener
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            // Remove inline handlers that might bypass ThemeService
            const freshToggle = themeToggle.cloneNode(true);
            themeToggle.parentNode.replaceChild(freshToggle, themeToggle);
            freshToggle.addEventListener('click', () => ThemeService.toggle());
        }

        // 9. Logout
        document.getElementById('logout-btn')?.addEventListener('click', async () => {
            await AuthService.logout();
            window.location.href = '/src/pages/auth/login-select/index.html';
        });

        // 10. Mobile sidebar toggle
        const toggleBtn = document.getElementById('toggle-sidebar');
        const sidebarEl = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        toggleBtn?.addEventListener('click', () => {
            sidebarEl?.classList.toggle('-translate-x-full');
            overlay?.classList.toggle('hidden');
        });
        overlay?.addEventListener('click', () => {
            sidebarEl?.classList.add('-translate-x-full');
            overlay?.classList.add('hidden');
        });

    } catch (error) {
        console.error('AdminSidebar init error:', error);
    }
});

let _currentProfile = null;

function openProfilePopup(profile) {
    _currentProfile = profile;
    const popup = document.getElementById('admin-profile-popup');
    if (!popup) return;

    // Populate fields
    document.getElementById('popup-full-name').value = profile?.full_name || '';
    document.getElementById('popup-phone').value = profile?.phone_number || '';
    document.getElementById('popup-city').value = profile?.city || '';
    document.getElementById('popup-address').value = profile?.address || '';
    document.getElementById('popup-avatar-url').value = profile?.avatar_url || '';

    // Avatar preview
    const avatarUrl = profile?.avatar_url ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.full_name || 'Admin')}&background=4F46E5&color=fff`;
    document.getElementById('popup-avatar-preview').src = avatarUrl;

    // Role badge
    const roleLabels = {
        'superadmin': 'Super Administrator',
        'course_manager': 'Course Manager',
        'finance_manager': 'Finance Manager'
    };
    document.getElementById('popup-role-label').textContent = roleLabels[profile?.admin_role] || 'Administrator';

    // Apply dark mode styles dynamically
    const inner = document.getElementById('popup-inner');
    if (document.documentElement.classList.contains('dark')) {
        inner.style.background = '#0f172a';
        inner.style.borderColor = '#1e293b';
        popup.querySelectorAll('input').forEach(inp => {
            inp.style.background = '#1e293b';
            inp.style.color = '#f1f5f9';
        });
    }

    popup.style.display = 'flex';

    // Hide any stale messages
    const msg = document.getElementById('popup-msg');
    if (msg) msg.style.display = 'none';
}

function setupProfilePopup(profile) {
    const popup = document.getElementById('admin-profile-popup');
    if (!popup) return;

    // Close buttons
    const closePopup = () => { popup.style.display = 'none'; };
    document.getElementById('popup-close-btn')?.addEventListener('click', closePopup);
    document.getElementById('popup-cancel-btn')?.addEventListener('click', closePopup);

    // Close on backdrop click
    popup.addEventListener('click', (e) => {
        if (e.target === popup) closePopup();
    });

    // Live avatar preview on URL input
    document.getElementById('popup-avatar-url')?.addEventListener('input', (e) => {
        const url = e.target.value.trim();
        if (url) document.getElementById('popup-avatar-preview').src = url;
        else {
            const name = document.getElementById('popup-full-name')?.value || 'Admin';
            document.getElementById('popup-avatar-preview').src =
                `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=4F46E5&color=fff`;
        }
    });

    // Submit
    document.getElementById('popup-profile-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const saveBtn = document.getElementById('popup-save-btn');
        const msg = document.getElementById('popup-msg');

        const updates = {
            full_name: document.getElementById('popup-full-name').value.trim(),
            phone_number: document.getElementById('popup-phone').value.trim() || null,
            city: document.getElementById('popup-city').value.trim() || null,
            address: document.getElementById('popup-address').value.trim() || null,
            avatar_url: document.getElementById('popup-avatar-url').value.trim() || null,
        };

        try {
            saveBtn.textContent = 'Saving...';
            saveBtn.disabled = true;

            await AuthService.updateAdminProfile(updates);

            msg.style.display = 'block';
            msg.style.background = '#ecfdf5';
            msg.style.color = '#065f46';
            msg.textContent = '✓ Profile updated successfully!';

            // Refresh header elements on current page
            const avatarEl = document.getElementById('header-avatar') || document.getElementById('admin-avatar-img');
            const nameEl = document.getElementById('header-admin-name') || document.getElementById('admin-name-header');
            const welcomeEl = document.getElementById('admin-name');

            const newAvatarUrl = updates.avatar_url ||
                `https://ui-avatars.com/api/?name=${encodeURIComponent(updates.full_name)}&background=4F46E5&color=fff`;

            if (avatarEl && avatarEl.tagName === 'IMG') avatarEl.src = newAvatarUrl;
            if (nameEl) nameEl.textContent = updates.full_name;
            if (welcomeEl) welcomeEl.textContent = updates.full_name;

            // Update popup avatar preview
            document.getElementById('popup-avatar-preview').src = newAvatarUrl;

            setTimeout(() => { popup.style.display = 'none'; }, 1500);
        } catch (err) {
            msg.style.display = 'block';
            msg.style.background = '#fef2f2';
            msg.style.color = '#991b1b';
            msg.textContent = '✗ Error: ' + err.message;
        } finally {
            saveBtn.textContent = 'Save Changes';
            saveBtn.disabled = false;
        }
    });
}

// Export for use in pages that want to open the popup programmatically
export function openAdminProfilePopup() {
    AuthService.getCurrentProfile().then(profile => openProfilePopup(profile));
}

// --- System Broadcast Modal ---
const broadcastModalHTML = `
<div id="broadcast-preview-modal" style="display:none; position:fixed; inset:0; z-index:10000; background:rgba(15,23,42,0.8); backdrop-filter:blur(10px); align-items:center; justify-content:center; padding:20px;">
    <div style="background:#fff; border-radius:32px; width:100%; max-width:560px; overflow:hidden; box-shadow:0 40px 100px rgba(0,0,0,0.3); border:1px solid #e2e8f0;" class="dark:bg-slate-900 dark:border-slate-800">
        <div style="padding:40px; position:relative;">
            <button id="broadcast-close-btn" style="position:absolute; right:24px; top:24px; width:40px; height:40px; border-radius:50%; border:none; background:#f1f5f9; cursor:pointer; color:#64748b; display:flex; align-items:center; justify-content:center;" class="dark:bg-slate-800 dark:text-slate-400">
                <span class="material-symbols-outlined">close</span>
            </button>
            <div style="margin-bottom:32px;">
                <div style="width:56px; height:56px; border-radius:18px; background:rgba(79,70,229,0.1); color:#4f46e5; display:flex; align-items:center; justify-content:center; margin-bottom:20px;" class="dark:bg-indigo-900/30 dark:text-indigo-400">
                    <span class="material-symbols-outlined text-3xl">campaign</span>
                </div>
                <span style="font-size:10px; font-weight:900; color:#6366f1; text-transform:uppercase; letter-spacing:0.2em;" id="broadcast-preview-type">System Broadcast</span>
                <h2 style="font-size:24px; font-weight:900; color:#0f172a; margin:8px 0 0;" id="broadcast-preview-title" class="dark:text-white">Broadcast Title</h2>
                <p style="font-size:12px; color:#94a3b8; font-weight:600; margin-top:4px;" id="broadcast-preview-date"></p>
            </div>
            <div style="font-size:16px; line-height:1.7; color:#475569; font-weight:500;" id="broadcast-preview-content" class="dark:text-slate-300"></div>
            <div style="margin-top:40px;">
                <button id="broadcast-done-btn" style="width:100%; padding:16px; background:#4f46e5; color:#fff; border:none; border-radius:16px; font-weight:800; cursor:pointer; font-size:14px;">Got it, thanks</button>
            </div>
        </div>
    </div>
</div>`;

function injectBroadcastModal() {
    if (!document.getElementById('broadcast-preview-modal')) {
        document.body.insertAdjacentHTML('beforeend', broadcastModalHTML);
        const modal = document.getElementById('broadcast-preview-modal');
        const closeBtn = document.getElementById('broadcast-close-btn');
        const doneBtn = document.getElementById('broadcast-done-btn');
        const closeModal = () => { modal.style.display = 'none'; };
        closeBtn.onclick = closeModal;
        doneBtn.onclick = closeModal;
        modal.onclick = (e) => { if (e.target === modal) closeModal(); };
    }
}

window.openBroadcastModal = (broadcast) => {
    injectBroadcastModal();
    const modal = document.getElementById('broadcast-preview-modal');
    document.getElementById('broadcast-preview-title').textContent = broadcast.title || 'System Notification';
    document.getElementById('broadcast-preview-content').innerHTML = (broadcast.message || broadcast.content || '').replace(/\n/g, '<br>');
    document.getElementById('broadcast-preview-type').textContent = broadcast.type || 'System Broadcast';
    document.getElementById('broadcast-preview-date').textContent = broadcast.created_at ? new Date(broadcast.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '';
    modal.style.display = 'flex';
};

// --- Admin Login Notification ---
const showAdminLoginNotify = () => {
    if (!sessionStorage.getItem('admin_login_notified')) {
        const container = document.createElement('div');
        container.style.cssText = `
            position: fixed; top: 24px; right: 24px; z-index: 10001;
            background: #fff; border-radius: 20px; padding: 16px 24px;
            box-shadow: 0 20px 50px rgba(0,0,0,0.15); border: 1px solid #e2e8f0;
            display: flex; align-items:center; gap: 16px; animation: slideIn 0.5s cubic-bezier(0.19, 1, 0.22, 1);
        `;
        container.className = 'dark:bg-slate-900 dark:border-slate-800';
        container.innerHTML = `
            <div style="width:40px; height:40px; border-radius:12px; background:#4f46e5; color:#fff; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                <span class="material-symbols-outlined">shield_person</span>
            </div>
            <div>
                <h4 style="font-size:14px; font-weight:800; color:#0f172a; margin:0;" class="dark:text-white">System Admin Login</h4>
                <p style="font-size:11px; color:#64748b; font-weight:600; margin:2px 0 0;">Authorized access granted to your account</p>
            </div>
        `;
        const style = document.createElement('style');
        style.id = 'admin-login-notify-style';
        style.textContent = `
            @keyframes slideIn { from { transform: translateX(100%); opacity:0; } to { transform: translateX(0); opacity:1; } }
            @keyframes slideOut { from { transform: translateX(0); opacity:1; } to { transform: translateX(100%); opacity:0; } }
        `;
        if (!document.getElementById('admin-login-notify-style')) document.head.appendChild(style);
        document.body.appendChild(container);
        sessionStorage.setItem('admin_login_notified', 'true');
        setTimeout(() => {
            container.style.animation = 'slideOut 0.5s forwards';
            setTimeout(() => container.remove(), 500);
        }, 5000);
    }
};

setTimeout(showAdminLoginNotify, 1000);
