import { supabase } from '/src/services/supabaseClient.js';
import { AuthService } from '/src/services/authService.js';

let currentUserSession = null;
let currentProfile = null;

// Routing for tabs

window.switchAccountTab = function (tabId) {
    const tabs = ['personal-info', 'learning-interests', 'security'];
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
    if (targetContent) targetContent.classList.remove('hidden');
};

async function loadProfile() {
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
    applyProfileToDOM();
}

function applyProfileToDOM() {
    if (!currentProfile) return;

    // Updates displays
    const displayNames = document.querySelectorAll('.user-display-name');
    displayNames.forEach(el => el.textContent = currentProfile.full_name || 'Student Name');

    // Forms
    const fullNameInput = document.getElementById('full-name');
    if (fullNameInput) fullNameInput.value = currentProfile.full_name || '';

    const emailInput = document.getElementById('email');
    if (emailInput) emailInput.value = currentUserSession.user.email || '';

    const phoneInput = document.getElementById('phone-number');
    if (phoneInput) phoneInput.value = currentProfile.phone_number || '';

    const countryInput = document.getElementById('country');
    if (countryInput) countryInput.value = currentProfile.country || '';

    const cityInput = document.getElementById('city');
    if (cityInput) cityInput.value = currentProfile.city || '';

    const bioInput = document.getElementById('bio');
    if (bioInput) bioInput.value = currentProfile.short_bio || '';

    const avatar = document.querySelector('.w-28.h-28');
    if (avatar && currentProfile.avatar_url) {
        avatar.innerHTML = `<img alt="Profile" src="${currentProfile.avatar_url}" class="w-full h-full object-cover" />`;
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

    try {
        const fileExt = file.name.split('.').pop();
        const filePath = `${currentUserSession.user.id}/profile_${Date.now()}.${fileExt}`;
        
        await supabase.storage.from('avatars').upload(filePath, file, { upsert: true });
        const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
        
        await supabase.from('profiles').update({ avatar_url: publicUrlData.publicUrl }).eq('id', currentUserSession.user.id);
        
        const avatar = document.querySelector('.w-28.h-28');
        if (avatar) avatar.innerHTML = `<img src="${publicUrlData.publicUrl}" class="w-full h-full object-cover" />`;
    } catch (err) {
        alert("Upload failed: " + err.message);
    }
}

window.removeProfileImage = async function() {
    try {
        await supabase.from('profiles').update({ avatar_url: null }).eq('id', currentUserSession.user.id);
        const placeholderHtml = `<span class="material-symbols-outlined text-slate-300 dark:text-slate-600 text-6xl">account_circle</span>`;
        const avatar = document.querySelector('.w-28.h-28');
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

    const profileForm = document.getElementById('profile-form');
    if (profileForm) {
        profileForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = profileForm.querySelector('button[type="submit"]');
            const ogText = btn.innerHTML;
            btn.innerHTML = `Saving...`;

            try {
                await AuthService.updateProfile({
                    full_name: document.getElementById('full-name').value,
                    phone_number: document.getElementById('phone-number').value,
                    country: document.getElementById('country').value,
                    city: document.getElementById('city').value,
                    short_bio: document.getElementById('bio').value,
                    social_links: {
                        github: document.getElementById('github-url').value,
                        linkedin: document.getElementById('linkedin-url').value,
                        twitter: document.getElementById('twitter-url').value,
                        facebook: document.getElementById('facebook-url').value,
                        website: document.getElementById('website-url').value
                    }
                });
                btn.innerHTML = `<span class="material-symbols-outlined">check</span> Saved`;
            } catch (err) {
                console.error(err);
                btn.innerHTML = `Error!`;
            }
            setTimeout(() => btn.innerHTML = ogText, 2000);
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
