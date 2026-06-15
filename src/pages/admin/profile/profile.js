import { AuthService } from '../../../services/authService.js';
import { supabase } from '../../../services/supabaseClient.js';
import { ThemeService } from '../../../services/themeService.js';

/**
 * Admin Profile Management Logic
 */
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize Theme
    ThemeService.init();

    const form = document.getElementById('profile-form');
    const saveBtn = document.getElementById('save-btn');
    const avatarInput = document.getElementById('avatar-upload');
    const avatarPreview = document.getElementById('profile-avatar-preview');
    const avatarUrlInput = document.getElementById('avatar-url');
    
    const fullNameInput = document.getElementById('full-name');
    const phoneInput = document.getElementById('phone-number');
    const cityInput = document.getElementById('city');
    const addressInput = document.getElementById('address');
    
    const profileNameDisplay = document.getElementById('profile-name-display');
    const profileUsernameDisplay = document.getElementById('profile-username-display');
    const profileRoleBadge = document.getElementById('profile-role-badge');
    const profileLastLogin = document.getElementById('profile-last-login');

    // 1. Initial Data Fetch
    async function loadProfile() {
        try {
            const profile = await AuthService.getCurrentProfile();
            if (!profile || !profile.is_admin) {
                window.location.replace('/src/pages/auth/login-select/index.html');
                return;
            }

            // Populate form
            fullNameInput.value = profile.full_name || '';
            phoneInput.value = profile.phone_number || '';
            cityInput.value = profile.city || '';
            addressInput.value = profile.address || '';
            avatarUrlInput.value = profile.avatar_url || '';
            
            // Populate displays
            profileNameDisplay.textContent = profile.full_name || 'Administrator';
            profileUsernameDisplay.textContent = profile.username ? `@${profile.username}` : 'No username';
            profileRoleBadge.textContent = profile.admin_role || 'Admin';
            avatarPreview.src = profile.avatar_url;

            // Header update (redundant if sidebar service handles it, but good for instant feedback)
            const headerName = document.getElementById('header-admin-name');
            const headerAvatar = document.getElementById('header-avatar');
            if (headerName) headerName.textContent = profile.full_name;
            if (headerAvatar) headerAvatar.src = profile.avatar_url;

        } catch (error) {
            console.error('Error loading admin profile:', error);
            showNotification('Failed to load profile data', 'error');
        }
    }

    await loadProfile();

    // 2. Handle Form Submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<span class="material-symbols-outlined animate-spin text-xl">sync</span> Synchronizing...`;

        const updates = {
            full_name: fullNameInput.value.trim(),
            phone_number: phoneInput.value.trim(),
            city: cityInput.value.trim(),
            address: addressInput.value.trim(),
            avatar_url: avatarUrlInput.value.trim()
        };

        try {
            await AuthService.updateAdminProfile(updates);
            showNotification('Profile synchronized successfully!', 'success');
            await loadProfile(); // Refresh UI
        } catch (error) {
            console.error('Update error:', error);
            showNotification(error.message || 'Failed to update profile', 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<span class="material-symbols-outlined text-xl">save</span> Synchronize Profile`;
        }
    });

    // 3. Handle Avatar Upload
    avatarInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Validation
        if (!file.type.startsWith('image/')) {
            showNotification('Please upload an image file', 'error');
            return;
        }

        if (file.size > 2 * 1024 * 1024) { // 2MB limit
            showNotification('Image size must be less than 2MB', 'error');
            return;
        }

        try {
            const session = await AuthService.getSession();
            const fileExt = file.name.split('.').pop();
            const fileName = `${Math.random().toString(36).substring(7)}.${fileExt}`;
            const filePath = `${session.user.id}/${fileName}`;

            // Upload to Supabase Storage
            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            // Get Public URL
            const { data: { publicUrl } } = supabase.storage
                .from('avatars')
                .getPublicUrl(filePath);

            // Update form and preview
            avatarUrlInput.value = publicUrl;
            avatarPreview.src = publicUrl;
            
            showNotification('Photo uploaded. Click save to apply.', 'info');

        } catch (error) {
            console.error('Upload Error:', error);
            showNotification('Failed to upload image', 'error');
        }
    });

    // 4. Utility: Show Notification
    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `fixed bottom-8 right-8 px-6 py-4 rounded-2xl shadow-2xl z-50 transform translate-y-2 opacity-0 transition-all duration-300 font-bold flex items-center gap-3 border ${
            type === 'success' ? 'bg-emerald-500 text-white border-emerald-400' :
            type === 'error' ? 'bg-red-500 text-white border-red-400' :
            'bg-indigo-600 text-white border-indigo-400'
        }`;
        
        const icon = type === 'success' ? 'check_circle' : type === 'error' ? 'error' : 'info';
        notification.innerHTML = `<span class="material-symbols-outlined">${icon}</span> ${message}`;
        
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.classList.remove('translate-y-2', 'opacity-0');
        }, 10);
        
        // Animate out
        setTimeout(() => {
            notification.classList.add('translate-y-2', 'opacity-0');
            setTimeout(() => notification.remove(), 300);
        }, 4000);
    }
});
