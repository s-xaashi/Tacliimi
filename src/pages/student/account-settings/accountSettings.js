import { supabase } from '/src/services/supabaseClient.js';
import { AuthService } from '/src/services/authService.js';
import { ProfileService } from '/src/services/profileService.js';
import { resolveProfileAvatar } from '/src/services/r2ImageUpload.js';

let currentUserSession = null;
let currentProfile = null;

// Helper: Show/Hide Skeletons
function toggleSkeletons(show) {
    const avatarSkeleton = document.getElementById('avatar-skeleton');
    const avatarContainer = document.getElementById('avatar-container');
    const formSkeletons = document.querySelectorAll('.form-skeleton');
    const formFields = document.querySelectorAll('.form-input-field');

    if (show) {
        if (avatarSkeleton) avatarSkeleton.classList.remove('hidden');
        if (avatarContainer) avatarContainer.classList.add('hidden');
        formSkeletons.forEach(el => el.classList.remove('hidden'));
        formFields.forEach(el => el.classList.add('hidden'));
    } else {
        if (avatarSkeleton) avatarSkeleton.classList.add('hidden');
        if (avatarContainer) avatarContainer.classList.remove('hidden');
        formSkeletons.forEach(el => el.classList.add('hidden'));
        formFields.forEach(el => el.classList.remove('hidden'));
    }
}

// Security: Sanitize text inputs against SQLi and XSS attacks
function sanitizeText(str) {
    if (!str) return '';
    let clean = str.trim();
    // Strip HTML tags and script elements
    clean = clean.replace(/<[^>]*>?/gm, '');
    // Neutralize dangerous JS protocols and inline event handlers
    clean = clean.replace(/javascript:/gi, '').replace(/on\w+=/gi, '');
    // Strip common SQL injection comment markers
    clean = clean.replace(/--/g, '').replace(/;/g, '');
    return clean;
}

// Security: Detect URLs/links in plain-text-only fields
function containsUrl(str) {
    if (!str) return false;
    return /https?:\/\/|www\.|ftp:\/\//i.test(str) || /[a-z0-9-]+\.(com|net|org|io|co|gov|edu|info|ng|so)([\/\?#]|$)/i.test(str);
}

// Security: Validate Public Social & Web Links
function validatePublicUrl(urlStr, platform) {
    if (!urlStr || !urlStr.trim()) return { valid: true, cleanUrl: '' };
    
    let trimmed = urlStr.trim();
    // Block malicious script/data protocols immediately
    if (/^(javascript|data|vbscript):/i.test(trimmed)) {
        return { valid: false, error: 'Invalid or unsafe link protocol.' };
    }

    // Auto-prepend https:// if protocol is missing
    if (!/^https?:\/\//i.test(trimmed)) {
        trimmed = 'https://' + trimmed;
    }

    try {
        const parsed = new URL(trimmed);
        const host = parsed.hostname.toLowerCase();

        switch (platform) {
            case 'github':
                if (!host.includes('github.com')) return { valid: false, error: 'Must be a valid GitHub URL (e.g., https://github.com/username)' };
                break;
            case 'linkedin':
                if (!host.includes('linkedin.com')) return { valid: false, error: 'Must be a valid LinkedIn URL (e.g., https://linkedin.com/in/username)' };
                break;
            case 'twitter':
                if (!host.includes('twitter.com') && !host.includes('x.com')) return { valid: false, error: 'Must be a valid Twitter/X URL (e.g., https://x.com/username)' };
                break;
            case 'facebook':
                if (!host.includes('facebook.com')) return { valid: false, error: 'Must be a valid Facebook URL (e.g., https://facebook.com/username)' };
                break;
            case 'website':
                if (!parsed.hostname.includes('.')) return { valid: false, error: 'Must be a valid web domain (e.g., https://yourwebsite.com)' };
                break;
        }

        return { valid: true, cleanUrl: parsed.href };
    } catch (e) {
        return { valid: false, error: 'Please enter a valid web URL format.' };
    }
}

// Phone Uniqueness Checker via Supabase RPC
async function isPhoneDuplicate(phone) {
    if (!phone || !phone.trim()) return false;
    try {
        const { data, error } = await supabase.rpc('check_profile_phone_unique', {
            p_phone: phone.trim(),
            p_user_id: currentProfile?.id || currentUserSession?.user?.id || null
        });
        if (error) {
            console.error('Phone uniqueness check error:', error);
            return false;
        }
        return !!data;
    } catch (e) {
        console.error('RPC invocation failure:', e);
        return false;
    }
}

// Clear individual field errors
function clearFieldErrors() {
    const errorEls = document.querySelectorAll('p[id$="-error"]');
    errorEls.forEach(el => {
        el.textContent = '';
        el.classList.add('hidden');
    });

    const inputs = document.querySelectorAll('.form-input-field');
    inputs.forEach(input => {
        input.classList.remove('border-red-500', 'focus:ring-red-200');
    });

    const profileMsg = document.getElementById('profile-msg');
    if (profileMsg) {
        profileMsg.className = 'hidden mb-6 p-4 rounded-xl text-sm font-medium transition-all';
        profileMsg.textContent = '';
    }
}

// Set field error state
function setFieldError(fieldId, errorMsg) {
    const errorEl = document.getElementById(`${fieldId}-error`);
    const inputEl = document.getElementById(fieldId);

    if (errorEl) {
        errorEl.textContent = errorMsg;
        errorEl.classList.remove('hidden');
    }
    if (inputEl) {
        inputEl.classList.add('border-red-500', 'focus:ring-red-200');
    }
}

// Routing for tabs
window.switchAccountTab = function (tabId) {
    // Map tab aliases for backward compatibility
    if (tabId === 'interests') tabId = 'learning-interests';
    if (tabId === 'personal') tabId = 'personal-info';

    const tabs = ['personal-info', 'learning-interests', 'security'];
    if (!tabs.includes(tabId)) {
        tabId = 'personal-info';
    }

    tabs.forEach(tab => {
        const btn = document.getElementById('tab-' + tab);
        if (!btn) return;
        btn.className = "flex items-center gap-3 pl-14 pr-6 py-2.5 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-primary transition-all cursor-pointer";

        if (tab === tabId) {
            btn.className = "flex items-center gap-3 pl-14 pr-6 py-2.5 text-sm font-bold text-primary transition-all cursor-pointer";
        }
    });

    const contentDivs = document.querySelectorAll('main > div[id^="content-"]');
    contentDivs.forEach(div => div.classList.add('hidden'));

    const targetContent = document.getElementById('content-' + tabId);
    if (targetContent) {
        targetContent.classList.remove('hidden');
    } else {
        const fallbackContent = document.getElementById('content-personal-info');
        if (fallbackContent) fallbackContent.classList.remove('hidden');
    }
};

async function loadProfile() {
    toggleSkeletons(true);
    try {
        currentUserSession = await AuthService.getSession();
        if (!currentUserSession) {
            window.location.href = '/src/pages/auth/user-login/index.html';
            return;
        }

        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', currentUserSession.user.id)
            .single();
        
        if (error) {
            console.error("Error fetching profile", error);
            return;
        }

        currentProfile = data;
        await applyProfileToDOM();
    } finally {
        toggleSkeletons(false);
    }
}

async function applyProfileToDOM() {
    if (!currentProfile) return;

    // Updates displays
    const displayNames = document.querySelectorAll('.user-display-name');
    displayNames.forEach(el => el.textContent = currentProfile.full_name || 'Student Name');

    // Forms
    const fullNameInput = document.getElementById('full-name');
    if (fullNameInput) fullNameInput.value = currentProfile.full_name || '';

    const emailInput = document.getElementById('email');
    if (emailInput) emailInput.value = currentUserSession?.user?.email || '';

    const phoneInput = document.getElementById('phone-number');
    if (phoneInput) phoneInput.value = currentProfile.phone_number || '';

    const countryInput = document.getElementById('country');
    if (countryInput) countryInput.value = currentProfile.country || '';

    const cityInput = document.getElementById('city');
    if (cityInput) cityInput.value = currentProfile.city || '';

    const bioInput = document.getElementById('bio');
    if (bioInput) {
        const bioText = (currentProfile.short_bio || '').substring(0, 100);
        bioInput.value = bioText;
        updateBioCharCount(bioText.length);
    }

    const avatar = document.getElementById('avatar-container');
    if (avatar) {
        try {
            const avatarUrl = await resolveProfileAvatar(currentProfile);
            if (avatarUrl) avatar.innerHTML = `<img alt="Profile" src="${avatarUrl}" class="w-full h-full object-cover" />`;
        } catch (avatarError) {
            console.warn('Could not resolve the private profile image.', avatarError);
        }
    }

    // Social Links
    const socialLinks = currentProfile.social_links || {};
    if (document.getElementById('github-url')) document.getElementById('github-url').value = socialLinks.github || '';
    if (document.getElementById('linkedin-url')) document.getElementById('linkedin-url').value = socialLinks.linkedin || '';
    if (document.getElementById('twitter-url')) document.getElementById('twitter-url').value = socialLinks.twitter || '';
    if (document.getElementById('facebook-url')) document.getElementById('facebook-url').value = socialLinks.facebook || '';
    if (document.getElementById('website-url')) document.getElementById('website-url').value = socialLinks.website || '';

    updateLearningInterestsUI(currentProfile.learning_interests || []);
}

function updateBioCharCount(len) {
    const charCountEl = document.getElementById('bio-char-count');
    if (charCountEl) {
        charCountEl.textContent = `${len} / 100`;
        if (len >= 100) {
            charCountEl.className = "text-xs font-bold text-amber-500";
        } else {
            charCountEl.className = "text-xs font-semibold text-slate-400";
        }
    }
}

function updateLearningInterestsUI(selectedInterests) {
    const cards = document.querySelectorAll('.interest-card');
    cards.forEach(card => {
        const interestId = card.getAttribute('data-interest');
        const iconContainer = card.querySelector('.w-14.h-14');
        const icon = card.querySelector('.material-symbols-outlined');

        if (selectedInterests.includes(interestId)) {
            card.className = "interest-card selected border-teal-500 bg-teal-50/50 dark:bg-teal-900/10 p-6 rounded-2xl transition-all duration-200 text-center flex flex-col items-center justify-center gap-3 cursor-pointer";
            if (iconContainer) iconContainer.className = "w-14 h-14 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center";
            if (icon) {
                icon.className = "material-symbols-outlined text-3xl text-teal-600 dark:text-teal-400";
                icon.style.fontVariationSettings = "'FILL' 1";
            }
        } else {
            card.className = "interest-card border-slate-100 dark:border-slate-800 hover:border-teal-300 dark:hover:border-teal-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 border-2 p-6 rounded-2xl transition-all duration-200 text-center flex flex-col items-center justify-center gap-3 cursor-pointer group";
            if (iconContainer) iconContainer.className = "w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center group-hover:bg-teal-50 dark:group-hover:bg-teal-900/20";
            if (icon) {
                icon.className = "material-symbols-outlined text-3xl text-slate-500 dark:text-slate-400 group-hover:text-teal-600 dark:group-hover:text-teal-400";
                icon.style.fontVariationSettings = "";
            }
        }
    });

    const countText = document.getElementById('interests-count');
    if (countText) {
        countText.textContent = `${selectedInterests.length} interest${selectedInterests.length === 1 ? '' : 's'} selected`;
    }
}

window.handleProfileUpload = async function(event) {
    const file = event.target.files[0];
    if (!file) return;

    // File type validation
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
        alert("Please select a valid image file (JPEG, PNG, GIF, WEBP).");
        return;
    }
    // File size validation (5MB max)
    if (file.size > 5 * 1024 * 1024) {
        alert("Profile picture size must be less than 5MB.");
        return;
    }

    try {
        const updatedProfile = await ProfileService.uploadAvatar(file);
        currentProfile = updatedProfile;
        const privateAvatarUrl = await resolveProfileAvatar(updatedProfile);
        const avatar = document.getElementById('avatar-container');
        if (avatar && privateAvatarUrl) {
            avatar.innerHTML = `<img src="${privateAvatarUrl}" class="w-full h-full object-cover" />`;
        }
    } catch (err) {
        alert("Upload failed: " + err.message);
    }
}

window.removeProfileImage = async function() {
    try {
        await ProfileService.removeAvatar();
        if (currentProfile) {
            currentProfile.avatar_url = null;
            currentProfile.avatar_storage_key = null;
        }
        const placeholderHtml = `<span class="material-symbols-outlined text-slate-300 dark:text-slate-600 text-6xl">account_circle</span>`;
        const avatar = document.getElementById('avatar-container');
        if (avatar) avatar.innerHTML = placeholderHtml;
    } catch (err) {
        alert("Remove failed: " + err.message);
    }
}

async function handleLogout() {
    try {
        await AuthService.logout();
        window.location.href = '/src/pages/auth/login-select/index.html';
    } catch (err) {
        console.error("Logout failed:", err);
        alert("Logout failed. Please try again.");
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadProfile();

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }

    // Bio character counter listener
    const bioInput = document.getElementById('bio');
    if (bioInput) {
        bioInput.addEventListener('input', () => {
            let val = bioInput.value;
            if (val.length > 100) {
                val = val.substring(0, 100);
                bioInput.value = val;
            }
            updateBioCharCount(val.length);
        });
    }

    // Phone blur duplicate pre-check
    const phoneInput = document.getElementById('phone-number');
    if (phoneInput) {
        phoneInput.addEventListener('blur', async () => {
            const rawPhone = phoneInput.value.trim();
            if (!rawPhone) return;
            if (containsUrl(rawPhone)) {
                setFieldError('phone-number', 'Phone number must not contain URLs or web links.');
                return;
            }
            const duplicate = await isPhoneDuplicate(rawPhone);
            if (duplicate) {
                setFieldError('phone-number', 'this phone already exist in database');
            } else {
                const phoneErr = document.getElementById('phone-number-error');
                if (phoneErr) phoneErr.classList.add('hidden');
                phoneInput.classList.remove('border-red-500');
            }
        });
        phoneInput.addEventListener('input', () => {
            const phoneErr = document.getElementById('phone-number-error');
            if (phoneErr) phoneErr.classList.add('hidden');
            phoneInput.classList.remove('border-red-500');
        });
    }

    // Form Submit Handler with full security validation
    const profileForm = document.getElementById('profile-form');
    if (profileForm) {
        profileForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearFieldErrors();

            let hasError = false;

            // 1. Full Name Validation & Sanitization
            const rawFullName = document.getElementById('full-name').value;
            const cleanFullName = sanitizeText(rawFullName);
            if (!cleanFullName || cleanFullName.length < 2) {
                setFieldError('full-name', 'Please enter a valid full name (at least 2 characters).');
                hasError = true;
            }

            // 2. Phone Number Validation & Uniqueness Check
            const rawPhone = document.getElementById('phone-number').value.trim();
            const cleanPhone = sanitizeText(rawPhone);
            if (cleanPhone) {
                if (containsUrl(cleanPhone)) {
                    setFieldError('phone-number', 'Phone number must not contain URLs or web links.');
                    hasError = true;
                } else {
                    const duplicate = await isPhoneDuplicate(cleanPhone);
                    if (duplicate) {
                        setFieldError('phone-number', 'this phone already exist in database');
                        hasError = true;
                    }
                }
            }

            // 3. Country & City Sanitization + URL prevention
            const cleanCountry = sanitizeText(document.getElementById('country').value);
            if (cleanCountry && containsUrl(cleanCountry)) {
                setFieldError('country', 'Country field must not contain URLs or web links.');
                hasError = true;
            }
            const cleanCity = sanitizeText(document.getElementById('city').value);
            if (cleanCity && containsUrl(cleanCity)) {
                setFieldError('city', 'City field must not contain URLs or web links.');
                hasError = true;
            }

            // 4. Bio Length, Sanitization + URL prevention
            const rawBio = document.getElementById('bio').value;
            const cleanBio = sanitizeText(rawBio).substring(0, 100);
            if (cleanBio && containsUrl(cleanBio)) {
                setFieldError('bio', 'Bio must not contain URLs or web links.');
                hasError = true;
            }

            // 5. Public Links Validation
            const linksConfig = [
                { id: 'github-url', platform: 'github' },
                { id: 'linkedin-url', platform: 'linkedin' },
                { id: 'twitter-url', platform: 'twitter' },
                { id: 'website-url', platform: 'website' },
                { id: 'facebook-url', platform: 'facebook' }
            ];

            const validatedLinks = {};
            for (const item of linksConfig) {
                const val = document.getElementById(item.id)?.value || '';
                const result = validatePublicUrl(val, item.platform);
                if (!result.valid) {
                    setFieldError(item.id, result.error);
                    hasError = true;
                } else {
                    validatedLinks[item.platform] = result.cleanUrl;
                }
            }

            if (hasError) {
                const profileMsg = document.getElementById('profile-msg');
                if (profileMsg) {
                    profileMsg.textContent = 'Please fix the highlighted errors before saving.';
                    profileMsg.className = 'mb-6 p-4 rounded-xl text-sm font-medium bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400 border border-red-200 dark:border-red-800/40 block';
                }
                return;
            }

            const btn = document.getElementById('submit-profile-btn');
            const ogText = btn.innerHTML;
            btn.innerHTML = `<span class="material-symbols-outlined animate-spin text-sm">progress_activity</span> Saving...`;
            btn.disabled = true;

            try {
                await AuthService.updateProfile({
                    full_name: cleanFullName,
                    phone_number: cleanPhone || null,
                    country: cleanCountry || null,
                    city: cleanCity || null,
                    short_bio: cleanBio || null,
                    social_links: validatedLinks
                });

                currentProfile = {
                    ...currentProfile,
                    full_name: cleanFullName,
                    phone_number: cleanPhone,
                    country: cleanCountry,
                    city: cleanCity,
                    short_bio: cleanBio,
                    social_links: validatedLinks
                };

                const profileMsg = document.getElementById('profile-msg');
                if (profileMsg) {
                    profileMsg.textContent = 'Profile changes saved successfully.';
                    profileMsg.className = 'mb-6 p-4 rounded-xl text-sm font-medium bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400 border border-green-200 dark:border-green-800/40 block';
                }

                btn.innerHTML = `<span class="material-symbols-outlined text-sm">check</span> Saved Successfully`;
            } catch (err) {
                console.error('Profile update error:', err);
                const profileMsg = document.getElementById('profile-msg');
                if (profileMsg) {
                    profileMsg.textContent = err.message || 'Failed to update profile. Please try again.';
                    profileMsg.className = 'mb-6 p-4 rounded-xl text-sm font-medium bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400 border border-red-200 dark:border-red-800/40 block';
                }
                btn.innerHTML = `Save Failed`;
            } finally {
                setTimeout(() => {
                    btn.innerHTML = ogText;
                    btn.disabled = false;
                }, 2500);
            }
        });
    }

    const securityForm = document.getElementById('security-form');
    if (securityForm) {
        securityForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const msgDiv = document.getElementById('security-msg');
            msgDiv.className = 'hidden mb-4 p-3 rounded-lg text-sm font-medium';

            const newPassword = document.getElementById('new-password').value;
            const confirmPassword = document.getElementById('confirm-new-password').value;

            if (newPassword !== confirmPassword) {
                msgDiv.textContent = 'New passwords do not match.';
                msgDiv.classList.add('bg-red-50', 'text-red-600', 'dark:bg-red-500/10', 'dark:text-red-400');
                msgDiv.classList.remove('hidden');
                return;
            }

            const btn = securityForm.querySelector('button[type="submit"]');
            const ogText = btn.innerHTML;
            btn.innerHTML = 'Updating...';
            btn.disabled = true;

            try {
                await AuthService.updatePassword(newPassword);
                msgDiv.textContent = 'Password updated successfully.';
                msgDiv.classList.add('bg-green-50', 'text-green-600', 'dark:bg-green-500/10', 'dark:text-green-400');
                msgDiv.classList.remove('hidden');
                securityForm.reset();
            } catch (err) {
                msgDiv.textContent = err.message;
                msgDiv.classList.add('bg-red-50', 'text-red-600', 'dark:bg-red-500/10', 'dark:text-red-400');
                msgDiv.classList.remove('hidden');
            } finally {
                btn.innerHTML = ogText;
                btn.disabled = false;
            }
        });
    }

    const interestCards = document.querySelectorAll('.interest-card');
    interestCards.forEach(card => {
        card.addEventListener('click', () => {
            const interestId = card.getAttribute('data-interest');
            let interests = currentProfile.learning_interests || [];
            if (interests.includes(interestId)) {
                interests = interests.filter(i => i !== interestId);
            } else {
                interests.push(interestId);
            }
            currentProfile.learning_interests = interests;
            updateLearningInterestsUI(interests);
        });
    });

    const updateInterBtn = document.getElementById('update-interests-btn');
    if (updateInterBtn) {
        updateInterBtn.addEventListener('click', async () => {
            const ogText = updateInterBtn.innerText;
            updateInterBtn.innerText = 'Saving...';
            try {
                await supabase.from('profiles').update({ learning_interests: currentProfile.learning_interests }).eq('id', currentUserSession.user.id);
                updateInterBtn.innerText = 'Saved!';
            } catch (err) {
                updateInterBtn.innerText = 'Error';
            }
            setTimeout(() => updateInterBtn.innerText = ogText, 2000);
        });
    }

    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab');
    if (tabParam) switchAccountTab(tabParam);
    else switchAccountTab('personal-info');
});

