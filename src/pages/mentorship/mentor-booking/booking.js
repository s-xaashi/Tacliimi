import { MentorService } from '../../../services/mentorService.js';
import { AuthService } from '../../../services/authService.js';
import { supabase } from '../../../services/supabaseClient.js';
import { PaymentService } from '../../../services/paymentService.js';

let selectedSlot = null;
let currentMentor = null;
let selectedDate = new Date(); // Default to today
let mentorAvailability = null; // Store full availability object

async function initBooking() {
    const urlParams = new URLSearchParams(window.location.search);
    const mentorId = urlParams.get('id');
    console.log("Booking page initialized with mentor ID:", mentorId);

    if (!mentorId) {
        console.warn("No mentor ID found in URL, redirecting back to marketplace...");
        window.location.href = '/src/pages/mentorship/mentor-marketplace/index.html';
        return;
    }

    try {
        // 1. Fetch Mentor Details
        currentMentor = await MentorService.getMentorById(mentorId);
        if (!currentMentor) {
            alert("Mentor not found.");
            return;
        }

        renderMentorInfo(currentMentor);
        setupMeetingTypes(currentMentor);
        
        // 2. Use Availability from mentor object (fetched in getMentorById)
        mentorAvailability = { slots: currentMentor.availability || [] };
        renderAvailability();

        // 3. Setup Pricing
        updatePricing(currentMentor.hourly_rate, currentMentor.monthly_rate);

        // 4. Initial Calendar Setup
        renderCalendar();

    } catch (err) {
        console.error("Error initializing booking:", err);
        // Show error in the main content area instead of silently failing
        const mainContent = document.querySelector('main');
        if (mainContent) {
            mainContent.innerHTML = `
                <div class="flex flex-col items-center justify-center py-32 text-center">
                    <span class="material-symbols-outlined text-6xl text-red-400 mb-4">error</span>
                    <h2 class="text-2xl font-bold text-slate-900 dark:text-white mb-2">Failed to Load Booking</h2>
                    <p class="text-slate-500 mb-6">We couldn't load the mentor's details. Please try again.</p>
                    <p class="text-xs text-slate-400 font-mono mb-8">${err.message || 'Unknown error'}</p>
                    <a href="/src/pages/mentorship/mentor-marketplace/index.html"
                       class="px-6 py-3 bg-primary text-white rounded-xl font-bold hover:bg-primary/90 transition-all">
                        Back to Marketplace
                    </a>
                </div>
            `;
        }
    }
}

function renderMentorInfo(mentor) {
    document.querySelector('h2').textContent = mentor.full_name;
    const expertiseEl = document.querySelector('.bg-primary\\/10.text-primary.text-xs.font-bold');
    if (expertiseEl) expertiseEl.textContent = mentor.headline || '';
    
    const avatarImg = document.querySelector('aside img');
    if (avatarImg) {
        const fallbackAvatar = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(mentor.full_name) + '&background=random&color=fff';
        avatarImg.src = mentor.avatar_url || fallbackAvatar;
    }

    const bioEl = document.querySelector('aside p.text-slate-500');
    if (bioEl) bioEl.textContent = mentor.short_bio || 'Expert mentor ready to guide you.';

    // Expertise tags — cap at 3 in the compact booking sidebar
    const tags = (mentor.expertise || []).slice(0, 3);
    if (tags.length > 0) {
        let tagsContainer = document.getElementById('mentor-expertise-tags');
        if (!tagsContainer && bioEl) {
            tagsContainer = document.createElement('div');
            tagsContainer.id = 'mentor-expertise-tags';
            tagsContainer.className = 'flex flex-wrap gap-1.5 mt-3';
            bioEl.parentNode.insertBefore(tagsContainer, bioEl.nextSibling);
        }
        if (tagsContainer) {
            tagsContainer.innerHTML = tags.map(tag =>
                `<span class="px-2 py-1 bg-primary/10 text-primary rounded-lg text-[10px] font-bold">${tag}</span>`
            ).join('');
        }
    }

    const stats = document.querySelectorAll('aside .font-bold');
    if (stats.length >= 2) {
        // Rating and Sessions findable by their parent text
        const ratingBox = document.querySelector('.bg-slate-50 div.flex.items-center.justify-center.font-bold');
        if (ratingBox) ratingBox.innerHTML = `<span class="material-symbols-outlined text-yellow-400 text-base fill-1">star</span> ${mentor.rating || '0.0'}`;
        
        const sessionsBox = document.querySelectorAll('.bg-slate-50 .font-bold')[1];
        if (sessionsBox) sessionsBox.textContent = mentor.total_sessions || '0';
    }
    
    const locationEl = document.querySelector('.w-full.mt-6.mb-2.flex.items-center.gap-2.text-slate-400 span:last-child');
    if (locationEl) locationEl.textContent = mentor.city ? `${mentor.city}, ${mentor.country}` : (mentor.country || 'Virtual');
}

function setupMeetingTypes(mentor) {
    const types = mentor.meeting_types || { online: true, in_person: false };
    const onlineOption = document.querySelector('input[value="online"]').closest('label');
    const inPersonOption = document.querySelector('input[value="in-person"]').closest('label');

    if (!types.online) {
        onlineOption.style.display = 'none';
    }

    if (!types.in_person) {
        inPersonOption.style.display = 'none';
    }
}

function formatTime(timeString) {
    if (!timeString) return '';
    const [hours, minutes] = timeString.split(':');
    const h = parseInt(hours);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const formattedHours = h % 12 || 12;
    return `${formattedHours}:${minutes} ${ampm}`;
}

function renderAvailability() {
    const headers = Array.from(document.querySelectorAll('h4'));
    const morningContainer = headers.find(h => h.textContent.includes('Morning'))?.nextElementSibling || document.querySelectorAll('h4 + div')[0];
    const afternoonContainer = headers.find(h => h.textContent.includes('Afternoon'))?.nextElementSibling || document.querySelectorAll('h4 + div')[1];

    if (!morningContainer || !afternoonContainer) return;

    morningContainer.innerHTML = '';
    afternoonContainer.innerHTML = '';

    if (!mentorAvailability || !mentorAvailability.slots) return;

    const currentDay = selectedDate.getDay();
    const filteredSlots = mentorAvailability.slots.filter(s => s.day_of_week === currentDay && s.is_enabled);
    const sortedSlots = filteredSlots.sort((a, b) => a.start_time.localeCompare(b.start_time));

    sortedSlots.forEach(slot => {
        const hour = parseInt(slot.start_time.split(':')[0]);
        const container = hour < 12 ? morningContainer : afternoonContainer;
        
        const btn = document.createElement('button');
        btn.className = 'w-full flex items-center justify-between p-4 border border-slate-200 dark:border-slate-800 rounded-xl hover:border-primary hover:bg-primary/5 transition-all group';
        btn.dataset.slotId = slot.id;
        
        const startTimeFormatted = formatTime(slot.start_time);
        const endTimeFormatted = formatTime(slot.end_time);
        btn.dataset.timeLabel = `${startTimeFormatted} — ${endTimeFormatted}`;
        btn.dataset.icon = hour < 12 ? 'wb_sunny' : 'schedule';

        btn.innerHTML = `
            <div class="flex items-center gap-3">
                <span class="material-symbols-outlined text-slate-400 group-hover:text-primary">${btn.dataset.icon}</span>
                <span class="font-semibold text-sm">${btn.dataset.timeLabel}</span>
            </div>
            <span class="text-xs font-bold text-slate-400">Available</span>
        `;

        btn.addEventListener('click', () => selectSlot(btn, slot));
        container.appendChild(btn);
    });
}

function selectSlot(btn, slot) {
    // Reset others
    document.querySelectorAll('[data-slot-id]').forEach(s => {
        s.className = 'w-full flex items-center justify-between p-4 border border-slate-200 dark:border-slate-800 rounded-xl hover:border-primary hover:bg-primary/5 transition-all group';
        s.innerHTML = `
            <div class="flex items-center gap-3">
                <span class="material-symbols-outlined text-slate-400 group-hover:text-primary">${s.dataset.icon}</span>
                <span class="font-semibold text-sm">${s.dataset.timeLabel}</span>
            </div>
            <span class="text-xs font-bold text-slate-400">Available</span>
        `;
    });

    // Select this one
    btn.className = 'w-full flex items-center justify-between p-4 border-2 border-primary bg-primary/5 text-primary rounded-xl transition-all';
    btn.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="material-symbols-outlined">${btn.dataset.icon}</span>
            <span class="font-bold text-sm">${btn.dataset.timeLabel}</span>
        </div>
        <span class="material-symbols-outlined text-lg">check_circle</span>
    `;
    selectedSlot = slot;
}

let appliedDiscount = 0;

function updatePricing(hourlyRate, monthlyRate) {
    const singlePrice = hourlyRate || 0;
    const monthlyPrice = monthlyRate || (singlePrice * 20); 
    
    const singlePriceEl = document.getElementById('single-session-price');
    if (singlePriceEl) singlePriceEl.textContent = `$${singlePrice.toFixed(2)}`;

    const monthlyPriceEl = document.getElementById('monthly-mentorship-price');
    if (monthlyPriceEl) monthlyPriceEl.textContent = `$${monthlyPrice.toFixed(2)}`;
    
    const totalEl = document.getElementById('total-price-display');
    
    // Switch total based on selected duration
    const updateTotal = () => {
        if (!totalEl) return;
        
        const checkedDuration = document.querySelector('input[name="mentorship_duration"]:checked');
        if (!checkedDuration) {
            totalEl.textContent = '--';
            return;
        }
        
        const isMonthly = checkedDuration.value === 'monthly';
        let basePrice = isMonthly ? monthlyPrice : singlePrice;
        let finalPrice = basePrice * (1 - (appliedDiscount / 100));
        
        totalEl.textContent = `$${finalPrice.toFixed(2)}`;
        
        if (appliedDiscount > 0) {
            totalEl.innerHTML = `
                <span class="text-lg line-through text-slate-400 mr-2 font-medium">$${basePrice.toFixed(2)}</span>$${finalPrice.toFixed(2)}
            `;
        }
    };

    document.querySelectorAll('input[name="mentorship_duration"]').forEach(r => {
        r.addEventListener('change', updateTotal);
    });

    // --- Coupon Logic ---
    const couponInput = document.getElementById('coupon-code-input-booking');
    const applyBtn = document.getElementById('apply-coupon-btn-booking');
    const couponMessage = document.getElementById('coupon-message');

    if (applyBtn && couponInput) {
        applyBtn.onclick = async () => {
            const code = couponInput.value.trim();
            if (!code) return;

            try {
                applyBtn.disabled = true;
                applyBtn.textContent = '...';

                const result = await MentorService.validateCoupon(currentMentor.id, code);
                
                couponMessage.classList.remove('hidden');
                if (result.valid) {
                    appliedDiscount = result.discountPercentage;
                    couponMessage.textContent = `Coupon applied! ${appliedDiscount}% discount.`;
                    couponMessage.className = 'text-xs mt-2 px-1 text-green-500 font-bold';
                } else {
                    appliedDiscount = 0;
                    couponMessage.textContent = result.message;
                    couponMessage.className = 'text-xs mt-2 px-1 text-red-500 font-bold';
                }
                updateTotal();
            } catch (err) {
                console.error(err);
                couponMessage.classList.remove('hidden');
                couponMessage.textContent = 'Error validating coupon.';
                couponMessage.className = 'text-xs mt-2 px-1 text-red-500 font-bold';
            } finally {
                applyBtn.disabled = false;
                applyBtn.textContent = 'Apply';
            }
        };
    }

    updateTotal();
}

// Minimal calendar helper
function renderCalendar() {
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    let m = selectedDate.getMonth();
    let y = selectedDate.getFullYear();
    
    const calMonthYear = document.getElementById('calendar-month-year');
    if (calMonthYear) calMonthYear.innerText = `${months[m]} ${y}`;

    const daysContainer = document.getElementById('calendar-days');
    if (!daysContainer) return;
    daysContainer.innerHTML = '';

    // Get first day of month and number of days
    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    
    // Previous month days for padding
    const prevDaysInMonth = new Date(y, m, 0).getDate();
    for (let i = firstDay - 1; i >= 0; i--) {
        const div = document.createElement('div');
        div.className = 'text-slate-300 py-2 text-center';
        div.textContent = prevDaysInMonth - i;
        daysContainer.appendChild(div);
    }

    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
        const btn = document.createElement('button');
        const isSelected = i === selectedDate.getDate() && m === selectedDate.getMonth() && y === selectedDate.getFullYear();
        
        btn.className = isSelected 
            ? 'py-2 bg-primary text-white rounded-xl font-bold shadow-lg shadow-primary/30'
            : 'py-2 hover:bg-primary/10 hover:text-primary rounded-xl font-medium transition-colors text-center';
        
        btn.textContent = i;
        btn.addEventListener('click', () => {
            selectedDate = new Date(y, m, i);
            renderCalendar();
            renderAvailability();
        });
        daysContainer.appendChild(btn);
    }

    // Setup nav buttons ONCE or clear and re-bind? 
    // Easier to bind once in initBooking but logic depends on selectedDate.
    // Let's re-bind them helper-style or just ensure we don't duplicate.
}

// Global listeners for nav (should be in initBooking usually but these are okay if they check existence)
document.getElementById('prev-month-btn')?.addEventListener('click', () => {
    selectedDate.setMonth(selectedDate.getMonth() - 1);
    renderCalendar();
    renderAvailability();
});
document.getElementById('next-month-btn')?.addEventListener('click', () => {
    selectedDate.setMonth(selectedDate.getMonth() + 1);
    renderCalendar();
    renderAvailability();
});

async function confirmBooking() {
    const topic = document.querySelector('textarea')?.value.trim();
    const meetingType = document.querySelector('input[name="meeting_type"]:checked')?.value;
    const duration = document.querySelector('input[name="mentorship_duration"]:checked')?.value;

    if (!selectedSlot) {
        alert("Please select a time slot.");
        return;
    }
    if (!meetingType) {
        alert("Please select a meeting type.");
        return;
    }
    if (!topic) {
        alert("Please enter a topic of discussion.");
        return;
    }

    let meetingLocation = '';
    let studentPhone = '';

    if (meetingType === 'in-person') {
        meetingLocation = document.querySelector('#in-person-modal input[placeholder*="Location"]')?.value.trim();
        studentPhone = document.querySelector('#in-person-modal input[type="tel"]')?.value.trim();
        
        if (!meetingLocation || !studentPhone) {
            alert("Please provide meeting location and phone number for in-person meetings.");
            document.getElementById('in-person-modal').style.display = 'flex';
            return;
        }
    }

    try {
        const session = await AuthService.getSession();
        if (!session) {
            alert("Please log in to book a session.");
            window.location.href = '/src/pages/auth/login/index.html';
            return;
        }

        const confirmBtn = document.querySelector('button[onclick*="confirmation.html"]');
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = '<span class="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></span>Redirecting to payment...';
        }

        // Calculate the actual date/time
        const [hours, minutes] = selectedSlot.start_time.split(':');
        const scheduledAt = new Date(selectedDate);
        scheduledAt.setHours(parseInt(hours), parseInt(minutes), 0, 0);

        // Calculate duration in minutes
        const [startH, startM] = selectedSlot.start_time.split(':').map(Number);
        const [endH, endM] = selectedSlot.end_time.split(':').map(Number);
        const durationMinutes = (endH * 60 + endM) - (startH * 60 + startM);

        const sessionData = {
            studentId: session.user.id,
            mentorId: currentMentor.instructor_id,
            scheduledAt: scheduledAt.toISOString(),
            topic: topic,
            meetingType: meetingType,
            meetingLocation: meetingLocation,
            studentPhone: studentPhone,
            durationMinutes: durationMinutes,
            notes: `Type: ${duration}`,
        };

        // Step 1: Create the session record — Edge Function will set booking_status to pending_payment
        const newSession = await MentorService.createSession(sessionData);

        // Step 2: Calculate the price to charge
        const isMonthly = duration === 'monthly';
        const baseAmount = isMonthly
            ? (currentMentor.monthly_rate || currentMentor.hourly_rate * 20)
            : (currentMentor.hourly_rate || 0);

        // Step 3: Redirect to Sifalo Checkout — this navigates the page away
        await PaymentService.createBookingCheckout(newSession.id, baseAmount, 'USD');

    } catch (err) {
        console.error("Booking error:", err);
        alert("Failed to initiate payment: " + err.message);
        const confirmBtn = document.querySelector('button[onclick*="confirmation.html"]');
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirm and Book Session';
        }
    }
}

window.confirmBooking = confirmBooking;

document.addEventListener('DOMContentLoaded', initBooking);
