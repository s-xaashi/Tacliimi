import { MentorService } from '../../../services/mentorService.js';
import { supabase } from '../../../services/supabaseClient.js';
import { AuthService } from '../../../services/authService.js';
import { buildProgramProgressHtml, buildMonthlyBadgeHtml, getProgramMeetingStatus, openMentorshipRescheduleModal } from '../../../utils/js/mentorshipUI.js';

// XSS safety helper
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}


window.triggerMentorReschedule = function(sessionId, currentScheduledAt, currentDurationStr, studentNameStr, historyJson) {
    let history = [];
    try { history = historyJson ? JSON.parse(historyJson) : []; } catch(e) { history = []; }
    openMentorshipRescheduleModal(
        sessionId, currentScheduledAt, currentDurationStr, studentNameStr, 'mentor',
        async (id, newDateObj, newDur, note) => {
            await MentorService.rescheduleSession(id, newDateObj.toISOString(), newDur, note);
            window.showToast("Meeting rescheduled successfully.", "success");
            if(window.loadMentors) window.loadMentors(true);
        },
        history
    );
};

// ── Topic Modal ───────────────────────────────────────────────
window.openTopicModal = function(studentName, topic) {
    const modal = document.getElementById('topic-modal');
    const nameEl = document.getElementById('topic-modal-name');
    const contentEl = document.getElementById('topic-modal-content');
    if (!modal) return;
    if (nameEl) nameEl.textContent = studentName || 'Student';
    if (contentEl) contentEl.textContent = topic || 'No topic provided';
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
};

window.closeTopicModal = function() {
    const modal = document.getElementById('topic-modal');
    if (modal) modal.classList.add('hidden');
    document.body.style.overflow = '';
};

// ── Student Profile Modal ───────────────────────────────────────
window.openStudentProfile = function(studentJson) {
    const student = typeof studentJson === 'string' ? JSON.parse(studentJson) : studentJson;
    const modal = document.getElementById('student-profile-modal');
    if (!modal) return;

    document.getElementById('student-modal-avatar').src = student.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(student.full_name || 'S')}&background=random&color=fff`;
    document.getElementById('student-modal-name').textContent = student.full_name || 'Unknown Student';
    document.getElementById('student-modal-title').textContent = student.professional_title || 'Student';
    document.getElementById('student-modal-email').textContent = student.email || 'No email shared';
    document.getElementById('student-modal-phone').textContent = student.phone_number || 'Not provided';
    document.getElementById('student-modal-location').textContent = (student.city && student.country) ? `${student.city}, ${student.country}` : (student.country || student.city || 'Not provided');
    document.getElementById('student-modal-bio').textContent = student.short_bio ? `"${student.short_bio}"` : '"No bio shared yet."';

    // Social Links Handling
    const socialSection = document.getElementById('student-social-section');
    const socialLinksContainer = document.getElementById('student-social-links');
    
    if (socialSection && socialLinksContainer) {
        const links = student.social_links;
        socialLinksContainer.innerHTML = '';
        
        const isDark = document.documentElement.classList.contains('dark');
        const iconColor = isDark ? 'ffffff' : '475569'; // White in dark, slate-600 in light

        const html = window.renderSocialIconsHtml ? window.renderSocialIconsHtml(links, iconColor) : '';

        if (html) {
            socialLinksContainer.innerHTML = html;
            socialSection.classList.remove('hidden');
        } else {
            socialSection.classList.add('hidden');
        }
    }

    const interestsContainer = document.getElementById('student-interests-list');
    if (interestsContainer) {
        const interests = student.learning_interests || [];
        if (Array.isArray(interests) && interests.length > 0) {
            interestsContainer.innerHTML = interests.map(interest => 
                `<span class="px-3 py-1 bg-primary/5 text-primary rounded-lg text-xs font-bold">${interest}</span>`
            ).join('');
        } else {
            interestsContainer.innerHTML = '<span class="text-slate-400 text-xs italic">No interests listed</span>';
        }
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.style.overflow = 'hidden';
};

window.closeStudentModal = function() {
    const modal = document.getElementById('student-profile-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    document.body.style.overflow = '';
};

// Close on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        window.closeTopicModal();
        window.closeStudentModal();
    }
});

async function initMentorship() {
    // 1) Grab all the tabs and the dynamic container
    const tabs = document.querySelectorAll('.mentorship-tab');
    const container = document.getElementById('mentorship-dynamic-content');
    const tabBar = document.getElementById('mentorship-tab-bar');

    if (!tabs || tabs.length === 0 || !container) return; // Not on mentorship view

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Check if user already has a mentorship profile
    const { data: mentoProfile } = await supabase
        .from('mentorship_profiles')
        .select('*')
        .eq('instructor_id', user.id)
        .single();

    // Default tab: Show setup if profile is missing OR if it hasn't been "applied" yet (missing key application fields)
    const isIncomplete = !mentoProfile || !mentoProfile.mentorship_email || !mentoProfile.mentorship_phone;
    
    // Check for hash-based routing (e.g. #requests)
    const hash = window.location.hash.replace('#', '');
    const validTabs = ['upcoming', 'requests', 'completed', 'availability', 'pricing', 'setup', 'privacy'];
    
    let currentTab = isIncomplete ? 'setup' : 'upcoming';
    if (hash && validTabs.includes(hash)) {
        if (isIncomplete && hash !== 'setup') {
            // Stay on setup if incomplete
        } else {
            currentTab = hash;
        }
    }
    // 2) Function to fetch and render the HTML view
    const loadMentorshipView = async (tabName) => {
        try {
            // Visual feedback
            if (container) {
                container.style.opacity = '0.5';
                container.style.pointerEvents = 'none';
            }

            // Keep the tab bar visible

            const res = await fetch(`/src/pages/instructor/instructor-mentorship/views/${tabName}.html`);
            if (!res.ok) throw new Error(`Failed to load view: ${tabName}`);

            const htmlText = await res.text();
            if (container) {
                container.innerHTML = htmlText;

                // Bind logic based on tab
                if (tabName === 'availability') {
                    bindAvailabilityInteractions(container, user.id);
                } else if (tabName === 'pricing') {
                    bindPricingInteractions(container, user.id);
                } else if (tabName === 'setup') {
                    bindSetupInteractions(container, user.id);
                } else if (tabName === 'privacy') {
                    bindPrivacyInteractions(container, user.id);
                } else if (tabName === 'upcoming') {
                    // Refresh stats in cards if on upcoming
                    refreshDashboardStats(user.id);
                    bindUpcomingInteractions(container, user.id);
                } else if (tabName === 'requests') {
                    bindRequestsInteractions(container, user.id);
                } else if (tabName === 'completed') {
                    bindCompletedInteractions(container, user.id);
                }
            }

        } catch (error) {
            console.error(error);
            if (container) {
                container.innerHTML = `<div class="p-8 text-center text-red-500 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30">
                    <p class="font-bold">Error loading content.</p>
                    <p class="text-sm mt-1">Could not load the <strong>${tabName}</strong> tab.</p>
                 </div>`;
            }
        } finally {
            if (container) {
                container.style.opacity = '1';
                container.style.pointerEvents = 'auto';
            }
        }
    };

    const bindSetupInteractions = (container, userId) => {
        const startApplicationBtn = container.querySelector('#start-mentorship-application-btn');
        if (!startApplicationBtn) return;

        startApplicationBtn.addEventListener('click', async (e) => {
            // Check validation
            const formInputs = container.querySelectorAll('input:not([type="hidden"]), select');
            let isValid = true;
            const applicationData = {
                fullName: container.querySelector('#full-name').value,
                email: container.querySelector('#email').value,
                phone: container.querySelector('#phone').value,
                country: container.querySelector('#country').value,
                city: container.querySelector('#city').value,
                gender: container.querySelector('#gender').value
            };

            formInputs.forEach(input => {
                if (!input.value || input.value === 'Select Gender' || input.value.trim() === '') {
                    isValid = false;
                    input.classList.remove('border-slate-200', 'dark:border-slate-700', 'focus:border-brand-purple', 'focus:ring-brand-purple');
                    input.classList.add('!border-red-500', '!ring-red-500', 'ring-1');
                } else {
                    input.classList.remove('!border-red-500', '!ring-red-500', 'ring-1');
                    input.classList.add('border-slate-200', 'dark:border-slate-700', 'focus:border-brand-purple', 'focus:ring-brand-purple');
                }
            });

            if (!isValid) return;

            try {
                startApplicationBtn.disabled = true;
                startApplicationBtn.innerHTML = '<span class="material-symbols-outlined animate-spin">sync</span> Saving...';

                await MentorService.applyForMentorship(userId, applicationData);

                // 1. Hide the setup tab entirely
                const setupTabBtn = document.querySelector('.mentorship-tab[data-tab="setup"]');
                if (setupTabBtn) setupTabBtn.classList.add('hidden');

                // 2. Unlock all other tabs
                tabs.forEach(btn => {
                    if (btn.getAttribute('data-tab') !== 'setup') {
                        btn.removeAttribute('disabled');
                        btn.classList.remove('cursor-not-allowed');
                        const lockIcon = btn.querySelector('.material-symbols-outlined');
                        if (lockIcon && lockIcon.textContent === 'lock') lockIcon.remove();
                    }
                });

                // Unlock dashboard cards
                document.querySelectorAll('.locked-card').forEach(card => {
                    card.classList.remove('locked-card', 'opacity-60', 'grayscale-[0.5]');
                    const lockBadge = card.querySelector('.lock-badge');
                    if (lockBadge) lockBadge.remove();
                });

                // 4. Load the upcoming view
                currentTab = 'upcoming';
                const upcomingTabBtn = document.querySelector('.mentorship-tab[data-tab="upcoming"]');
                if (upcomingTabBtn) updateActiveTabStyles(upcomingTabBtn);
                loadMentorshipView('upcoming');

            } catch (err) {
                console.error("Application failed:", err);
                window.showToast("Failed to start application. Please try again.", "error");
                startApplicationBtn.disabled = false;
                startApplicationBtn.innerHTML = '<span>Start Application</span><span class="material-symbols-outlined group-hover:translate-x-1 transition-transform">arrow_forward</span>';
            }
        });
    };

    const updateActiveTabStyles = (selectedTabBtn) => {
        tabs.forEach(btn => {
            btn.classList.remove('border-brand-purple', 'text-brand-purple');
            btn.classList.add('border-transparent', 'text-slate-500', 'dark:text-slate-400', 'flex', 'items-center', 'gap-2');
        });
        selectedTabBtn.classList.remove('border-transparent', 'text-slate-500', 'dark:text-slate-400');
        selectedTabBtn.classList.add('border-brand-purple', 'text-brand-purple', 'flex', 'items-center', 'gap-2');
    };

    tabs.forEach(tabBtn => {
        tabBtn.addEventListener('click', () => {
            const target = tabBtn.getAttribute('data-tab');
            if (target && target !== currentTab && !tabBtn.hasAttribute('disabled')) {
                currentTab = target;
                updateActiveTabStyles(tabBtn);
                loadMentorshipView(target);
            }
        });
    });

    // Handle initial state: if already a mentor, unlock tabs and go to upcoming
    if (!isIncomplete) {
        tabs.forEach(btn => {
            if (btn.getAttribute('data-tab') !== 'setup') {
                btn.removeAttribute('disabled');
                btn.classList.remove('cursor-not-allowed');
                const lockIcon = btn.querySelector('.material-symbols-outlined');
                if (lockIcon && lockIcon.textContent === 'lock') lockIcon.remove();
            } else {
                btn.classList.add('hidden');
            }
        });
        document.querySelectorAll('.locked-card').forEach(card => {
            card.classList.remove('locked-card', 'opacity-60', 'grayscale-[0.5]');
            const lockBadge = card.querySelector('.lock-badge');
            if (lockBadge) lockBadge.remove();
        });
        const upcomingTabBtn = document.querySelector('.mentorship-tab[data-tab="upcoming"]');
        if (upcomingTabBtn) updateActiveTabStyles(upcomingTabBtn);
    }

    loadMentorshipView(currentTab);
}

document.addEventListener('DOMContentLoaded', initMentorship);
document.addEventListener('instructor-page-loaded', (e) => {
    if (e.detail && e.detail.path && e.detail.path.includes('mentorship')) initMentorship();
});

// Handle hash changes for tab switching (e.g. from notification clicks)
window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '');
    const tabBtn = document.querySelector(`.mentorship-tab[data-tab="${hash}"]`);
    if (tabBtn && !tabBtn.hasAttribute('disabled')) {
        tabBtn.click();
    }
});

const dayMap = { 'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6 };

async function bindAvailabilityInteractions(container, userId) {
    const dayRows = container.querySelectorAll('.day-row');
    const saveBtn = document.getElementById('save-availability-btn');

    // Load existing availability
    const { slots, meetingTypes } = await MentorService.getAvailability(userId);

    // Set meeting type checkboxes
    const onlineCheckbox = document.getElementById('online-meeting-checkbox');
    const inPersonCheckbox = document.getElementById('in-person-meeting-checkbox');
    if (onlineCheckbox) onlineCheckbox.checked = meetingTypes?.online ?? true;
    if (inPersonCheckbox) inPersonCheckbox.checked = meetingTypes?.in_person ?? false;

    dayRows.forEach(row => {
        const dayName = row.getAttribute('data-day');
        const dayVal = dayMap[dayName];
        const slotsContainer = row.querySelector('.slots-container');
        const toggleBtn = row.querySelector('.day-toggle');
        const addSlotBtn = row.querySelector('.add-slot-btn');

        // Clear default hardcoded slots if any
        const hardcodedSlots = slotsContainer.querySelectorAll('.slot-row');
        hardcodedSlots.forEach(s => s.remove());

        // Populate with existing data if available
        const mySlots = (slots || []).filter(s => s.day_of_week === dayVal);
        if (mySlots.length > 0) {
            mySlots.forEach(slot => addSlotToUI(slotsContainer, slot.start_time, slot.end_time));
            toggleBtn.checked = true;
            row.dispatchEvent(new Event('change', { bubbles: true })); // Trigger visual state
        } else {
            toggleBtn.checked = false;
            // Trigger visual state manually since native events don't bubble perfectly via JS assignment
            toggleDayVisual(row, false);
        }

        // Add Slot Logic
        addSlotBtn.addEventListener('click', () => addSlotToUI(slotsContainer));

        // Delete Slot Logic via Delegation
        slotsContainer.addEventListener('click', (e) => {
            if (e.target.closest('.delete-slot-btn')) e.target.closest('.slot-row').remove();
        });

        // Day Toggle Logic
        toggleBtn.addEventListener('change', (e) => toggleDayVisual(row, e.target.checked));
    });

    // Save Availability
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const originalBtnText = saveBtn.innerHTML;
            const slots = [];
            dayRows.forEach(row => {
                const dayName = row.getAttribute('data-day');
                const isEnabled = row.querySelector('.day-toggle').checked;
                if (!isEnabled) return;

                const slotRows = row.querySelectorAll('.slot-row');
                slotRows.forEach(sRow => {
                    const times = sRow.querySelectorAll('.time-input');
                    slots.push({
                        dayOfWeek: dayMap[dayName],
                        startTime: times[0].value,
                        endTime: times[1].value,
                        isEnabled: true
                    });
                });
            });

            try {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '<span class="animate-spin mr-2">⌛</span> Saving...';
                
                // Collect meeting types
                const onlineCheckbox = document.getElementById('online-meeting-checkbox');
                const inPersonCheckbox = document.getElementById('in-person-meeting-checkbox');
                const meetingTypes = {
                    online: onlineCheckbox?.checked ?? true,
                    in_person: inPersonCheckbox?.checked ?? false
                };

                await MentorService.saveAvailability(userId, { slots, meetingTypes });
                window.showToast("Availability and meeting types updated successfully!", "success");
            } catch (err) {
                console.error(err);
                window.showToast("Failed to save changes. Please try again.", "error");
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerHTML = originalBtnText;
            }
        });
    }
}

function addSlotToUI(container, start = "09:00", end = "17:00") {
    const addBtn = container.querySelector('.add-slot-btn');
    const newSlot = document.createElement('div');
    newSlot.className = 'slot-row flex items-center gap-3 mt-3';
    newSlot.innerHTML = `
        <div class="flex items-center bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 focus-within:ring-2 focus-within:ring-brand-purple/20 focus-within:border-brand-purple transition-all time-input-wrapper">
            <input class="time-input bg-transparent border-none p-0 text-sm font-semibold text-slate-700 dark:text-slate-200 focus:ring-0 w-24" type="time" value="${start.substring(0, 5)}"/>
            <span class="mx-2 text-slate-400 text-xs">to</span>
            <input class="time-input bg-transparent border-none p-0 text-sm font-semibold text-slate-700 dark:text-slate-200 focus:ring-0 w-24" type="time" value="${end.substring(0, 5)}"/>
        </div>
        <button class="delete-slot-btn p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition-all">
            <span class="material-symbols-outlined text-[20px]">delete</span>
        </button>
    `;
    container.insertBefore(newSlot, addBtn);
}

function toggleDayVisual(row, isChecked) {
    const toggleLabel = row.querySelector('.toggle-label');
    const dayIcon = row.querySelector('.day-icon');
    const dayIconTexts = row.querySelectorAll('.day-icon-text');
    const addSlotBtn = row.querySelector('.add-slot-btn');
    const slotsContainer = row.querySelector('.slots-container');

    if (isChecked) {
        row.classList.remove('opacity-60', 'bg-slate-50', 'dark:bg-slate-800/50');
        row.classList.add('bg-white', 'dark:bg-slate-900');
        if (dayIcon) {
            dayIcon.classList.remove('bg-slate-200', 'dark:bg-slate-800');
            dayIcon.classList.add('bg-brand-purple/10');
        }
        dayIconTexts.forEach(txt => {
            txt.classList.remove('text-slate-500');
            txt.classList.add('text-brand-purple');
        });
        if (toggleLabel) {
            toggleLabel.textContent = 'ON';
            toggleLabel.classList.remove('text-slate-500');
            toggleLabel.classList.add('text-green-500');
        }
        if (addSlotBtn) addSlotBtn.classList.remove('hidden');
        const unavailText = row.querySelector('.unavailable-text');
        if (unavailText) unavailText.classList.add('hidden');
        row.querySelectorAll('.slot-row').forEach(sr => sr.classList.remove('hidden'));
    } else {
        row.classList.add('opacity-60', 'bg-slate-50', 'dark:bg-slate-800/50');
        row.classList.remove('bg-white', 'dark:bg-slate-900');
        if (dayIcon) {
            dayIcon.classList.add('bg-slate-200', 'dark:bg-slate-800');
            dayIcon.classList.remove('bg-brand-purple/10');
        }
        dayIconTexts.forEach(txt => {
            txt.classList.add('text-slate-500');
            txt.classList.remove('text-brand-purple');
        });
        if (toggleLabel) {
            toggleLabel.textContent = 'OFF';
            toggleLabel.classList.add('text-slate-500');
            toggleLabel.classList.remove('text-green-500');
        }
        if (addSlotBtn) addSlotBtn.classList.add('hidden');
        let unavailText = row.querySelector('.unavailable-text');
        if (!unavailText && slotsContainer) {
            unavailText = document.createElement('p');
            unavailText.className = 'text-sm font-semibold text-slate-500 dark:text-slate-400 mt-2 unavailable-text';
            unavailText.textContent = 'Unavailable';
            slotsContainer.insertBefore(unavailText, addSlotBtn);
        }
        if (unavailText) unavailText.classList.remove('hidden');
        row.querySelectorAll('.slot-row').forEach(sr => sr.classList.add('hidden'));
    }
}

async function bindPricingInteractions(container, userId) {
    const saveBtn = document.getElementById('save-pricing-btn');
    const rateInput = document.getElementById('hourly-rate-input');
    const monthlyInput = document.getElementById('monthly-rate-input');

    // Load current rates
    const { data } = await supabase.from('mentorship_profiles').select('hourly_rate, monthly_rate').eq('instructor_id', userId).single();
    if (data) {
        if (rateInput) rateInput.value = (data.hourly_rate || 0).toFixed(2);
        if (monthlyInput) monthlyInput.value = (data.monthly_rate || (data.hourly_rate * 20)).toFixed(2);
    }

    if (saveBtn && rateInput) {
        saveBtn.addEventListener('click', async () => {
            const originalBtnText = saveBtn.innerHTML;
            const hourlyRate = parseFloat(rateInput.value);
            const monthlyRate = parseFloat(monthlyInput.value);
            const currencyInput = document.getElementById('currency-input');
            const currency = currencyInput?.value || 'USD';

            if (isNaN(hourlyRate) || hourlyRate < 0) return window.showToast("Please enter a valid hourly price.", "error");
            if (isNaN(monthlyRate) || monthlyRate < 0) return window.showToast("Please enter a valid monthly price.", "error");

            try {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '<span class="animate-spin mr-2">⌛</span> Saving...';

                await MentorService.updatePricing(userId, hourlyRate, monthlyRate, currency);

                window.showToast("Mentorship pricing updated successfully!", "success");
            } catch (err) {
                console.error(err);
                window.showToast("Failed to save pricing changes.", "error");
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerHTML = originalBtnText;
            }
        });
    }

    // --- Coupon Management ---
    const couponsList = document.getElementById('coupons-list');
    const addCouponBtn = document.getElementById('add-coupon-btn');
    const couponCodeInput = document.getElementById('coupon-code-input');
    const couponDiscountInput = document.getElementById('coupon-discount-input');
    const couponExpiryInput = document.getElementById('coupon-expiry-input');


    const renderCoupons = async () => {
        try {
            const coupons = await MentorService.getCoupons(userId);
            if (coupons.length === 0) {
                couponsList.innerHTML = `
                    <div class="text-center py-8 text-slate-400 bg-slate-50/50 dark:bg-slate-800/10 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
                        <p class="text-sm">No active coupons. Create one above to share with students!</p>
                    </div>
                `;
                return;
            }

            couponsList.innerHTML = coupons.map(coupon => {
                const expiryDate = new Date(coupon.expires_at);
                const day = String(expiryDate.getDate()).padStart(2, '0');
                const month = String(expiryDate.getMonth() + 1).padStart(2, '0');
                const year = expiryDate.getFullYear();
                const formattedExpiry = `${day}/${month}/${year}`;
                const isExpired = new Date() > expiryDate;
                
                return `
                    <div class="flex items-center justify-between p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm">
                        <div class="flex items-center gap-4">
                            <div class="bg-brand-purple/10 text-brand-purple px-3 py-1.5 rounded-lg font-bold text-sm tracking-wider">
                                ${coupon.code}
                            </div>
                            <div>
                                <p class="text-sm font-bold text-slate-900 dark:text-white">${coupon.discount_percentage}% OFF</p>
                                <p class="text-xs ${isExpired ? 'text-red-500 font-bold' : 'text-slate-500'}">
                                    ${isExpired ? 'Expired' : 'Expires'}: ${formattedExpiry}
                                </p>
                            </div>
                        </div>
                        <button class="delete-coupon-btn p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-all" data-id="${coupon.id}">
                            <span class="material-symbols-outlined text-xl">delete</span>
                        </button>
                    </div>
                `;
            }).join('');

            // Bind delete buttons
            couponsList.querySelectorAll('.delete-coupon-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    window.showConfirmModal({
                        title: "Delete Coupon",
                        message: "Are you sure you want to delete this coupon?",
                        confirmText: "Delete",
                        variant: "danger"
                    }, async () => {
                        try {
                            await MentorService.deleteCoupon(btn.dataset.id);
                            renderCoupons();
                            window.showToast("Coupon deleted successfully.", "success");
                        } catch (err) {
                            console.error(err);
                            window.showToast('Failed to delete coupon', 'error');
                        }
                    });
                });
            });

        } catch (err) {
            console.error('Error fetching coupons:', err);
        }
    };

    if (addCouponBtn) {
        addCouponBtn.addEventListener('click', async () => {
            const code = couponCodeInput.value.trim().toUpperCase();
            const discount = parseInt(couponDiscountInput.value);
            const expiryRaw = couponExpiryInput.value.trim(); // Expected DD/MM/YYYY
            const parts = expiryRaw.split('/');
            if (parts.length !== 3 || parts[0].length !== 2 || parts[1].length !== 2 || parts[2].length !== 4) {
                window.showToast('Please use DD/MM/YYYY format for expiry date (e.g. 31/12/2026)', 'error');
                return;
            }
            const expiry = `${parts[2]}-${parts[1]}-${parts[0]}`; // Convert to YYYY-MM-DD for storage

            if (!code) return window.showToast('Please enter a coupon code.', 'error');
            if (isNaN(discount) || discount < 1 || discount > 100) return window.showToast('Please enter a valid discount percentage (1-100).', 'error');
            if (!expiry) return window.showToast('Please select an expiry date.', 'error');

            try {
                addCouponBtn.disabled = true;
                addCouponBtn.innerHTML = '<span class="animate-spin mr-2">⌛</span> Creating...';

                await MentorService.createCoupon(userId, {
                    code,
                    discountPercentage: discount,
                    expiresAt: expiry
                });

                // Clear inputs
                couponCodeInput.value = '';
                couponDiscountInput.value = '';
                couponExpiryInput.value = '';

                renderCoupons();
                window.showToast('Coupon created successfully!', 'success');
            } catch (err) {
                console.error(err);
                if (err.message?.includes('unique constraint')) {
                    window.showToast('This coupon code already exists.', 'error');
                } else {
                    window.showToast('Failed to create coupon.', 'error');
                }
            } finally {
                addCouponBtn.disabled = false;
                addCouponBtn.innerHTML = '<span class="material-symbols-outlined text-lg">add</span> Create New Coupon';
            }
        });
    }

    // Initial render
    renderCoupons();
}

async function refreshDashboardStats(userId) {
    const { data } = await supabase.from('mentorship_profiles').select('total_sessions, avg_response_time_hours').eq('instructor_id', userId).single();
    if (!data) return;

    // Target the dashboard cards - based on setup.html structure but they are in the parent mentorship.html usually
    // We'll update them by finding the text elements
    // Target the dashboard cards
    const statsValueElements = document.querySelectorAll('.text-4xl.font-black');
    if (statsValueElements.length >= 1) {
        statsValueElements[0].innerText = data.total_sessions || "0";
    }
    // Add more stats mapping if needed
}

async function bindPrivacyInteractions(container, userId) {
    const saveBtn = document.getElementById('save-privacy-btn');
    const toggle = document.getElementById('public-profile-toggle');

    // Load initial state
    const { data } = await supabase.from('mentorship_profiles').select('is_public').eq('instructor_id', userId).single();
    if (data && toggle) {
        toggle.checked = data.is_public;
    }

    if (saveBtn && toggle) {
        saveBtn.addEventListener('click', async () => {
            const originalBtnText = saveBtn.innerHTML;
            const isPublic = toggle.checked;
            try {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '<span class="animate-spin mr-2">⌛</span> Saving...';

                await MentorService.updatePrivacy(userId, isPublic);
                window.showToast("Visibility settings updated successfully!", "success");
            } catch (err) {
                console.error(err);
                window.showToast("Failed to update visibility settings.", "error");
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerHTML = originalBtnText;
            }
        });
    }
}


/** Gold card wrapper classes for program mentorship */
const GOLD_CARD_STYLE = 'border-2 rounded-2xl overflow-hidden transition-all group p-6 hover:shadow-xl'
    + ' bg-gradient-to-br from-amber-50/60 to-white dark:from-amber-900/10 dark:to-slate-900'
    + ' border-yellow-400/60 dark:border-yellow-500/30';

const DEFAULT_CARD_STYLE = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden hover:shadow-lg transition-all group p-6';

// Type filter state shared across render functions on requests tab
let _requestsTypeFilter = 'all';
let _upcomingTypeFilter = 'all';
let _completedTypeFilter = 'all';

/** Build filter chips HTML */
function buildTypeFilterChips(filterState, containerId) {
    const opts = [{ v: 'all', l: 'All' }, { v: 'single', l: 'Single Sessions' }, { v: 'program', l: '⭐ Monthly' }];
    return `
        <div id="${containerId}" class="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800/50 rounded-xl w-fit mt-4 mb-0">
            ${opts.map(o => `
                <button class="type-filter-chip px-3 py-1.5 rounded-lg text-xs font-bold transition-all
                    ${filterState === o.v ? '!bg-white dark:!bg-slate-900 shadow-sm !text-primary' : 'text-slate-500 hover:text-slate-700'}"
                    data-type="${o.v}">${o.l}</button>
            `).join('')}
        </div>`;
}

/** Apply type filter to a list of sessions */
function applyTypeFilter(sessions, typeFilter) {
    if (typeFilter === 'single') return sessions.filter(s => (s.mentorship_type || 'single') === 'single');
    if (typeFilter === 'program') return sessions.filter(s => s.mentorship_type === 'program');
    return sessions;
}
async function bindRequestsInteractions(container, userId) {
    const listContainer = container.querySelector('#mentorship-requests-list');
    const emptyState = container.querySelector('#mentorship-requests-empty');
    if (!listContainer) return;

    const renderRequests = async () => {
        try {
            listContainer.innerHTML = `
                <div class="flex flex-col items-center justify-center py-20 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <div class="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-4"></div>
                    <p class="text-slate-500 font-medium">Fetching requests...</p>
                </div>
            `;
            
        const [pending, paidWaiting, awaiting, negotiating, rejectedReview] = await Promise.all([
                MentorService.getMentorSessions(userId, 'pending_review'),
                MentorService.getMentorSessions(userId, 'paid_waiting_review'),
                MentorService.getMentorSessions(userId, 'awaiting_meeting_link'),
                MentorService.getMentorSessions(userId, 'location_negotiation'),
                MentorService.getMentorSessions(userId, 'pending_rejection_review')
            ]);
            
            const allRequests = [...pending, ...paidWaiting, ...awaiting, ...negotiating, ...rejectedReview].sort((a,b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

            // Helper to determine filter
            const filterBtns = container.querySelectorAll('.request-filter-btn');
            const activeFilter = Array.from(filterBtns).find(b => b.classList.contains('bg-white'))&&Array.from(filterBtns).find(b => b.classList.contains('bg-white'))?.dataset.status || 'pending_review';

            let filtered = allRequests;
            if (activeFilter === 'pending_review') filtered = [...pending, ...paidWaiting, ...rejectedReview];
            if (activeFilter === 'action_required') filtered = [...awaiting, ...negotiating];

            filtered = applyTypeFilter(filtered, _requestsTypeFilter);

            if (filtered.length === 0) {
                listContainer.innerHTML = '';
                emptyState.classList.remove('hidden');
                return;
            }

            emptyState.classList.add('hidden');
            listContainer.innerHTML = filtered.map(session => {
                const date = new Date(session.scheduled_at);
                const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                const student = session.student || {};
                const studentName = student.full_name || (student.email ? student.email.split('@')[0] : 'Unknown Student');
                const studentAvatar = student.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(studentName)}&background=random&color=fff`;
                const status = session.booking_status || 'pending_review';

                let statusBadge = '';
                let actionsHtml = '';

                if (status === 'pending_review') {
                    statusBadge = `<span class="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-600 rounded text-[10px] font-bold uppercase tracking-wider">Pending Review</span>`;
                    actionsHtml = `
                        <div class="flex gap-2">
                            <button class="accept-btn px-6 py-2.5 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition-all text-sm whitespace-nowrap flex items-center gap-2 shadow-lg shadow-primary/20" data-id="${session.id}" data-type="${session.meeting_type}">
                                <span class="material-symbols-outlined text-[18px]">check_circle</span> Accept
                            </button>
                            <button class="reject-btn px-6 py-2.5 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-red-500 font-bold rounded-xl hover:bg-red-50 dark:hover:bg-red-900/10 transition-all text-sm whitespace-nowrap flex items-center gap-2" data-id="${session.id}">
                                <span class="material-symbols-outlined text-[18px]">cancel</span> Reject
                            </button>
                            <button class="message-btn px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-all text-sm flex items-center gap-2" data-id="${session.id}" data-name="${studentName}">
                                <span class="material-symbols-outlined text-[18px]">forum</span>
                            </button>
                        </div>
                    `;
                } else if (status === 'paid_waiting_review') {
                    statusBadge = `<span class="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 rounded text-[10px] font-bold uppercase tracking-wider">💳 Paid · Awaiting Review</span>`;
                    actionsHtml = `
                        <div class="flex gap-2">
                            <button class="accept-btn px-6 py-2.5 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition-all text-sm whitespace-nowrap flex items-center gap-2 shadow-lg shadow-primary/20" data-id="${session.id}" data-type="${session.meeting_type}">
                                <span class="material-symbols-outlined text-[18px]">check_circle</span> Accept
                            </button>
                            <button class="reject-btn px-6 py-2.5 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-red-500 font-bold rounded-xl hover:bg-red-50 dark:hover:bg-red-900/10 transition-all text-sm whitespace-nowrap flex items-center gap-2" data-id="${session.id}">
                                <span class="material-symbols-outlined text-[18px]">cancel</span> Reject
                            </button>
                            <button class="message-btn px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-all text-sm flex items-center gap-2" data-id="${session.id}" data-name="${studentName}">
                                <span class="material-symbols-outlined text-[18px]">forum</span>
                            </button>
                        </div>
                    `;
                } else if (status === 'awaiting_meeting_link') {
                    statusBadge = `<span class="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded text-[10px] font-bold uppercase tracking-wider">Add Link</span>`;
                    actionsHtml = `
                        <div class="flex flex-col gap-2">
                            <div class="relative">
                                <input type="text" placeholder="Paste meeting link..." class="meeting-link-input w-full md:w-64 pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all">
                                <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">link</span>
                            </div>
                            <div class="flex gap-2">
                                <button class="confirm-link-btn flex-1 px-4 py-2 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition-all text-sm shadow-md shadow-primary/20" data-id="${session.id}">Send Link</button>
                                <button class="message-btn px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl" data-id="${session.id}" data-name="${studentName}">
                                    <span class="material-symbols-outlined text-[18px]">forum</span>
                                </button>
                                <button class="reject-btn px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500" data-id="${session.id}">
                                    <span class="material-symbols-outlined text-[18px]">cancel</span>
                                </button>
                            </div>
                        </div>
                    `;
                } else if (status === 'location_negotiation') {
                    statusBadge = `<span class="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-600 rounded text-[10px] font-bold uppercase tracking-wider">Negotiating Location</span>`;
                    actionsHtml = `
                        <div class="flex gap-2">
                            <button class="confirm-location-btn px-6 py-2.5 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 transition-all text-sm flex items-center gap-2 shadow-lg shadow-emerald-500/20" data-id="${session.id}">
                                <span class="material-symbols-outlined text-[18px]">check_circle</span> Confirm
                            </button>
                            <button class="message-btn px-4 py-2.5 bg-primary/10 text-primary font-bold rounded-xl hover:bg-primary/20 transition-all text-sm flex items-center gap-2" data-id="${session.id}" data-name="${studentName}">
                                <span class="material-symbols-outlined text-[18px]">forum</span> Open Chat
                            </button>
                            <button class="reject-btn px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500" data-id="${session.id}">
                                <span class="material-symbols-outlined text-[18px]">cancel</span>
                            </button>
                        </div>
                    `;
                } else if (status === 'pending_rejection_review') {
                    statusBadge = `<span class="px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 border border-red-200 dark:border-red-900/50 rounded text-[10px] font-bold uppercase tracking-wider">Admin Reviewing Rejection</span>`;
                    actionsHtml = `
                        <div class="flex gap-2">
                            <div class="flex items-center gap-2 px-4 py-2 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
                                <span class="material-symbols-outlined text-slate-400 text-sm animate-pulse">hourglass_empty</span>
                                <span class="text-xs text-slate-500 font-medium">Awaiting Admin Decision</span>
                            </div>
                            <button class="message-btn px-4 py-2.5 bg-primary/10 text-primary font-bold rounded-xl hover:bg-primary/20 transition-all text-sm flex items-center gap-2" data-id="${session.id}" data-name="${studentName}">
                                <span class="material-symbols-outlined text-[18px]">forum</span>
                            </button>
                        </div>
                    `;
                }

                // Location row for in-person sessions
                const locationHtml = session.meeting_type === 'in-person' && session.meeting_location ? `
                    <div class="flex items-center gap-3 w-48 shrink-0">
                        <div class="w-10 h-10 bg-slate-50 dark:bg-slate-800 rounded-xl flex items-center justify-center text-primary shrink-0">
                            <span class="material-symbols-outlined text-xl">location_on</span>
                        </div>
                        <div class="min-w-0">
                            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Location</p>
                            <div class="flex items-center gap-2">
                                <p class="font-bold text-slate-900 dark:text-white text-sm truncate" title="${session.meeting_location.replace(/"/g, '&quot;')}">${escapeHtml(session.meeting_location || "")}</p>
                                <button onclick="window.openTopicModal('Meeting Location', '${session.meeting_location.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')" class="text-primary hover:text-primary/70 transition-colors">
                                    <span class="material-symbols-outlined text-sm">open_in_full</span>
                                </button>
                            </div>
                        </div>
                    </div>` : '';

                // Phone row for in-person sessions
                const phoneHtml = session.meeting_type === 'in-person' && session.student_phone ? `
                    <div class="flex items-center gap-3 w-40 shrink-0">
                        <div class="w-10 h-10 bg-slate-50 dark:bg-slate-800 rounded-xl flex items-center justify-center text-primary shrink-0">
                            <span class="material-symbols-outlined text-xl">phone</span>
                        </div>
                        <div class="min-w-0">
                            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Student Phone</p>
                            <p class="font-bold text-slate-900 dark:text-white text-sm truncate">${session.student_phone}</p>
                        </div>
                    </div>` : '';

                const isProgram = session.mentorship_type === 'program';
                return `
                    <div class="${isProgram ? GOLD_CARD_STYLE : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden hover:shadow-lg transition-all group p-6'}" data-session-id="${session.id}">
                        ${isProgram ? `<div class="flex items-center gap-2 mb-3">${buildMonthlyBadgeHtml()}<span class="text-[10px] font-bold text-amber-600/70">${session.duration_days || 30}-Day Program · ${session.total_sessions || 4} sessions</span></div>` : ''}
                        <div class="flex flex-col md:flex-row gap-8 items-center">
                            <!-- Student Info: Fixed width -->
                            <div class="flex items-center gap-4 w-full md:w-64 shrink-0">
                                <div class="w-16 h-16 rounded-2xl overflow-hidden border-2 border-primary/20 shrink-0 shadow-sm cursor-pointer" onclick='window.openStudentProfile(${JSON.stringify(student).replace(/'/g, "&#39;")})'>
                                    <img src="${studentAvatar}" class="w-full h-full object-cover" />
                                </div>
                                <div class="flex-1 min-w-0">
                                    <h4 class="font-bold text-slate-900 dark:text-white group-hover:text-primary transition-colors truncate cursor-pointer" onclick='window.openStudentProfile(${JSON.stringify(student).replace(/'/g, "&#39;")})'>${studentName}</h4>
                                    <div class="flex flex-wrap items-center gap-2 mt-1">
                                        <span class="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-[10px] font-bold text-slate-500 uppercase tracking-wider">${session.meeting_type}</span>
                                        ${statusBadge}
                                    </div>
                                </div>
                            </div>

                            <!-- Session Details: Optimized layout -->
                            <div class="flex-1 flex flex-wrap items-center gap-x-10 gap-y-4 md:px-8 border-t md:border-t-0 md:border-l border-slate-100 dark:border-slate-800 pt-4 md:pt-0 min-w-0">
                                <div class="flex items-center gap-3 w-44 shrink-0">
                                    <div class="w-10 h-10 bg-slate-50 dark:bg-slate-800 rounded-xl flex items-center justify-center text-primary shrink-0">
                                        <span class="material-symbols-outlined text-xl">calendar_today</span>
                                    </div>
                                    <div class="min-w-0">
                                        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Schedule</p>
                                        <p class="font-bold text-slate-900 dark:text-white text-sm whitespace-nowrap">${dateStr} @ ${timeStr}</p>
                                    </div>
                                </div>
                                ${locationHtml}
                                ${phoneHtml}
                                <div class="flex-1 min-w-[180px]">
                                    <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Topic</p>
                                    <div class="flex items-center justify-between gap-3 mt-1">
                                        <p class="font-medium text-slate-700 dark:text-slate-300 text-sm line-clamp-1 flex-1" title="${escapeHtml(session.topic) || 'No topic provided'}">${escapeHtml(session.topic) || 'No topic provided'}</p>
                                        ${session.topic ? `<button onclick="window.openTopicModal('${studentName.replace(/'/g, "\\'")}', this.dataset.topic)" data-topic="${(session.topic || '').replace(/"/g, '&quot;')}" class="shrink-0 px-3 py-1 bg-primary/10 text-primary hover:bg-primary hover:text-white rounded-lg text-[11px] font-bold transition-all whitespace-nowrap flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">open_in_full</span> View</button>` : ''}
                                    </div>
                                </div>
                            </div>

                            <!-- Actions: Fixed width -->
                            <div class="w-full md:w-fit flex flex-col gap-2 justify-center border-t md:border-t-0 border-slate-100 dark:border-slate-800 pt-4 md:pt-0">
                                ${actionsHtml}
                            </div>
                        </div>
                        ${isProgram ? buildMonthlyProgressHtml(session) : ''}
                    </div>
                `;
            }).join('');

            // Bind Actions
            listContainer.querySelectorAll('.accept-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const sessionId = btn.dataset.id;
                    const type = btn.dataset.type;
                    const nextStatus = type === 'online' ? 'awaiting_meeting_link' : 'location_negotiation';
                    try {
                        btn.disabled = true;
                        btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-[16px]">sync</span>';
                        await MentorService.updateSessionStatus(sessionId, nextStatus);
                        renderRequests();
                    } catch (err) {
                        console.error(err);
                        btn.disabled = false;
                        btn.innerHTML = '<span class="material-symbols-outlined text-[18px]">check_circle</span> Accept';
                    }
                });
            });

            listContainer.querySelectorAll('.reject-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const sessionId = btn.dataset.id;
                    showRejectModal(sessionId, () => {
                        renderRequests();
                    });
                });
            });

            listContainer.querySelectorAll('.confirm-link-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const sessionId = btn.dataset.id;
                    const card = listContainer.querySelector(`[data-session-id="${sessionId}"]`);
                    const link = card.querySelector('.meeting-link-input').value.trim();
                    if (!link) return window.showToast('Link required.', 'error');
                    try {
                        btn.disabled = true;
                        btn.innerText = 'Sending...';
                        await MentorService.updateMeetingLink(sessionId, link);
                        renderRequests();
                    } catch (err) {
                        console.error(err);
                        btn.disabled = false;
                        btn.innerText = 'Send Link';
                    }
                });
            });

            listContainer.querySelectorAll('.confirm-location-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const sessionId = btn.dataset.id;
                    try {
                        btn.disabled = true;
                        await MentorService.updateSessionStatus(sessionId, 'confirmed');
                        renderRequests();
                    } catch (err) {
                        console.error(err);
                        btn.disabled = false;
                    }
                });
            });

            listContainer.querySelectorAll('.message-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    openMessagingModal(btn.dataset.id, btn.dataset.name);
                });
            });

        } catch (err) {
            console.error("Error rendering requests:", err);
            listContainer.innerHTML = `<p class="text-red-500 p-8 text-center">Failed to load requests.</p>`;
        }
    };

    // --- REJECT MODAL LOGIC ---
    function showRejectModal(sessionId, onComplete) {
        // Create modal if it doesn't exist
        let modal = document.getElementById('reject-warning-modal');
        if (!modal) {
            const modalHtml = `
                <div id="reject-warning-modal" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm hidden text-left">
                    <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all">
                        <div class="p-6">
                            <div class="flex items-center gap-4 mb-4 text-amber-500">
                                <div class="w-12 h-12 bg-amber-50 dark:bg-amber-900/20 rounded-full flex items-center justify-center">
                                    <span class="material-symbols-outlined text-3xl">warning</span>
                                </div>
                                <h3 class="text-xl font-bold text-slate-900 dark:text-white">Send for Review?</h3>
                            </div>
                            <div class="text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
                                <p>Provide a reason for rejecting this session. The administrator will review your request before finalizing the rejection. <span class="text-red-500">*</span></p>
                                <textarea id="rejection-reason" class="w-full mt-3 p-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all min-h-[100px]" placeholder="Explain why you cannot take this session..."></textarea>
                                <div class="mt-4 p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-700">
                                    <strong class="text-slate-900 dark:text-white block mb-1 text-sm">Review Process:</strong> 
                                    <span class="text-xs">Your request will be reviewed by admin. If approved, the student will be refunded and the session will be cancelled.</span>
                                </div>
                            </div>
                            <div class="flex gap-3">
                                <button id="cancel-reject" class="flex-1 px-4 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl transition-colors">
                                    Go Back
                                </button>
                                <button id="confirm-reject" class="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 rounded-xl shadow-lg shadow-red-500/20 transition-all flex items-center justify-center gap-2">
                                    <span class="loader hidden w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                                    <span class="btn-text">Submit Request</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            modal = document.getElementById('reject-warning-modal');
        }

        const confirmBtn = modal.querySelector('#confirm-reject');
        const cancelBtn = modal.querySelector('#cancel-reject');
        const reasonInput = modal.querySelector('#rejection-reason');
        const loader = confirmBtn.querySelector('.loader');
        const btnText = confirmBtn.querySelector('.btn-text');

        // Reset input
        if (reasonInput) reasonInput.value = '';

        const hide = () => {
            modal.classList.add('hidden');
            confirmBtn.disabled = false;
            loader.classList.add('hidden');
            btnText.classList.remove('hidden');
        };

        const handleConfirm = async () => {
            const reason = reasonInput.value.trim();
            if (!reason) {
                reasonInput.classList.add('border-red-500');
                return window.showToast('Please provide a reason for the rejection review.', 'error');
            }
            reasonInput.classList.remove('border-red-500');

            try {
                confirmBtn.disabled = true;
                loader.classList.remove('hidden');
                btnText.classList.add('hidden');
                
                await MentorService.updateSessionStatus(sessionId, 'pending_rejection_review', reason);
                hide();
                if (onComplete) onComplete();
            } catch (err) {
                console.error(err);
                window.showToast('Failed to send rejection for review. Please try again.', 'error');
                hide();
            }
        };

        confirmBtn.onclick = handleConfirm;
        cancelBtn.onclick = hide;
        modal.classList.remove('hidden');
    }

    // Filter Tabs Interaction (Status)
    const filterBtns = container.querySelectorAll('.request-filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => {
                b.classList.remove('bg-white', 'dark:bg-slate-900', 'shadow-sm', 'text-primary');
                b.classList.add('text-slate-500', 'dark:text-slate-400');
            });
            btn.classList.add('bg-white', 'dark:bg-slate-900', 'shadow-sm', 'text-primary');
            btn.classList.remove('text-slate-500', 'dark:text-slate-400');
            renderRequests();
        });
    });

    // Inject Type Filter chips below existing status filters
    const filterRow = container.querySelector('.flex.items-center.gap-2.p-1.bg-slate-100');
    if (filterRow) {
        filterRow.insertAdjacentHTML('afterend', buildTypeFilterChips(_requestsTypeFilter, 'requests-type-chips'));
        container.querySelectorAll('#requests-type-chips .type-filter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                _requestsTypeFilter = chip.dataset.type;
                container.querySelectorAll('#requests-type-chips .type-filter-chip').forEach(c => {
                    c.classList.toggle('!bg-white', c === chip);
                    c.classList.toggle('dark:!bg-slate-900', c === chip);
                    c.classList.toggle('shadow-sm', c === chip);
                    c.classList.toggle('!text-primary', c === chip);
                    c.classList.toggle('text-slate-500', c !== chip);
                });
                renderRequests();
            });
        });
    }

    renderRequests();
}

async function bindUpcomingInteractions(container, userId) {
    const listContainer = container.querySelector('#mentorship-upcoming-list');
    const emptyState = container.querySelector('#mentorship-upcoming-empty');
    if (!listContainer) return;

    const renderUpcoming = async () => {
        try {
            listContainer.innerHTML = `<div class="py-20 text-center"><div class="animate-spin inline-block w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full"></div></div>`;
            
            const sessions = await MentorService.getMentorSessions(userId);
            
            // AUTOMATIC COMPLETION: Filter out past sessions
            const now = new Date();
            const activeSessions = sessions.filter(s => {
                const status = s.booking_status || s.status;
                const start = new Date(s.scheduled_at);
                const duration = s.duration_minutes || 60;
                let end;
                if (s.mentorship_type === 'program' && s.end_date) {
                    end = new Date(s.end_date);
                    end.setHours(23, 59, 59, 999);
                } else {
                    end = new Date(start.getTime() + duration * 60000);
                }
                
                // Programs still within end_date stay active regardless of DB status
                const isProgramStillActive = s.mentorship_type === 'program' && s.end_date && now < end && status !== 'cancelled';
                const isActive = ['confirmed', 'awaiting_meeting_link', 'cancelled', 'pending_rejection_review'].includes(status);
                // Upcoming includes sessions that haven't ended yet
                return isProgramStillActive || (isActive && now < end);
            });

            // Apply type filter
            const typeFiltered = applyTypeFilter(activeSessions, _upcomingTypeFilter);
            
            if (typeFiltered.length === 0) {
                listContainer.innerHTML = '';
                emptyState.classList.remove('hidden');
                return;
            }

            emptyState.classList.add('hidden');
            listContainer.innerHTML = typeFiltered.map(session => {
                const date = new Date(session.scheduled_at);
                const duration = session.duration_minutes || 60;
                const endDate = new Date(date.getTime() + duration * 60000);
                
                const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                const endTimeStr = endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

                // For program sessions, use the shared helper for accurate live status
                const progStatus = session.mentorship_type === 'program' ? getProgramMeetingStatus(session) : null;
                const isStarted = progStatus ? progStatus.isMeetingLive : (now >= date && now < endDate);
                // Show "Next meeting" badge only when the current daily slot has fully ended (not while live or before it starts)
                const showNextMeeting = progStatus && !progStatus.isMeetingLive && progStatus.nextMeetingLabel && now >= progStatus.meetingSlotEnd;
                const student = session.student || { full_name: 'Unknown Student', avatar_url: '', email: '' };
                const studentAvatar = student.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(student.full_name || 'S')}&background=random&color=fff`;

                const isCancelled = session.booking_status === 'cancelled';
                const isPendingRejection = session.booking_status === 'pending_rejection_review';
                const isProgram = session.mentorship_type === 'program';
                
                const programHtml = buildProgramProgressHtml(session);

                const cardClass = isCancelled 
                    ? "bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-900/30 rounded-2xl overflow-hidden shadow-sm group p-6 border-2" 
                    : isProgram ? GOLD_CARD_STYLE
                    : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden hover:shadow-lg transition-all group p-6";

                let actionHtml = '';
                if (isCancelled) {
                    actionHtml = `
                        <button class="delete-session-btn px-4 py-2.5 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 transition-all text-sm flex items-center gap-2 shadow-lg shadow-red-500/20" data-id="${session.id}">
                            <span class="material-symbols-outlined text-[18px]">delete</span> Remove
                        </button>
                    `;
                } else if (isPendingRejection) {
                    actionHtml = `<span class="px-3 py-1.5 bg-amber-100 dark:bg-amber-900/30 text-amber-600 rounded-lg text-[11px] font-bold uppercase tracking-wider">Admin Reviewing Rejection</span>`;
                } else if (session.meeting_type === 'online' && session.meeting_link) {
                    actionHtml = `<a href="${session.meeting_link}" target="_blank" class="px-6 py-2.5 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 transition-all text-sm flex items-center gap-2 shadow-lg shadow-emerald-500/20"><span class="material-symbols-outlined text-[18px]">videocam</span> Join</a>`;
                }

                return `
                    <div class="${cardClass}" data-session-id="${session.id}">
                        ${isProgram && !isCancelled ? `<div class="absolute top-4 right-4 z-10">${buildMonthlyBadgeHtml()}</div>` : ''}
                        <div class="flex flex-col md:flex-row gap-8 items-center">
                            <!-- Student Info: Fixed width -->
                            <div class="flex items-center gap-4 w-full md:w-64 shrink-0">
                                <div class="w-16 h-16 rounded-2xl overflow-hidden border-2 ${isCancelled ? 'border-red-200' : 'border-primary/20'} shrink-0 shadow-sm cursor-pointer" onclick='window.openStudentProfile(${JSON.stringify(student).replace(/'/g, "&#39;")})'>
                                    <img src="${studentAvatar}" class="w-full h-full object-cover ${isCancelled ? 'grayscale' : ''}" />
                                </div>
                                <div class="flex-1 min-w-0">
                                    <h4 class="font-bold ${isCancelled ? 'text-red-700 dark:text-red-400' : 'text-slate-900 dark:text-white group-hover:text-primary'} transition-colors truncate cursor-pointer" onclick='window.openStudentProfile(${JSON.stringify(student).replace(/'/g, "&#39;")})'>${escapeHtml(student.full_name) || 'Unknown Student'}</h4>
                                    <div class="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${isStarted ? 'bg-emerald-500 text-white animate-pulse' : showNextMeeting ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600' : (session.booking_status === 'cancelled' ? 'bg-red-500 text-white' : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600')}">
                                        ${isStarted ? 'Session Started' : showNextMeeting ? `Next: ${progStatus.nextMeetingLabel}` : (session.booking_status === 'cancelled' ? 'Cancelled' : 'Confirmed')}
                                    </div>
                                </div>
                            </div>

                            <!-- Session Details: Optimized layout -->
                            <div class="flex-1 flex flex-wrap items-center gap-x-10 gap-y-4 md:px-8 border-t md:border-t-0 md:border-l ${isCancelled ? 'border-red-100 dark:border-red-900/20' : 'border-slate-100 dark:border-slate-800'} pt-4 md:pt-0 min-w-0">
                                <div class="flex items-center gap-3 w-44 shrink-0">
                                    <div class="w-10 h-10 ${isCancelled ? 'bg-red-100 dark:bg-red-900/30 text-red-500' : 'bg-slate-50 dark:bg-slate-800 text-primary'} rounded-xl flex items-center justify-center shrink-0">
                                        <span class="material-symbols-outlined text-xl">calendar_today</span>
                                    </div>
                                    <div class="min-w-0">
                                        <p class="${isCancelled ? 'text-red-400' : 'text-slate-400'} text-[10px] font-bold uppercase tracking-widest">Schedule</p>
                                        <div class="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                                            <span class="material-symbols-outlined text-lg">schedule</span>
                                            <span class="text-sm font-medium">${timeStr} — ${endTimeStr}</span>
                                        </div>
                                    </div>
                                </div>
                                ${session.meeting_type === 'in-person' && session.meeting_location ? `
                                    <div class="flex items-center gap-3 w-44 shrink-0">
                                        <div class="w-10 h-10 ${isCancelled ? 'bg-red-100 dark:bg-red-900/30 text-red-500' : 'bg-slate-50 dark:bg-slate-800 text-primary'} rounded-xl flex items-center justify-center shrink-0">
                                            <span class="material-symbols-outlined text-xl">location_on</span>
                                        </div>
                                        <div class="min-w-0">
                                            <p class="${isCancelled ? 'text-red-400' : 'text-slate-400'} text-[10px] font-bold uppercase tracking-widest">Location</p>
                                            <p class="font-bold ${isCancelled ? 'text-red-800 dark:text-red-300' : 'text-slate-900 dark:text-white'} text-sm truncate" title="${session.meeting_location}">${escapeHtml(session.meeting_location || "")}</p>
                                        </div>
                                    </div>` : ''}
                                <div class="flex-1 min-w-[180px]">
                                    <p class="${isCancelled ? 'text-red-400' : 'text-slate-400'} text-[10px] font-bold uppercase tracking-widest">Topic</p>
                                    <div class="flex items-center justify-between gap-3 mt-1">
                                        <p class="font-medium ${isCancelled ? 'text-red-700 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'} text-sm line-clamp-1 flex-1" title="${escapeHtml(session.topic) || 'No topic provided'}">${escapeHtml(session.topic) || 'No topic provided'}</p>
                                        ${session.topic ? `<button onclick="window.openTopicModal('${(student.full_name || 'Student').replace(/'/g, "\\'")}', this.dataset.topic)" data-topic="${(session.topic || '').replace(/"/g, '&quot;')}" class="shrink-0 px-3 py-1 ${isCancelled ? 'bg-red-200 text-red-700' : 'bg-primary/10 text-primary hover:bg-primary hover:text-white'} rounded-lg text-[11px] font-bold transition-all whitespace-nowrap flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">open_in_full</span> View</button>` : ''}
                                    </div>
                                </div>
                            </div>

                            <!-- Actions: Fixed width -->
                            <div class="w-full md:w-fit flex flex-row md:flex-col gap-2 justify-center border-t md:border-t-0 ${isCancelled ? 'border-red-100 dark:border-red-900/20' : 'border-slate-100 dark:border-slate-800'} pt-4 md:pt-0">
                                ${actionHtml}
                                ${!isCancelled ? `
                                <button class="reschedule-session-btn px-4 py-2.5 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-bold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all text-sm flex items-center justify-center gap-2 whitespace-nowrap" data-id="${session.id}" data-date="${progStatus && progStatus.nextMeeting ? progStatus.nextMeeting.toISOString() : session.scheduled_at}" data-duration="${duration}" data-name="${(student.full_name || 'Student').replace(/"/g, '&quot;')}" data-history="${JSON.stringify(session.reschedule_history || []).replace(/"/g, '&quot;')}">
                                    <span class="material-symbols-outlined text-[18px]">edit_calendar</span> Reschedule
                                </button>
                                <button class="message-btn px-4 py-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center" data-id="${session.id}" data-name="${student.full_name || 'Student'}">
                                    <span class="material-symbols-outlined text-[18px]">forum</span>
                                </button>
                                ` : ''}
                            </div>
                        </div>
                        ${programHtml}
                    </div>
                `;
            }).join('');

            listContainer.querySelectorAll('.message-btn').forEach(btn => {
                btn.addEventListener('click', () => openMessagingModal(btn.dataset.id, btn.dataset.name));
            });
            
            listContainer.querySelectorAll('.reschedule-session-btn').forEach(btn => {
                btn.addEventListener('click', () => window.triggerMentorReschedule(btn.dataset.id, btn.dataset.date, btn.dataset.duration, btn.dataset.name, btn.dataset.history));
            });

            listContainer.querySelectorAll('.delete-session-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    window.showConfirmModal({
                        title: "Delete Session",
                        message: "Are you sure you want to permanently delete this cancelled session record?",
                        confirmText: "Delete",
                        variant: "danger"
                    }, async () => {
                        const sessionId = btn.dataset.id;
                        try {
                            btn.disabled = true;
                            btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-[16px]">sync</span>';
                            await MentorService.deleteSession(sessionId);
                            renderUpcoming();
                        } catch (err) {
                            console.error(err);
                            btn.disabled = false;
                            btn.innerHTML = '<span class="material-symbols-outlined text-[18px]">delete</span> Remove';
                            window.showToast('Failed to delete session.', 'error');
                        }
                    });
                });
            });

        } catch (err) {
            console.error(err);
            listContainer.innerHTML = '<p class="text-red-500">Error loading sessions.</p>';
        }
    };

    renderUpcoming();

    // Inject type filter chips for upcoming
    setTimeout(() => {
        const heading = container.querySelector('#mentorship-upcoming-list');
        if (heading) {
            heading.insertAdjacentHTML('beforebegin', buildTypeFilterChips(_upcomingTypeFilter, 'upcoming-type-chips'));
            container.querySelectorAll('#upcoming-type-chips .type-filter-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    _upcomingTypeFilter = chip.dataset.type;
                    container.querySelectorAll('#upcoming-type-chips .type-filter-chip').forEach(c => {
                        c.classList.toggle('!bg-white', c === chip);
                        c.classList.toggle('dark:!bg-slate-900', c === chip);
                        c.classList.toggle('shadow-sm', c === chip);
                        c.classList.toggle('!text-primary', c === chip);
                        c.classList.toggle('text-slate-500', c !== chip);
                    });
                    renderUpcoming();
                });
            });
        }
    }, 300);
}

async function bindCompletedInteractions(container, userId) {
    const listContainer = container.querySelector('#mentorship-completed-list');
    const emptyState = container.querySelector('#mentorship-completed-empty');
    if (!listContainer) return;

    const renderCompleted = async () => {
        try {
            listContainer.innerHTML = `<div class="py-20 text-center"><div class="animate-spin inline-block w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full"></div></div>`;
            
            // Fetch both confirmed and completed sessions
            const [confirmed, completed] = await Promise.all([
                MentorService.getMentorSessions(userId, 'confirmed'),
                MentorService.getMentorSessions(userId, 'completed')
            ]);
            
            const all = [...confirmed, ...completed];
            
            // Historical sessions: date is in the past or status is completed
            const now = new Date();
            let historical = all.filter(s => {
                const start = new Date(s.scheduled_at);
                const duration = s.duration_minutes || 60;
                let end;
                if (s.mentorship_type === 'program' && s.end_date) {
                    end = new Date(s.end_date);
                    end.setHours(23, 59, 59, 999);
                } else {
                    end = new Date(start.getTime() + duration * 60000);
                }
                // Don't show programs in history if they are still within end_date
                const isProgramStillActive = s.mentorship_type === 'program' && s.end_date && now < end && (s.booking_status || s.status) !== 'cancelled';
                if (isProgramStillActive) return false;
                return (s.booking_status || s.status) === 'completed' || now >= end;
            }).sort((a,b) => new Date(b.scheduled_at) - new Date(a.scheduled_at)); // Latest first
            
            historical = applyTypeFilter(historical, _completedTypeFilter);

            if (historical.length === 0) {
                listContainer.innerHTML = '';
                emptyState.classList.remove('hidden');
                return;
            }

            emptyState.classList.add('hidden');
            listContainer.innerHTML = historical.map(session => {
                const date = new Date(session.scheduled_at);
                const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                const student = session.student || { full_name: 'Unknown Student', avatar_url: '', email: '' };
                const studentAvatar = student.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(student.full_name || 'S')}&background=random&color=fff`;

                const isProgram = session.mentorship_type === 'program';
                return `
                    <div class="${isProgram ? GOLD_CARD_STYLE : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden hover:shadow-lg transition-all group p-6'} opacity-80 hover:opacity-100" data-session-id="${session.id}">
                        ${isProgram ? `<div class="flex items-center gap-2 mb-3">${buildMonthlyBadgeHtml()}<span class="text-[10px] font-bold text-amber-600/70">Program Completed</span></div>` : ''}
                        <div class="flex flex-col md:flex-row gap-8 items-center">
                            <!-- Student Info: Fixed width -->
                            <div class="flex items-center gap-4 w-full md:w-64 shrink-0">
                                <div class="w-16 h-16 rounded-2xl overflow-hidden border-2 border-slate-200 dark:border-slate-700 shrink-0 shadow-sm grayscale cursor-pointer" onclick='window.openStudentProfile(${JSON.stringify(student).replace(/'/g, "&#39;")})'>
                                    <img src="${studentAvatar}" class="w-full h-full object-cover" />
                                </div>
                                <div class="flex-1 min-w-0">
                                    <h4 class="font-bold text-slate-900 dark:text-white truncate cursor-pointer" onclick='window.openStudentProfile(${JSON.stringify(student).replace(/'/g, "&#39;")})'>${escapeHtml(student.full_name) || 'Unknown Student'}</h4>
                                    <span class="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-[10px] font-bold text-slate-500 uppercase tracking-wider">${session.meeting_type}</span>
                                </div>
                            </div>

                            <!-- Session Details: Optimized layout -->
                            <div class="flex-1 flex flex-wrap items-center gap-x-10 gap-y-4 md:px-8 border-t md:border-t-0 md:border-l border-slate-100 dark:border-slate-800 pt-4 md:pt-0 min-w-0">
                                <div class="flex items-center gap-3 w-44 shrink-0">
                                    <div class="w-10 h-10 bg-slate-50 dark:bg-slate-800 rounded-xl flex items-center justify-center text-slate-400 shrink-0">
                                        <span class="material-symbols-outlined text-xl">event_available</span>
                                    </div>
                                    <div class="min-w-0">
                                        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Completed On</p>
                                        <p class="font-bold text-slate-600 dark:text-slate-400 text-sm whitespace-nowrap">${dateStr}</p>
                                    </div>
                                </div>
                                <div class="flex-1 min-w-[180px]">
                                    <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Topic</p>
                                    <p class="font-medium text-slate-500 dark:text-slate-500 text-sm line-clamp-1" title="${escapeHtml(session.topic) || 'Mentorship Session'}">${escapeHtml(session.topic) || 'Mentorship Session'}</p>
                                </div>
                            </div>

                            <!-- Actions: Fixed width -->
                            <div class="w-full md:w-fit flex flex-col gap-2 justify-center border-t md:border-t-0 border-slate-100 dark:border-slate-800 pt-4 md:pt-0">
                                <button class="message-btn px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-all text-sm flex items-center gap-2" data-id="${session.id}" data-name="${(student.full_name || 'Student').replace(/'/g, "\\'")}">
                                    <span class="material-symbols-outlined text-[18px]">forum</span> Review Chat
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            listContainer.querySelectorAll('.message-btn').forEach(btn => {
                btn.addEventListener('click', () => openMessagingModal(btn.dataset.id, btn.dataset.name));
            });

        } catch (err) {
            console.error(err);
            listContainer.innerHTML = '<p class="text-red-500">Error loading history.</p>';
        }
    };

    renderCompleted();

    // Inject type filter chips for completed
    setTimeout(() => {
        const heading = container.querySelector('#mentorship-completed-list');
        if (heading) {
            heading.insertAdjacentHTML('beforebegin', buildTypeFilterChips(_completedTypeFilter, 'completed-type-chips'));
            container.querySelectorAll('#completed-type-chips .type-filter-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    _completedTypeFilter = chip.dataset.type;
                    container.querySelectorAll('#completed-type-chips .type-filter-chip').forEach(c => {
                        c.classList.toggle('!bg-white', c === chip);
                        c.classList.toggle('dark:!bg-slate-900', c === chip);
                        c.classList.toggle('shadow-sm', c === chip);
                        c.classList.toggle('!text-primary', c === chip);
                        c.classList.toggle('text-slate-500', c !== chip);
                    });
                    renderCompleted();
                });
            });
        }
    }, 300);
}

/** MESSAGING MODAL LOGIC **/
let currentMessageBookingId = null;

async function openMessagingModal(bookingId, studentName) {
    currentMessageBookingId = bookingId;
    const modal = document.getElementById('booking-message-modal');
    const historyContainer = document.getElementById('chat-history-container');
    const nameLabel = document.getElementById('modal-student-name');
    
    nameLabel.innerText = studentName;
    modal.classList.remove('hidden');
    
    historyContainer.innerHTML = '<div class="py-10 text-center"><div class="animate-spin inline-block w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full"></div></div>';
    
    try {
        const messages = await MentorService.getMessages(bookingId);
        if (messages.length === 0) {
            historyContainer.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-center py-10">
                    <span class="material-symbols-outlined text-slate-200 dark:text-slate-700 text-6xl mb-4">chat_bubble</span>
                    <p class="text-slate-400 text-sm">No messages yet. Start the conversation!</p>
                </div>
            `;
        } else {
            historyContainer.innerHTML = messages.map(msg => {
                const isMentor = msg.sender_role === 'mentor';
                return `
                    <div class="flex ${isMentor ? 'justify-end' : 'justify-start'}">
                        <div class="max-w-[80%] p-4 rounded-2xl ${isMentor ? 'bg-primary text-white rounded-tr-none' : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-none shadow-sm'}">
                            <p class="text-sm">${msg.message_text}</p>
                            <p class="text-[10px] mt-2 opacity-60">${new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                        </div>
                    </div>
                `;
            }).join('');
            historyContainer.scrollTop = historyContainer.scrollHeight;
        }
    } catch (err) {
        historyContainer.innerHTML = '<p class="text-red-500 text-center py-10">Failed to load messages.</p>';
    }
}

// Global modal initialization
function initMessagingModal() {
    const modal = document.getElementById('booking-message-modal');
    if (!modal) return;
    
    // Remove old listeners to avoid duplicates
    const oldCloseBtn = modal.querySelector('.close-modal-btn');
    const newCloseBtn = oldCloseBtn.cloneNode(true);
    oldCloseBtn.parentNode.replaceChild(newCloseBtn, oldCloseBtn);
    newCloseBtn.addEventListener('click', () => modal.classList.add('hidden'));
    
    const oldSendBtn = document.getElementById('send-message-btn');
    const newSendBtn = oldSendBtn.cloneNode(true);
    oldSendBtn.parentNode.replaceChild(newSendBtn, oldSendBtn);
    
    const input = document.getElementById('chat-input');
    
    newSendBtn.addEventListener('click', async () => {
        const text = input.value.trim();
        if (!text || !currentMessageBookingId) return;
        
        try {
            const session = await AuthService.getSession();
            const userId = session?.user?.id;
            
            if (!userId) {
                window.showToast("Session expired. Please log in again.", "error");
                return;
            }

            newSendBtn.disabled = true;
            await MentorService.sendMessage(currentMessageBookingId, userId, text, 'mentor');
            input.value = '';
            // Refresh history
            openMessagingModal(currentMessageBookingId, document.getElementById('modal-student-name').innerText);
        } catch (err) {
            window.showToast('Failed to send message.', 'error');
        } finally {
            newSendBtn.disabled = false;
        }
    });

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
    });
}

// Call init on load and when the modal might be re-rendered (though it's static in index.html)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMessagingModal);
} else {
    initMessagingModal();
}

window.deleteSession = async function(sessionId) {
    window.showConfirmModal({
        title: "Remove Session",
        message: "Are you sure you want to permanently remove this cancelled session?",
        confirmText: "Remove",
        variant: "danger"
    }, async () => {
        try {
            await MentorService.deleteSession(sessionId);
            loadMentors(true);
        } catch (err) {
            window.showToast("Failed to delete", "error");
        }
    });
};
