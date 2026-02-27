function initMentorship() {
    // 1) Grab all the tabs and the dynamic container
    const tabs = document.querySelectorAll('.mentorship-tab');
    const container = document.getElementById('mentorship-dynamic-content');
    const tabBar = document.getElementById('mentorship-tab-bar');

    if (!tabs || tabs.length === 0 || !container) return; // Not on mentorship view

    // Default tab
    let currentTab = 'setup';

    // 2) Function to fetch and render the HTML view
    const loadMentorshipView = async (tabName) => {
        try {
            // Visual feedback
            if (container) {
                container.style.opacity = '0.5';
                container.style.pointerEvents = 'none';
            }

            // Hide the tab bar completely if we are in "setup" onboarding
            if (tabBar) {
                if (tabName === 'setup') {
                    tabBar.style.display = 'none';
                } else {
                    tabBar.style.display = 'flex';
                }
            }

            const res = await fetch(`/instructor-mentorship/views/${tabName}.html`);
            if (!res.ok) {
                // Try to fallback if the file isn't there
                throw new Error(`Failed to load view: ${tabName}`);
            }

            const htmlText = await res.text();
            if (container) {
                container.innerHTML = htmlText;

                // Bind logic for availability tab if it was just loaded
                if (tabName === 'availability') {
                    bindAvailabilityInteractions(container);
                }

                // If we just loaded the setup form, we need to bind its submit button
                if (tabName === 'setup') {
                    const startApplicationBtn = container.querySelector('#start-mentorship-application-btn');
                    if (startApplicationBtn) {
                        startApplicationBtn.addEventListener('click', (e) => {
                            e.preventDefault();
                            // Switch to the main dashboard "upcoming" after setup is complete (simulated)

                            // 1. Hide the setup tab entirely
                            const setupTabBtn = document.querySelector('.mentorship-tab[data-tab="setup"]');
                            if (setupTabBtn) {
                                setupTabBtn.classList.add('hidden');
                            }

                            // 2. Unlock all other tabs
                            tabs.forEach(btn => {
                                if (btn.getAttribute('data-tab') !== 'setup') {
                                    btn.removeAttribute('disabled');
                                    btn.classList.remove('cursor-not-allowed');
                                    const lockIcon = btn.querySelector('.material-symbols-outlined');
                                    if (lockIcon && lockIcon.textContent === 'lock') {
                                        lockIcon.remove();
                                    }
                                }
                            });

                            // 3. Manually update tab state to upcoming
                            const upcomingTabBtn = document.querySelector('.mentorship-tab[data-tab="upcoming"]');
                            if (upcomingTabBtn) {
                                updateActiveTabStyles(upcomingTabBtn);
                            }
                            currentTab = 'upcoming';

                            // 4. Load the upcoming view
                            loadMentorshipView('upcoming');
                        });
                    }
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

    // 3) Setup Click Listeners & Active State Toggling
    const updateActiveTabStyles = (selectedTabBtn) => {
        tabs.forEach(btn => {
            // Remove active classes
            btn.classList.remove('border-brand-purple', 'text-brand-purple');
            // Add inactive classes
            btn.classList.add('border-transparent', 'text-slate-500', 'dark:text-slate-400');
            // Make sure flex layout persists
            btn.classList.add('flex', 'items-center', 'gap-2');
        });

        // Add active classes to the target
        selectedTabBtn.classList.remove('border-transparent', 'text-slate-500', 'dark:text-slate-400');
        selectedTabBtn.classList.add('border-brand-purple', 'text-brand-purple', 'flex', 'items-center', 'gap-2');
    };

    tabs.forEach(tabBtn => {
        tabBtn.addEventListener('click', () => {
            const target = tabBtn.getAttribute('data-tab');
            if (target && target !== currentTab) {
                currentTab = target;
                updateActiveTabStyles(tabBtn);
                loadMentorshipView(target);
            }
        });
    });

    // 4) Initial Load
    // Regardless of tabs, we force load 'setup' first
    loadMentorshipView('setup');
}

// Map it to document load AND the SPA custom event
document.addEventListener('DOMContentLoaded', initMentorship);
document.addEventListener('instructor-page-loaded', (e) => {
    if (e.detail && e.detail.path && e.detail.path.includes('mentorship')) {
        initMentorship();
    }
});

function bindAvailabilityInteractions(container) {
    const dayRows = container.querySelectorAll('.day-row');

    dayRows.forEach(row => {
        const toggleBtn = row.querySelector('.day-toggle');
        const slotsContainer = row.querySelector('.slots-container');
        const addSlotBtn = row.querySelector('.add-slot-btn');
        const toggleLabel = row.querySelector('.toggle-label');
        const dayIcon = row.querySelector('.day-icon');
        const dayIconTexts = row.querySelectorAll('.day-icon-text');

        // Function to handle slot deletion via event delegation
        slotsContainer.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.delete-slot-btn');
            if (deleteBtn) {
                const slotRow = deleteBtn.closest('.slot-row');
                if (slotRow) {
                    slotRow.remove();
                }
            }
        });

        // Function to handle adding slots
        if (addSlotBtn) {
            addSlotBtn.addEventListener('click', () => {
                const newSlot = document.createElement('div');
                newSlot.className = 'slot-row flex items-center gap-3 mt-3';
                newSlot.innerHTML = `
                    <div class="flex items-center bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 focus-within:ring-2 focus-within:ring-brand-purple/20 focus-within:border-brand-purple transition-all time-input-wrapper">
                        <input class="time-input bg-transparent border-none p-0 text-sm font-semibold text-slate-700 dark:text-slate-200 focus:ring-0 w-24" type="time" value="09:00"/>
                        <span class="mx-2 text-slate-400 text-xs">to</span>
                        <input class="time-input bg-transparent border-none p-0 text-sm font-semibold text-slate-700 dark:text-slate-200 focus:ring-0 w-24" type="time" value="17:00"/>
                    </div>
                    <button class="delete-slot-btn p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition-all">
                        <span class="material-symbols-outlined text-[20px]">delete</span>
                    </button>
                `;
                // Insert it before the addSlotBtn
                slotsContainer.insertBefore(newSlot, addSlotBtn);
            });
        }

        // Function to handle day toggle (ON/OFF)
        if (toggleBtn) {
            toggleBtn.addEventListener('change', (e) => {
                const isChecked = e.target.checked;

                if (isChecked) {
                    // Turn ON
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

                    // Show add button, hide unavailable text if any
                    if (addSlotBtn) addSlotBtn.classList.remove('hidden');
                    const unavailText = row.querySelector('.unavailable-text');
                    if (unavailText) unavailText.classList.add('hidden');

                    // Show all slot rows
                    const slotRows = row.querySelectorAll('.slot-row');
                    slotRows.forEach(sr => sr.classList.remove('hidden'));

                    // Enable inputs
                    const inputs = row.querySelectorAll('.time-input');
                    inputs.forEach(input => input.disabled = false);

                } else {
                    // Turn OFF
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

                    // Hide add button, show unavailable text
                    if (addSlotBtn) addSlotBtn.classList.add('hidden');
                    let unavailText = row.querySelector('.unavailable-text');
                    if (!unavailText && slotsContainer) {
                        unavailText = document.createElement('p');
                        unavailText.className = 'text-sm font-semibold text-slate-500 dark:text-slate-400 mt-2 unavailable-text';
                        unavailText.textContent = 'Unavailable';
                        slotsContainer.insertBefore(unavailText, addSlotBtn);
                    }
                    if (unavailText) unavailText.classList.remove('hidden');

                    // Hide all slot rows
                    const slotRows = row.querySelectorAll('.slot-row');
                    slotRows.forEach(sr => sr.classList.add('hidden'));

                    // Disable inputs
                    const inputs = row.querySelectorAll('.time-input');
                    inputs.forEach(input => input.disabled = true);
                }
            });
        }
    });
}
