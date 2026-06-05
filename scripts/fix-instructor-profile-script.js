const fs = require('fs');
const file = 'c:/Users/salmaan/.gemini/antigravity/Tacliimi/src/pages/instructor/instructor-profile/index.html';
let content = fs.readFileSync(file, 'utf8');

// 1. Remove synchronous switchPanel dependencies on `session`
const oldSwitchPanelRegex = /function switchPanel\(panelId, event\) {[\s\S]*?\/\/ Remove active styles from sidebar/g;
const newSwitchPanel = `
        function switchPanel(panelId, event) {
            if (event) event.preventDefault();

            // SETUP MODE ENFORCEMENT
            if (window.currentProfile && window.currentProfile.role === 'instructor' && !window.currentProfile.profile_completed) {
                const targetStep = panelId === 'panel-personal' ? 1 :
                    panelId === 'panel-teaching' ? 2 :
                        panelId === 'panel-payout' ? 3 :
                            panelId === 'panel-security' ? 4 : 1;
                const maxStep = window.currentProfile.setup_progress || 1;

                if (targetStep > maxStep) {
                    // Temporarily highlight the save button to hint at the requirement
                    const saveBtn = document.querySelector('button:has(.material-symbols-outlined:contains("save")), button#save-profile-btn');
                    if (saveBtn) {
                        saveBtn.classList.add('ring-4', 'ring-red-500/50', 'animate-pulse');
                        setTimeout(() => saveBtn.classList.remove('ring-4', 'ring-red-500/50', 'animate-pulse'), 1000);
                    }
                    return; // BLOCKED
                }
            }

            // Hide all panels
            document.querySelectorAll('.profile-panel').forEach(el => {
                el.classList.remove('block');
                el.classList.add('hidden');
            });

            // Remove active styles from sidebar
`;
content = content.replace(oldSwitchPanelRegex, newSwitchPanel.trim());

// 2. Replace the Custom Setup Validation & Progression Logic
const oldLogicRegex = /<script>\s*\/\/\s*Custom Setup Validation & Progression Logic[\s\S]*?<\/script>\s*<\/body>/g;
const newLogic = `
    <script type="module">
        import { AuthService } from '/src/services/authService.js';
        
        window.currentProfile = null;

        document.addEventListener('DOMContentLoaded', async () => {
            const saveBtn = document.getElementById('save-profile-btn');
            const discardBtn = document.querySelector('button:contains("Discard changes"), button.text-slate-500.hover\\:text-slate-700');
            if (!discardBtn && document.querySelector('button.text-slate-500')) {
                // Find it by class if text matches failed
                 document.querySelectorAll('button').forEach(b => {
                     if (b.innerText.includes('Discard changes')) {
                         b.id = 'discard-profile-btn';
                     }
                 });
            }
            const discardBtnEl = document.getElementById('discard-profile-btn') || document.querySelector('button:has(.text-slate-500)');

            // Function to populate form
            const populateForm = (profile) => {
                if (!profile) return;
                
                // Personal
                if (profile.full_name) document.getElementById('fullName').value = profile.full_name;
                if (profile.professional_title) document.getElementById('professionalTitle').value = profile.professional_title;
                if (profile.short_bio) document.getElementById('shortBio').value = profile.short_bio;
                
                // Socials
                const socials = profile.social_links || {};
                if (socials.linkedin) document.getElementById('linkedinUrl').value = socials.linkedin;
                if (socials.twitter) document.getElementById('twitterUrl').value = socials.twitter;
                if (socials.facebook) document.getElementById('facebookUrl').value = socials.facebook;

                // Teaching
                if (profile.teaching_experience) document.getElementById('experience').value = profile.teaching_experience;
                
                // Payout
                if (profile.payout_method) {
                    const method = profile.payout_method;
                    const details = profile.payout_details || {};
                    const methodMap = { 'Mobile Money': 'mm', 'Cash on Delivery': 'cod', 'Bank Transfer': 'bank' };
                    const value = methodMap[method] || method;
                    
                    document.getElementById('selectedPayoutMethod').value = value;
                    if (value === 'mm') {
                        document.getElementById('btn-mm').click();
                        if (details.provider) document.getElementById('mm-provider').value = details.provider;
                        if (details.phone) document.getElementById('mm-phone').value = details.phone;
                    } else if (value === 'cod') {
                        document.getElementById('btn-cod').click();
                        if (details.address) document.getElementById('cod-address').value = details.address;
                        if (details.city) document.getElementById('cod-city').value = details.city;
                        if (details.phone) document.getElementById('cod-phone').value = details.phone;
                    }
                }
                
                // Avatar is handled globally, but we update the image node if possible
                if (profile.avatar_url) {
                     const mainProfileNode = document.querySelector('.size-24');
                     if (mainProfileNode) {
                         mainProfileNode.innerHTML = \`<img src="\${profile.avatar_url}" class="w-full h-full object-cover rounded-full" />\`;
                         mainProfileNode.classList.add('overflow-hidden');
                     }
                }
            };

            // Load profile on start
            try {
                const profile = await AuthService.getCurrentProfile();
                window.currentProfile = profile;
                populateForm(profile);
            } catch (e) {
                console.error("Failed to load profile:", e);
            }

            if (document.getElementById('discard-profile-btn')) {
                document.getElementById('discard-profile-btn').addEventListener('click', () => {
                   populateForm(window.currentProfile); 
                });
            } else if (discardBtnEl) {
                discardBtnEl.addEventListener('click', () => populateForm(window.currentProfile));
            }

            saveBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                const profile = window.currentProfile;
                const isSetupMode = profile && profile.role === 'instructor' && !profile.profile_completed;

                const activeTab = document.querySelector('.profile-panel.block');
                const activeTabId = activeTab ? activeTab.id : null;

                let tabValid = true;
                let updates = {};

                if (activeTabId === 'panel-personal') {
                    const fullNameInput = document.getElementById('fullName');
                    const titleInput = document.getElementById('professionalTitle');
                    const bioInput = document.getElementById('shortBio');

                    const fullName = fullNameInput.value.trim();
                    const title = titleInput.value.trim();
                    const bio = bioInput.value.trim();

                    [fullNameInput, titleInput, bioInput].forEach(el => el.classList.remove('border-red-500', 'ring-1', 'ring-red-500'));

                    // For instructor setup, they need an avatar, but profile logic gets complex. We check for full name, title, bio as required
                    if (!fullName || !title || !bio) {
                        if (!fullName) fullNameInput.classList.add('border-red-500', 'ring-1', 'ring-red-500');
                        if (!title) titleInput.classList.add('border-red-500', 'ring-1', 'ring-red-500');
                        if (!bio) bioInput.classList.add('border-red-500', 'ring-1', 'ring-red-500');
                        tabValid = false;
                    } else {
                        const linkedinUrl = document.getElementById('linkedinUrl')?.value.trim();
                        const twitterUrl = document.getElementById('twitterUrl')?.value.trim();
                        const facebookUrl = document.getElementById('facebookUrl')?.value.trim();
                        
                        updates = {
                            full_name: fullName,
                            professional_title: title,
                            short_bio: bio,
                            social_links: { linkedin: linkedinUrl, twitter: twitterUrl, facebook: facebookUrl }
                        };
                    }
                } else if (activeTabId === 'panel-teaching') {
                    const expertiseContainer = document.getElementById('expertise-container');
                    const expertiseInputWrapper = expertiseContainer.parentElement;
                    expertiseInputWrapper.classList.remove('border-red-500', 'ring-1', 'ring-red-500');

                    const expertiseTags = expertiseContainer.querySelectorAll('span');
                    if (expertiseTags.length === 0) {
                        expertiseInputWrapper.classList.add('border-red-500', 'ring-1', 'ring-red-500', 'p-2', 'rounded-lg');
                        tabValid = false;
                    } else {
                        const experience = document.getElementById('experience').value;
                        const expertiseList = Array.from(expertiseTags).map(span => span.innerText.replace('close', '').trim());

                        const educationList = [];
                        document.querySelectorAll('.education-item').forEach(item => {
                            const uni = item.querySelector('input[id^="university"]')?.value.trim();
                            const deg = item.querySelector('input[id^="degree"]')?.value.trim();
                            if (uni && deg) educationList.push({ university: uni, degree: deg });
                        });

                        const languageTags = document.querySelectorAll('#languages-container span.rounded-lg:not(.material-symbols-outlined)');
                        const languageList = Array.from(languageTags).map(span => span.innerText.replace('close', '').trim());

                        updates = {
                            teaching_experience: experience,
                            expertise_list: expertiseList,
                            education_list: educationList,
                            language_list: languageList
                        };
                    }
                } else if (activeTabId === 'panel-payout') {
                    const selectedMethod = document.getElementById('selectedPayoutMethod').value;
                    const mmProviderInput = document.getElementById('mm-provider');
                    const mmPhoneInput = document.getElementById('mm-phone');
                    const codAddressInput = document.getElementById('cod-address');
                    const codCityInput = document.getElementById('cod-city');
                    const codPhoneInput = document.getElementById('cod-phone');

                    [mmProviderInput, mmPhoneInput, codAddressInput, codCityInput, codPhoneInput].forEach(el => {
                        if (el) el.classList.remove('border-red-500', 'ring-1', 'ring-red-500');
                    });

                    if (!selectedMethod || selectedMethod === 'bank') {
                        document.querySelectorAll('.payout-method-btn').forEach(btn => {
                            btn.classList.add('border-red-500');
                            setTimeout(() => btn.classList.remove('border-red-500'), 1000);
                        });
                        tabValid = false;
                    } else if (selectedMethod === 'mm') {
                        const mmProvider = mmProviderInput.value;
                        const mmPhone = mmPhoneInput.value.trim();
                        if (!mmProvider || !mmPhone) {
                            if (!mmProvider) mmProviderInput.classList.add('border-red-500', 'ring-1', 'ring-red-500');
                            if (!mmPhone) mmPhoneInput.classList.add('border-red-500', 'ring-1', 'ring-red-500');
                            tabValid = false;
                        } else {
                            updates = { payout_method: 'Mobile Money', payout_details: { provider: mmProvider, phone: mmPhone } };
                        }
                    } else if (selectedMethod === 'cod') {
                        const address = codAddressInput.value.trim();
                        const city = codCityInput.value.trim();
                        const phone = codPhoneInput.value.trim();
                        if (!address || !city || !phone) {
                            if (!address) codAddressInput.classList.add('border-red-500', 'ring-1', 'ring-red-500');
                            if (!city) codCityInput.classList.add('border-red-500', 'ring-1', 'ring-red-500');
                            if (!phone) codPhoneInput.classList.add('border-red-500', 'ring-1', 'ring-red-500');
                            tabValid = false;
                        } else {
                            updates = { payout_method: 'Cash on Delivery', payout_details: { address, city, phone } };
                        }
                    }
                } else if (activeTabId === 'panel-security') {
                    const tosCheckbox = document.getElementById('tos-checkbox');
                    tosCheckbox.classList.remove('ring-2', 'ring-red-500', 'border-red-500');

                    if (!tosCheckbox.checked) {
                        tosCheckbox.classList.add('ring-2', 'ring-red-500', 'border-red-500');
                        tabValid = false;
                    }
                }

                if (!tabValid) return; // Stop if validation fails

                // Progress logic
                if (isSetupMode) {
                    let currentProgress = profile.setup_progress || 1;
                    let nextTabId = null;

                    if (activeTabId === 'panel-personal' && currentProgress === 1) {
                        currentProgress = 2;
                        nextTabId = 'panel-teaching';
                    } else if (activeTabId === 'panel-teaching' && currentProgress === 2) {
                        currentProgress = 3;
                        nextTabId = 'panel-payout';
                    } else if (activeTabId === 'panel-payout' && currentProgress === 3) {
                        currentProgress = 4;
                        nextTabId = 'panel-security';
                    } else if (activeTabId === 'panel-security' && currentProgress === 4) {
                        updates.profile_completed = true;
                        updates.setup_progress = 5;
                    }
                    if (!updates.setup_progress && currentProgress) {
                        updates.setup_progress = currentProgress;
                    }

                    // Save to Supabase
                    try {
                        const origText = saveBtn.innerHTML;
                        saveBtn.innerHTML = \`<span class="material-symbols-outlined text-[18px] animate-spin">refresh</span> Saving\`;
                        saveBtn.disabled = true;

                        const updatedProfile = await AuthService.updateProfile(updates);
                        window.currentProfile = updatedProfile;

                        saveBtn.innerHTML = \`<span class="material-symbols-outlined text-[18px]">check</span> Saved\`;
                        setTimeout(() => { 
                            saveBtn.innerHTML = origText; 
                            saveBtn.disabled = false;
                        }, 2000);

                        if (updates.profile_completed) {
                            alert('Congratulations! Your Instructor Profile Setup is complete.');
                            window.location.href = '../instructor-dashboard/index.html';
                            return;
                        }

                        if (nextTabId) {
                            const links = document.querySelectorAll('aside nav a');
                            links.forEach(link => {
                                if (link.getAttribute('onclick') && link.getAttribute('onclick').includes(nextTabId)) {
                                    link.click();
                                }
                            });
                        }
                    } catch (e) {
                         alert("Error saving profile: " + e.message);
                         saveBtn.disabled = false;
                    }
                } else {
                    // Normal save logic
                    try {
                        const origText = saveBtn.innerHTML;
                        saveBtn.innerHTML = \`<span class="material-symbols-outlined text-[18px] animate-spin">refresh</span> Saving\`;
                        saveBtn.disabled = true;
                        
                        const updatedProfile = await AuthService.updateProfile(updates);
                        window.currentProfile = updatedProfile;

                        if (typeof TacliimiDB !== 'undefined' && TacliimiDB.applyGlobalProfile) {
                             TacliimiDB.applyGlobalProfile();
                        }

                        saveBtn.innerHTML = \`<span class="material-symbols-outlined text-[18px]">check</span> Saved\`;
                        setTimeout(() => { 
                            saveBtn.innerHTML = origText; 
                            saveBtn.disabled = false;
                        }, 2000);
                    } catch(e) {
                         alert("Error saving profile: " + e.message);
                         saveBtn.disabled = false;
                    }
                }
            });

            // Payout Method Selector Logic
            const payoutBtns = document.querySelectorAll('.payout-method-btn');
            const payoutFormsContainer = document.getElementById('payout-forms');
            const payoutForms = document.querySelectorAll('.payout-form');
            const selectedPayoutMethod = document.getElementById('selectedPayoutMethod');

            payoutBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    payoutBtns.forEach(b => {
                        b.classList.remove('border-primary', 'bg-primary/5');
                        b.classList.add('border-slate-200', 'bg-white', 'dark:border-slate-800', 'dark:bg-background-dark');
                    });
                    btn.classList.add('border-primary', 'bg-primary/5');
                    btn.classList.remove('border-slate-200', 'bg-white', 'dark:border-slate-800', 'dark:bg-background-dark');
                    payoutForms.forEach(form => form.classList.add('hidden'));
                    payoutFormsContainer.classList.remove('hidden');

                    if (btn.id === 'btn-bank') {
                        document.getElementById('form-bank-transfer').classList.remove('hidden');
                        selectedPayoutMethod.value = 'bank';
                    } else if (btn.id === 'btn-mm') {
                        document.getElementById('form-mobile-money').classList.remove('hidden');
                        selectedPayoutMethod.value = 'mm';
                    } else if (btn.id === 'btn-cod') {
                        document.getElementById('form-cod').classList.remove('hidden');
                        selectedPayoutMethod.value = 'cod';
                    }
                });
            });
        });
    </script>
</body>
`;
content = content.replace(oldLogicRegex, newLogic);

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed auth and validation script');
