import { MentorService } from '../../../services/mentorService.js';
import { supabase } from '../../../services/supabaseClient.js';

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
    let currentTab = isIncomplete ? 'setup' : 'upcoming';

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
                alert("Failed to start application. Please try again.");
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
                alert("Availability and meeting types updated successfully!");
            } catch (err) {
                console.error(err);
                alert("Failed to save changes. Please try again.");
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

            if (isNaN(hourlyRate) || hourlyRate < 0) return alert("Please enter a valid hourly price.");
            if (isNaN(monthlyRate) || monthlyRate < 0) return alert("Please enter a valid monthly price.");

            try {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '<span class="animate-spin mr-2">⌛</span> Saving...';

                await MentorService.updatePricing(userId, hourlyRate, monthlyRate, currency);

                alert("Mentorship pricing updated successfully!");
            } catch (err) {
                console.error(err);
                alert("Failed to save pricing changes.");
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
                    if (confirm('Are you sure you want to delete this coupon?')) {
                        try {
                            await MentorService.deleteCoupon(btn.dataset.id);
                            renderCoupons();
                        } catch (err) {
                            console.error(err);
                            alert('Failed to delete coupon');
                        }
                    }
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
                alert('Please use DD/MM/YYYY format for expiry date (e.g. 31/12/2026)');
                return;
            }
            const expiry = `${parts[2]}-${parts[1]}-${parts[0]}`; // Convert to YYYY-MM-DD for storage

            if (!code) return alert('Please enter a coupon code.');
            if (isNaN(discount) || discount < 1 || discount > 100) return alert('Please enter a valid discount percentage (1-100).');
            if (!expiry) return alert('Please select an expiry date.');

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
                alert('Coupon created successfully!');
            } catch (err) {
                console.error(err);
                if (err.message?.includes('unique constraint')) {
                    alert('This coupon code already exists.');
                } else {
                    alert('Failed to create coupon.');
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
                alert("Visibility settings updated successfully!");
            } catch (err) {
                console.error(err);
                alert("Failed to update visibility settings.");
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerHTML = originalBtnText;
            }
        });
    }
}
