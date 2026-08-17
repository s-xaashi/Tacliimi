import { supabase } from '/src/services/supabaseClient.js';
import { AuthService } from '/src/services/authService.js';
import { MentorService } from '/src/services/mentorService.js';
import { buildProgramProgressHtml, getProgramMeetingStatus } from '/src/utils/js/mentorshipUI.js';

let currentUserSession = null;
let currentProfile = null;
let allMentorshipSessions = null;
let lastMentorshipFetch = 0;
const MENTORSHIP_CACHE_TTL = 60000; // 1 minute

window.userActiveEnrollments = [];
window.currentActiveCourseIndex = 0;

window.renderActiveCourseBanner = function(step = 0) {
    if (!window.userActiveEnrollments || window.userActiveEnrollments.length === 0) return;
    
    window.currentActiveCourseIndex += step;
    
    if (window.currentActiveCourseIndex < 0) {
        window.currentActiveCourseIndex = window.userActiveEnrollments.length - 1;
    } else if (window.currentActiveCourseIndex >= window.userActiveEnrollments.length) {
        window.currentActiveCourseIndex = 0;
    }
    
    const enr = window.userActiveEnrollments[window.currentActiveCourseIndex];
    const course = enr.courses;
    if (!course) return;

    const continueSection = document.getElementById('continue-learning-section');
    if (!continueSection) return;

    const hasMultiple = window.userActiveEnrollments.length > 1;
    const arrowLeft = hasMultiple ? `
        <button onclick="event.stopPropagation(); window.renderActiveCourseBanner(-1)" class="absolute left-2 md:left-4 top-1/2 -translate-y-1/2 w-8 h-8 md:w-10 md:h-10 rounded-full bg-black/20 hover:bg-black/40 text-white flex items-center justify-center backdrop-blur-md transition-all z-20 opacity-60 hover:opacity-100">
            <span class="material-symbols-outlined">chevron_left</span>
        </button>
    ` : '';
    const arrowRight = hasMultiple ? `
        <button onclick="event.stopPropagation(); window.renderActiveCourseBanner(1)" class="absolute right-2 md:right-4 top-1/2 -translate-y-1/2 w-8 h-8 md:w-10 md:h-10 rounded-full bg-black/20 hover:bg-black/40 text-white flex items-center justify-center backdrop-blur-md transition-all z-20 opacity-60 hover:opacity-100">
            <span class="material-symbols-outlined">chevron_right</span>
        </button>
    ` : '';
    let dotsHtml = '';
    if (hasMultiple) {
         dotsHtml = `<div class="absolute bottom-2 md:bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-20">`;
         window.userActiveEnrollments.forEach((_, i) => {
             dotsHtml += `<div class="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full transition-all ${i === window.currentActiveCourseIndex ? 'bg-white scale-125' : 'bg-white/40'}"></div>`;
         });
         dotsHtml += `</div>`;
    }

    continueSection.innerHTML = `
        <div class="bg-gradient-to-r from-indigo-600 to-primary rounded-3xl p-6 md:p-8 text-white shadow-xl shadow-primary/20 relative overflow-hidden group cursor-pointer w-full anim-fade-in" onclick="window.location.href='/src/pages/learning/learning-interface/index.html?course=${course.id}'">
            <div class="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32 blur-3xl group-hover:scale-110 transition-transform duration-700 pointer-events-none z-0"></div>
            ${arrowLeft}
            ${arrowRight}
            ${dotsHtml}
            <div class="relative z-10 flex flex-col md:flex-row items-center gap-6 md:gap-8 h-full ${hasMultiple ? 'px-6 md:px-12' : ''}">
                <div class="w-full md:w-1/3 aspect-video rounded-2xl overflow-hidden shadow-2xl shrink-0 bg-black/10">
                    <img src="${course.thumbnail_url || 'https://placehold.co/600x400'}" alt="${course.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                </div>
                <div class="flex-1 flex flex-col justify-center text-center md:text-left min-w-0 h-full w-full">
                    <div>
                        <div class="flex items-center justify-center md:justify-start gap-2 mb-4 shrink-0">
                            <span class="px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-[10px] font-bold uppercase tracking-widest shrink-0">Resume Learning</span>
                            <span class="px-3 py-1 bg-amber-400/20 backdrop-blur-md rounded-full text-[10px] font-bold uppercase tracking-widest text-amber-200 shrink-0">Active</span>
                        </div>
                        <h2 class="text-2xl md:text-3xl font-extrabold mb-4 tracking-tight line-clamp-2 shrink-0">${course.title}</h2>
                    </div>
                    <div class="flex flex-col sm:flex-row items-center gap-6 mt-4 shrink-0 w-full md:mb-0 ${hasMultiple ? 'mb-4' : ''}">
                        <div class="w-full sm:flex-1">
                            <div class="flex justify-between text-[11px] mb-2 text-indigo-100 font-bold uppercase tracking-wider">
                                <span>Progress</span>
                                <span>${enr.progress_percentage || 0}%</span>
                            </div>
                            <div class="w-full bg-white/20 rounded-full h-2 overflow-hidden backdrop-blur-sm">
                                <div class="bg-white h-full rounded-full transition-all duration-1000" style="width: ${enr.progress_percentage || 0}%"></div>
                            </div>
                        </div>
                        <button class="w-full sm:w-auto px-6 py-3 bg-white text-indigo-600 rounded-xl font-bold hover:bg-slate-50 transition-all flex items-center justify-center gap-2 shadow-lg shadow-black/10 group-hover:translate-x-1 shrink-0">
                            Continue <span class="material-symbols-outlined font-bold">play_arrow</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    continueSection.classList.remove('hidden');
}

async function ensureSession() {
    if (!currentUserSession) {
        currentUserSession = await AuthService.getSession();
    }
    return currentUserSession;
}

// Routing for tabs
window.switchDashboardTab = function (tabId) {
    const tabs = ['my-courses', 'completed', 'my-mentors', 'wishlist'];
    tabs.forEach(tab => {
        const btn = document.getElementById('tab-' + tab);
        if (!btn) return;
        if (tab === tabId) {
            btn.className = "whitespace-nowrap pb-4 px-1.5 text-primary font-semibold border-b-2 border-primary flex items-center gap-1 transition-colors shrink-0 text-xs sm:text-base sm:px-2 sm:gap-1.5";
        } else {
            btn.className = "whitespace-nowrap pb-4 px-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-medium flex items-center gap-1 border-b-2 border-transparent transition-colors shrink-0 text-xs sm:text-base sm:px-2 sm:gap-1.5";
        }
    });

    tabs.forEach(tab => {
        const content = document.getElementById('content-' + tab);
        if (!content) return;
        if (tab === tabId) {
            content.classList.remove('hidden');
        } else {
            content.classList.add('hidden');
        }
    });

    // Refresh data for the specific tab
    if (tabId === 'my-courses') loadMyCourses();
    else if (tabId === 'my-mentors') loadMentors();
    else if (tabId === 'wishlist') loadWishlist();
};

async function initDashboard() {
    currentUserSession = await AuthService.getSession();
    if (!currentUserSession) {
        window.location.href = '/src/pages/auth/login-select/index.html';
        return;
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUserSession.user.id)
        .single();
    
    currentProfile = profile;
    
    if (profile) {
        const displayNames = document.querySelectorAll('.user-display-name');
        displayNames.forEach(el => el.textContent = profile.full_name || 'Student Name');
    }

    await Promise.all([
        loadMyCourses(),
        loadWishlist(),
        loadMentors()
    ]);
}

async function loadMyCourses() {
    await ensureSession();
    if (!currentUserSession?.user) return;

    const { data: enrollments, error } = await supabase
        .from('enrollments')
        .select('*, courses(*, course_categories(*), instructor:profiles(*))')
        .eq('student_id', currentUserSession.user.id);

    // Fetch unredeemed update offers for this student.
    // from_version_id  = the version they are currently enrolled in
    // to_version_id    = the new version the instructor published
    const { data: updateOffers, error: offerErr } = await supabase
        .from('course_update_offers')
        .select(`
            id, root_course_id, from_version_id, to_version_id, notified_at, created_at,
            coupon:course_coupons(id, code, discount_percent),
            to_version:courses!course_update_offers_to_version_id_fkey(
                id, title, subtitle, thumbnail_url, version_number, price, price_type,
                course_sections(id, title, course_lessons(id, title))
            ),
            from_version:courses!course_update_offers_from_version_id_fkey(
                id, version_number,
                course_sections(id, title, course_lessons(id, title))
            )
        `)
        .eq('student_id', currentUserSession.user.id)
        .is('redeemed_at', null);
    
    // Fetch payments to map Pay-IDs to course cards (valid statuses: pending, paid, failed, refunded)
    const { data: paymentsInfo, error: payErr } = await supabase
        .from('payments')
        .select('course_id, serial_id, created_at')
        .eq('student_id', currentUserSession.user.id)
        .eq('payment_status', 'paid')
        .not('course_id', 'is', null);

    if (payErr) console.warn('Payment fetch warning:', payErr.message);

    const paymentMap = {};     // course_id -> serial_id
    const paymentDateMap = {}; // course_id -> created_at
    if (paymentsInfo) {
        paymentsInfo.forEach(p => {
            if (p.course_id && p.serial_id) {
                paymentMap[p.course_id] = p.serial_id;
                paymentDateMap[p.course_id] = p.created_at;
            }
        });
    }
    
    const continueSection = document.getElementById('continue-learning-section');
    const newStudentSection = document.getElementById('new-student-section');
    const enrolledCoursesGrid = document.getElementById('enrolled-courses-grid');
    const welcomeMsg = document.getElementById('dashboard-welcome-msg');
    const emptyState = document.getElementById('global-courses-empty-state');
    
    // Clear aria-busy on the courses grid container (skeleton was pre-rendered in HTML)
    const coursesContent = document.getElementById('content-my-courses');
    if (coursesContent) coursesContent.removeAttribute('aria-busy');

    if (!enrollments || enrollments.length === 0) {
        // Replace hero skeleton with hidden state
        continueSection.innerHTML = '';
        continueSection.classList.add('hidden');
        continueSection.removeAttribute('aria-busy');
        newStudentSection.classList.remove('hidden');
        enrolledCoursesGrid.innerHTML = ''; // clear skeleton cards
        enrolledCoursesGrid.classList.add('hidden');
        emptyState.classList.remove('hidden');
        if (welcomeMsg) welcomeMsg.textContent = "Start your learning journey by exploring our beginner-friendly courses.";
        
        // Fetch and show beginner courses in new student section
        await loadBeginnerCourses();
    } else {
        continueSection.removeAttribute('aria-busy');
        newStudentSection.classList.add('hidden');
        // continueSection visibility managed below by renderActiveCourseBanner
        enrolledCoursesGrid.classList.remove('hidden');
        emptyState.classList.add('hidden');

        // Filter duplicate versions within the same family, keeping latest version
        const familyMap = {};
        enrollments.forEach(enr => {
            if (enr.status === 'superseded') return;
            const c = enr.courses;
            if (!c) return;
            const familyId = c.root_course_id || c.id;
            if (!familyMap[familyId] || (c.version_number || 1) > (familyMap[familyId].courses.version_number || 1)) {
                familyMap[familyId] = enr;
            }
        });
        
        const latestEnrollments = Object.values(familyMap);

        // Sort by most recently accessed (updated_at)
        latestEnrollments.sort((a,b) => {
            const dateA = new Date(a.updated_at || a.enrolled_at);
            const dateB = new Date(b.updated_at || b.enrolled_at);
            return dateB - dateA;
        });

        const activeEnrollments = latestEnrollments.filter(e => (e.progress_percentage || 0) < 100);
        const completedEnrollments = latestEnrollments.filter(e => (e.progress_percentage || 0) === 100);
        
        if (welcomeMsg) {
            if (activeEnrollments.length > 0) {
                welcomeMsg.textContent = `Welcome back! You're making great progress in ${activeEnrollments.length} courses.`;
                
                
                // Populate Continue Learning Section with active courses
                window.userActiveEnrollments = activeEnrollments;
                window.currentActiveCourseIndex = 0;
                window.renderActiveCourseBanner(0);
            } else {
                welcomeMsg.textContent = `Congratulations! You've completed all your enrolled courses. Ready for something new?`;
                continueSection.classList.add('hidden');
            }
        }

        const enrolledCourseIds = new Set(enrollments.map(e => e.course_id));

        // Build offer lookup: keyed by the from_version_id (what the student is enrolled in)
        const offerMap = {};
        for (const offer of (updateOffers || [])) {
            // Do not show an update offer if the student is already enrolled in the new version
            if (offer.to_version_id && enrolledCourseIds.has(offer.to_version_id)) continue;

            if (offer.from_version_id) offerMap[offer.from_version_id] = offer;
            // Also match by root_course_id as fallback (handles older enrollments)
            if (offer.root_course_id && !offerMap[offer.root_course_id]) {
                offerMap[offer.root_course_id] = offer;
            }
        }

        // Render active courses grid
        let activeHtml = '';
        activeEnrollments.forEach(enr => {
            // Match offer by: enrolled course_id → from_version_id, or root_course_id
            const offer = offerMap[enr.course_id]
                || offerMap[enr.courses?.root_course_id]
                || null;
            const payId = paymentMap[enr.course_id] || paymentMap[enr.courses?.root_course_id] || null;
            const payDate = paymentDateMap[enr.course_id] || paymentDateMap[enr.courses?.root_course_id] || enr.enrolled_at || null;
            activeHtml += renderCourseCard(enr, offer, payId, payDate);
        });
        enrolledCoursesGrid.innerHTML = activeHtml || `
            <div class="col-span-full py-12 text-center">
                <p class="text-slate-500 italic">No in-progress courses.</p>
            </div>
        `;

        // Render completed courses grid
        const completedGrid = document.getElementById('completed-courses-grid');
        const completedEmptyState = document.getElementById('completed-courses-empty-state');
        let completedHtml = '';
        completedEnrollments.forEach(enr => {
            const offer = offerMap[enr.course_id]
                || offerMap[enr.courses?.root_course_id]
                || null;
            const payId = paymentMap[enr.course_id] || paymentMap[enr.courses?.root_course_id] || null;
            const payDate = paymentDateMap[enr.course_id] || paymentDateMap[enr.courses?.root_course_id] || enr.enrolled_at || null;
            completedHtml += renderCourseCard(enr, offer, payId, payDate);
        });
        
        if (completedGrid) {
            completedGrid.innerHTML = completedHtml;
            if (completedEnrollments.length === 0) {
                completedEmptyState?.classList.remove('hidden');
                completedGrid.classList.add('hidden');
            } else {
                completedEmptyState?.classList.add('hidden');
                completedGrid.classList.remove('hidden');
            }
        }
    }
}

// ----- Update Offer Modal State -----
window._activeOffer = null;

window.openUpdateModal = function(offerId) {
    const offer = window._offerRegistry?.[offerId];
    if (!offer) return;
    window._activeOffer = offer;

    const modal = document.getElementById('course-update-modal');
    if (!modal) return;

    const newCourse = offer.to_version;
    const oldCourse = offer.from_version;
    const versionLabel = newCourse?.version_number ? `V${newCourse.version_number}` : 'New Version';
    const coupon = offer.coupon;
    const isFree = newCourse?.price_type === 'free' || parseFloat(newCourse?.price || 0) === 0;
    const priceDisplay = isFree ? 'Free' : `$${parseFloat(newCourse?.price || 0).toFixed(2)}`;

    // Compute changelog diff (sections/lessons added or removed)
    const oldLessons = new Set();
    const newLessons = new Set();
    const oldSectionTitles = new Set();
    const newSectionTitles = new Set();

    (oldCourse?.course_sections || []).forEach(sec => {
        oldSectionTitles.add(sec.title);
        (sec.course_lessons || []).forEach(l => oldLessons.add(l.title));
    });
    (newCourse?.course_sections || []).forEach(sec => {
        newSectionTitles.add(sec.title);
        (sec.course_lessons || []).forEach(l => newLessons.add(l.title));
    });

    const addedSections = [...newSectionTitles].filter(t => !oldSectionTitles.has(t));
    const removedSections = [...oldSectionTitles].filter(t => !newSectionTitles.has(t));
    const addedLessons = [...newLessons].filter(t => !oldLessons.has(t));
    const removedLessons = [...oldLessons].filter(t => !newLessons.has(t));

    const hasChanges = addedSections.length || removedSections.length || addedLessons.length || removedLessons.length;

    const changelogHtml = hasChanges ? `
        <div class="space-y-3">
            ${addedSections.length ? `<div><p class="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-1">New Sections Added</p>${addedSections.map(s => `<div class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300"><span class="material-symbols-outlined text-emerald-500 text-[16px]">add_circle</span>${s}</div>`).join('')}</div>` : ''}
            ${removedSections.length ? `<div><p class="text-[10px] font-bold uppercase tracking-widest text-red-500 mb-1">Sections Removed</p>${removedSections.map(s => `<div class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300"><span class="material-symbols-outlined text-red-400 text-[16px]">remove_circle</span>${s}</div>`).join('')}</div>` : ''}
            ${addedLessons.length ? `<div><p class="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-1">Lessons Added</p>${addedLessons.slice(0, 6).map(l => `<div class="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400"><span class="material-symbols-outlined text-emerald-400 text-[16px]">play_circle</span>${l}</div>`).join('')}${addedLessons.length > 6 ? `<p class="text-xs text-slate-400 mt-1">+ ${addedLessons.length - 6} more</p>` : ''}</div>` : ''}
            ${removedLessons.length ? `<div><p class="text-[10px] font-bold uppercase tracking-widest text-red-500 mb-1">Lessons Removed</p>${removedLessons.slice(0, 6).map(l => `<div class="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400"><span class="material-symbols-outlined text-red-400 text-[16px]">cancel</span>${l}</div>`).join('')}${removedLessons.length > 6 ? `<p class="text-xs text-slate-400 mt-1">+ ${removedLessons.length - 6} more</p>` : ''}</div>` : ''}
        </div>
    ` : `<p class="text-slate-400 italic text-sm">The instructor has updated the course content. Enroll to access the latest version.</p>`;

    const noCouponText = isFree ? 'This version is free — no payment needed.' : 'No coupon needed — this version is available at the standard price.';
    const couponHtml = coupon ? `
        <div class="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl">
            <span class="material-symbols-outlined text-emerald-500">local_offer</span>
            <div>
                <p class="text-xs font-bold text-slate-500">Exclusive Discount Coupon</p>
                <p class="font-black text-emerald-600 dark:text-emerald-400 text-lg tracking-widest">${coupon.code}</p>
                <p class="text-xs text-emerald-600">${coupon.discount_percent}% off — applied automatically when you re-enroll</p>
            </div>
        </div>
    ` : `<div class="flex items-center gap-3 p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl">
        <span class="material-symbols-outlined text-indigo-500">${isFree ? 'check_circle' : 'card_giftcard'}</span>
        <p class="text-sm font-bold text-indigo-600">${noCouponText}</p>
    </div>`;

    document.getElementById('modal-update-version').textContent = versionLabel;
    document.getElementById('modal-update-title').textContent = newCourse?.title || 'Updated Course';
    document.getElementById('modal-update-thumbnail').src = newCourse?.thumbnail_url || 'https://placehold.co/600x400';
    document.getElementById('modal-update-price').textContent = priceDisplay;
    document.getElementById('modal-update-changelog').innerHTML = changelogHtml;
    document.getElementById('modal-update-coupon').innerHTML = couponHtml;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.style.overflow = 'hidden';
};

window.closeUpdateModal = function() {
    const modal = document.getElementById('course-update-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.body.style.overflow = '';
    window._activeOffer = null;
};

window.reEnrollWithCoupon = async function() {
    const offer = window._activeOffer;
    if (!offer?.to_version_id) return;
    const couponCode = offer.coupon?.code || '';
    const couponParam = couponCode ? `&coupon=${encodeURIComponent(couponCode)}` : '';
    // Redirect to course details with the coupon pre-applied
    window.location.href = `/src/pages/marketplace/course-details/index.html?id=${offer.to_version_id}${couponParam}&offer=${offer.id}`;
};

function renderCourseCard(enr, updateOffer, payId = null, payDate = null) {
    const course = enr.courses;
    if(!course) return '';
    const category = course.course_categories ? course.course_categories.name : 'Course';
    const progress = enr.progress_percentage || 0;
    
    // Register offer in a global registry so openUpdateModal can access full data
    if (!window._offerRegistry) window._offerRegistry = {};
    if (updateOffer) window._offerRegistry[updateOffer.id] = updateOffer;

    let updateBadgeHtml = '';
    if (updateOffer && updateOffer.to_version) {
        const newVer = updateOffer.to_version.version_number;
        updateBadgeHtml = `
            <button onclick="event.stopPropagation(); window.openUpdateModal('${updateOffer.id}');"
                class="absolute top-2 left-2 z-10 flex items-center gap-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-full shadow-lg shadow-indigo-500/30 hover:scale-105 transition-transform animate-pulse-slow cursor-pointer">
                <span class="material-symbols-outlined text-[13px]">system_update</span>
                UPDATE V${newVer} AVAILABLE
            </button>
        `;
    }

    return `
    <div class="flex flex-col group bg-white dark:bg-slate-900 border ${updateOffer ? 'border-indigo-300 dark:border-indigo-700 shadow-indigo-100 dark:shadow-indigo-900/10 shadow-md' : 'border-slate-200 dark:border-slate-800'} rounded-xl sm:rounded-2xl overflow-hidden hover:shadow-xl transition-all duration-300 cursor-pointer h-full" onclick="window.location.href='/src/pages/learning/learning-interface/index.html?course=${encodeURIComponent(course.id)}'">
        <div class="aspect-video relative overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0">
            ${updateBadgeHtml}
            <img src="${course.thumbnail_url || 'https://placehold.co/600x400'}" alt="${course.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
            <div class="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span class="material-symbols-outlined text-white text-3xl sm:text-5xl">${progress === 100 ? 'replay' : 'play_circle'}</span>
            </div>
            ${progress === 100 ? `
            <div class="absolute top-2 right-2 bg-emerald-500 text-white px-2 py-1 rounded-full text-[9px] sm:text-[10px] font-bold flex items-center gap-1 shadow-lg z-10">
                <span class="material-symbols-outlined text-[10px] sm:text-[12px]">verified</span> COMPLETED
            </div>
            ` : ''}
        </div>
        <div class="p-4 sm:p-5 flex flex-col flex-1 min-w-0">
            <div class="flex items-center flex-wrap gap-2 mb-2 sm:mb-3 shrink-0">
                <span class="px-2 py-0.5 rounded text-[9px] sm:text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary whitespace-nowrap">${category}</span>
                ${course.serial_id ? `<span class="px-2 py-0.5 rounded text-[9px] sm:text-[10px] font-black uppercase tracking-widest bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700 font-mono whitespace-nowrap">CRS-${course.serial_id}</span>` : ''}
            </div>
            <h4 class="font-bold text-sm sm:text-base text-slate-900 dark:text-white mb-3 sm:mb-4 line-clamp-2 min-h-[2.5rem] sm:min-h-[3rem] group-hover:text-primary transition-colors shrink-0">${course.title}</h4>
            <div class="space-y-3 mt-auto shrink-0">
                <div class="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                    <span>${progress === 100 ? 'Course Finished' : 'Your Progress'}</span>
                    <span class="font-bold">${progress}%</span>
                </div>
                <div class="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div class="${progress === 100 ? 'bg-emerald-500' : 'bg-primary'} h-full rounded-full transition-all duration-1000" style="width: ${progress}%"></div>
                </div>
                <!-- Buttons Wrapper -->
                <div class="flex flex-col gap-2 pt-2">
                    ${updateOffer ? `
                    <button onclick="event.stopPropagation(); window.openUpdateModal('${updateOffer.id}');"
                        class="w-full py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold rounded-xl text-xs flex items-center gap-2 justify-center hover:opacity-90 transition-opacity shadow-lg shadow-indigo-500/20">
                        <span class="material-symbols-outlined text-[16px]">system_update</span>
                        View Course Update
                    </button>` : ''}
                    ${payId ? `
                    <button onclick="event.stopPropagation(); window.openPaymentConfirmation('${course.serial_id || 'XXXX'}', '${payId}', '${new Date(payDate || enr.enrolled_at || Date.now()).toISOString()}')"
                        class="w-full py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-xs flex items-center gap-2 justify-center hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-700">
                        <span class="material-symbols-outlined text-[16px]">receipt_long</span>
                        Receipt
                    </button>` : ''}
                </div>
            </div>
        </div>
    </div>
    `;
}

async function loadCourseWishlist() {
    await ensureSession();
    if (!currentUserSession?.user) return;

    const wishlistContainer = document.getElementById('wishlist-container');
    const wishlistEmptyState = document.getElementById('wishlist-empty-state');
    
    if (wishlistContainer) {
        wishlistContainer.innerHTML = `
            <div class="w-full mt-2" aria-busy="true">
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-6">
                    ${Array(3).fill(`
                    <div class="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-sm border border-slate-100 dark:border-slate-700/50 flex flex-col h-[400px] animate-pulse">
                        <div class="h-40 bg-slate-200 dark:bg-slate-700 w-full shrink-0"></div>
                        <div class="p-5 flex-1 flex flex-col justify-between">
                            <div>
                                <div class="flex justify-between mb-3"><div class="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/4"></div><div class="h-3 bg-slate-200 dark:bg-slate-700 rounded w-16"></div></div>
                                <div class="h-5 bg-slate-200 dark:bg-slate-700 rounded w-4/5 mb-4"></div>
                                <div class="flex items-center gap-2 mb-6"><div class="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700"></div><div class="h-3 bg-slate-200 dark:bg-slate-700 w-20 rounded"></div></div>
                            </div>
                            <div class="h-8 bg-slate-200 dark:bg-slate-700 rounded w-full mb-4"></div>
                            <div class="flex justify-between pt-4 border-t border-slate-100 dark:border-slate-700/50">
                                <div class="h-4 bg-slate-200 dark:bg-slate-700 rounded w-16"></div>
                                <div class="h-5 bg-slate-200 dark:bg-slate-700 rounded w-12"></div>
                            </div>
                        </div>
                    </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // First get the wishlisted course IDs
    const { data: wishlistedIds, error: wErr } = await supabase
        .from('wishlist')
        .select('course_id')
        .eq('student_id', currentUserSession.user.id);
        
    if (!wishlistedIds || wishlistedIds.length === 0) {
        wishlistContainer.innerHTML = '';
        wishlistContainer.appendChild(wishlistEmptyState);
        return;
    }

    const courseIds = wishlistedIds.map(w => w.course_id);

    // Fetch full course details using the marketplace view so we get all aggregated metrics
    const { data: wishlistedCourses, error: cErr } = await supabase
        .from('course_marketplace_view')
        .select('*')
        .in('id', courseIds);

    if (!wishlistedCourses || wishlistedCourses.length === 0) {
        wishlistContainer.innerHTML = '';
        wishlistContainer.appendChild(wishlistEmptyState);
        return;
    }
    
    wishlistContainer.innerHTML = '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-6"></div>';
    const grid = wishlistContainer.querySelector('.grid');
    
    let html = '';
    wishlistedCourses.forEach(course => {
        const categoryName = course.category_name || 'Course';
        const instructorName = course.instructor_name || 'Expert Instructor';
        const rating = course.average_rating || 0;
        const fullStars = Math.floor(rating);
        const hasHalfStar = rating % 1 >= 0.5;
        let starsHtml = '';
        for (let i = 1; i <= 5; i++) {
            if (i <= fullStars) starsHtml += '<span class="material-icons-outlined text-xs">star</span>';
            else if (i === fullStars + 1 && hasHalfStar) starsHtml += '<span class="material-icons-outlined text-xs">star_half</span>';
            else starsHtml += '<span class="material-icons-outlined text-xs text-gray-300">star</span>';
        }
        const favIcon = 'favorite';
        const favColor = 'text-red-500 dark:text-red-500';
        
        let badgeHtml = '';
        if (course.is_bestseller) {
             badgeHtml = `<div class="absolute top-3 left-3"><div class="px-2.5 py-1 rounded bg-amber-400 text-black text-[10px] font-bold uppercase tracking-wider shadow-md">Bestseller</div></div>`;
        }
        
        let bannerHtml = '';
        if (course.banner_text) {
             bannerHtml = `<div class="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/30 dark:to-orange-900/30 border-y border-amber-200/50 dark:border-amber-700/50 px-4 py-2 flex gap-2 items-center"><span class="material-symbols-outlined text-amber-500 text-sm shrink-0">campaign</span><p class="text-[11px] font-bold text-amber-900 dark:text-amber-100 line-clamp-2 leading-tight">${course.banner_text}</p></div>`;
        }

        html += `
            <div onclick="window.location.href='/src/pages/marketplace/course-details/index.html?id=${encodeURIComponent(course.id)}'"
                class="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden shadow-sm hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 group border border-gray-100 dark:border-gray-700/50 hover:border-primary/30 cursor-pointer flex flex-col h-full">
                
                <!-- Thumbnail Section -->
                <div class="relative overflow-hidden shrink-0 aspect-[16/10]">
                    <img alt="${course.title}"
                        class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                        src="${course.thumbnail_url || 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800&q=80'}" />
                    
                    <!-- Hover Overlay -->
                    <div class="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div class="w-12 h-12 rounded-full bg-primary/90 text-white flex items-center justify-center shadow-lg transform scale-75 group-hover:scale-100 transition-transform">
                            <span class="material-icons-outlined">play_arrow</span>
                        </div>
                    </div>

                    <div class="absolute top-3 right-3">
                        <button onclick="event.stopPropagation(); window.removeFromWishlist('${course.id}');"
                            class="w-9 h-9 rounded-full bg-white/95 dark:bg-black/60 backdrop-blur-md flex items-center justify-center ${favColor} hover:text-red-500 transition-all shadow-sm active:scale-90">
                            <span class="material-icons-outlined text-base">${favIcon}</span>
                        </button>
                    </div>
                    
                    ${badgeHtml}
                </div>
                
                ${bannerHtml}

                <!-- Content Section -->
                <div class="p-5 flex-1 flex flex-col">
                    <!-- Category & Title -->
                    <div class="flex items-center justify-between mb-3">
                        <span class="text-[10px] font-bold uppercase tracking-widest text-primary/80 dark:text-primary/90">${categoryName}</span>
                        ${course.level === 'Beginner' ? `
                            <span class="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                <span class="material-icons-outlined text-[12px]">signal_cellular_alt_1_bar</span>Beg</span>` :
                          course.level === 'Intermediate' ? `
                            <span class="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                                <span class="material-icons-outlined text-[12px]">signal_cellular_alt_2_bar</span>Int</span>` :
                          course.level === 'Expert' ? `
                            <span class="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                                <span class="material-icons-outlined text-[12px]">signal_cellular_alt</span>Exp</span>` :
                          `<span class="text-[10px] font-bold uppercase tracking-wider text-gray-500">${course.level || ''}</span>`
                        }
                    </div>

                    <h3 class="font-bold text-gray-900 dark:text-white mb-4 line-clamp-2 leading-tight text-lg group-hover:text-primary transition-colors">
                        ${course.title}</h3>

                    <div class="flex items-center gap-2 mb-6">
                        <div class="relative">
                            <img src="${course.instructor_avatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(instructorName) + '&background=random'}"
                                 class="w-6 h-6 rounded-full object-cover ring-2 ring-white dark:ring-gray-800"
                                 alt="${instructorName}">
                        </div>
                        <span class="text-xs font-medium text-gray-500 dark:text-gray-400 line-clamp-1">${instructorName}</span>
                    </div>

                    <!-- Metadata Bar -->
                    <div class="flex items-center justify-between py-2.5 px-3 rounded-xl bg-gray-50 dark:bg-gray-900/50 border border-gray-100/50 dark:border-gray-800/50 mb-6 group-hover:bg-primary/5 transition-colors">
                        <div class="flex items-center gap-1.5 min-w-0">
                            <span class="material-icons-outlined text-blue-500 text-sm shrink-0">menu_book</span>
                            <span class="text-[11px] font-semibold text-gray-700 dark:text-gray-300 truncate">${course.total_lessons || 0} Les.</span>
                        </div>
                        
                        <span class="text-gray-300 dark:text-gray-700 mx-1 flex items-center">
                            <span class="material-icons-outlined text-[10px]">chevron_right</span>
                        </span>

                        <div class="flex items-center gap-1.5 min-w-0">
                            <span class="material-icons-outlined text-amber-500 text-sm shrink-0">quiz</span>
                            <span class="text-[11px] font-semibold text-gray-700 dark:text-gray-300 truncate">${course.total_quizzes || 0} Quiz</span>
                        </div>

                        <span class="text-gray-300 dark:text-gray-700 mx-1 flex items-center">
                            <span class="material-icons-outlined text-[10px]">chevron_right</span>
                        </span>

                        <div class="flex items-center gap-1.5 min-w-0">
                            <span class="material-icons-outlined text-emerald-500 text-sm shrink-0">attachment</span>
                            <span class="text-[11px] font-semibold text-gray-700 dark:text-gray-300 truncate">${course.total_resources || 0} Res.</span>
                        </div>
                    </div>

                    <!-- Footer: Rating and Price -->
                    <div class="mt-auto pt-4 border-t border-gray-100 dark:border-gray-700/50 flex items-center justify-between">
                        <div class="flex items-center gap-1.5">
                            <div class="flex text-amber-400 text-[10px]">${starsHtml}</div>
                            <span class="text-[11px] font-bold text-gray-900 dark:text-gray-100">${rating.toFixed(1)}</span>
                        </div>
                        <div class="flex flex-col items-end">
                            <span class="text-lg font-black text-gray-900 dark:text-white leading-none">
                                ${course.price_type === 'free' ? 'Free' : '$' + (course.price || 0).toFixed(2)}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
    grid.innerHTML = html;
}

async function loadMentorWishlist() {
    await ensureSession();
    if (!currentUserSession?.user) return;

    const wishlistContainer = document.getElementById('wishlist-container');
    const wishlistEmptyState = document.getElementById('wishlist-empty-state');
    
    if (wishlistContainer) {
        wishlistContainer.innerHTML = `
            <div class="w-full mt-2" aria-busy="true">
                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pt-6">
                    ${Array(3).fill(`
                    <div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-5 flex flex-col h-[340px] animate-pulse">
                         <div class="flex items-start justify-between mb-4">
                             <div class="w-16 h-16 rounded-2xl bg-slate-200 dark:bg-slate-800"></div>
                             <div class="flex gap-4">
                                 <div class="w-12 h-8 rounded bg-slate-200 dark:bg-slate-800 mt-2"></div>
                                 <div class="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-800 mt-2"></div>
                             </div>
                         </div>
                         <div class="mb-4">
                             <div class="h-5 bg-slate-200 dark:bg-slate-800 rounded w-1/2 mb-2"></div>
                             <div class="h-3 bg-slate-200 dark:bg-slate-800 rounded w-3/4 mb-1"></div>
                             <div class="h-3 bg-slate-200 dark:bg-slate-800 rounded w-5/6"></div>
                         </div>
                         <div class="flex gap-2 mb-6"><div class="h-4 bg-slate-200 dark:bg-slate-800 rounded w-16"></div><div class="h-4 bg-slate-200 dark:bg-slate-800 rounded w-16"></div></div>
                         <div class="grid grid-cols-2 gap-3 mb-5 py-4 border-y border-slate-50 dark:border-slate-800"><div class="h-8 bg-slate-200 dark:bg-slate-800 rounded"></div><div class="h-8 bg-slate-200 dark:bg-slate-800 rounded"></div></div>
                         <div class="mt-auto h-10 bg-slate-200 dark:bg-slate-800 rounded-xl w-full"></div>
                    </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    const wishlisted = await MentorService.getStudentWishlist(currentUserSession.user.id);
    
    if (!wishlisted || wishlisted.length === 0) {
        wishlistContainer.innerHTML = '';
        wishlistContainer.appendChild(wishlistEmptyState);
    } else {
        wishlistContainer.innerHTML = '<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pt-6"></div>';
        const grid = wishlistContainer.querySelector('.grid');
        
        let html = '';
        wishlisted.forEach(mentor => {
            const isBoosted = mentor._boost_order !== undefined && mentor._boost_order !== 999999;
            const boostRing = isBoosted ? 'boosted-card' : '';
            const roleBadge = isBoosted 
                ? `<div class="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-1 border border-amber-200 dark:border-amber-500/30"><span class="material-symbols-outlined text-[10px]">stars</span> Sponsored</div>`
                : `<div class="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase tracking-widest border border-slate-200 dark:border-slate-700">Top Mentor</div>`;
            const expertiseTags = mentor.expertise?.slice(0, 2).map(exp => 
                `<span class="px-2.5 py-1 rounded-lg bg-primary/5 text-primary text-[10px] font-bold uppercase tracking-wider">${exp}</span>`
            ).join('') || '';

            const favIcon = 'favorite';
            const favColor = 'text-red-500 dark:text-red-500';

            const formatResp = (hours) => {
                if (!hours || hours === 0) return '0h 0m';
                const h = Math.floor(hours);
                const m = Math.round((hours - h) * 60);
                const s = Math.round(((hours - h) * 60 - m) * 60);
                if (h > 0) return `${h}h ${m > 0 ? m + 'm' : ''}`;
                if (m > 0) return `${m}m ${s > 0 ? s + 's' : ''}`;
                return `${s}s`;
            };

            let bannerHtml = '';
            if (mentor.banner_text) {
                bannerHtml = `<div class="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/30 dark:to-orange-900/30 border-t border-amber-200/50 dark:border-amber-700/50 px-4 py-2 mt-auto mb-4 flex gap-2 items-center mx-[-20px]"><span class="material-symbols-outlined text-amber-500 text-[14px] shrink-0">campaign</span><p class="text-[10px] font-bold text-amber-900 dark:text-amber-100 line-clamp-1 leading-tight">${mentor.banner_text}</p></div>`;
            } else {
                bannerHtml = `<div class="mt-auto mb-4"></div>`;
            }

            html += `
                <div onclick="window.location.href='/src/pages/mentorship/mentor-profile/index.html?id=${mentor.instructor_id}'"
                     class="group bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-5 hover:shadow-xl hover:shadow-slate-200/50 dark:hover:shadow-none transition-all duration-300 flex flex-col h-full cursor-pointer relative ${boostRing}">
                    
                    <div class="flex items-start justify-between mb-4">
                        <div class="relative cursor-pointer shrink-0">
                            <div class="absolute -top-3 -left-3">${roleBadge}</div>
                            <img src="${mentor.avatar_url || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(mentor.full_name) + '&background=random&color=fff'}" 
                                 class="w-16 h-16 rounded-2xl object-cover ring-4 ring-slate-50 dark:ring-slate-800 text-[10px] italic mt-3">
                            <div class="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 border-4 border-white dark:border-slate-900 rounded-full"></div>
                        </div>
                        <div class="flex items-start gap-4">
                            <div class="flex flex-col items-end mt-2">
                                <div class="flex items-center gap-1 text-amber-500 mb-0.5">
                                    <span class="material-symbols-outlined text-[16px] fill-current">star</span>
                                    <span class="text-xs font-bold leading-none">${mentor.rating || '0.0'}</span>
                                </div>
                                <div class="text-primary text-right">
                                    <span class="text-sm font-black">$${mentor.hourly_rate || 0}</span>
                                    <span class="text-[9px] font-bold uppercase tracking-tighter opacity-60 block mt-[-4px]">/hr</span>
                                </div>
                            </div>
                            <button onclick="event.stopPropagation(); window.removeMentorFromWishlist('${mentor.instructor_id}');" 
                                    class="w-10 h-10 rounded-full border border-slate-100 dark:border-slate-800/60 bg-slate-50 dark:bg-slate-800 flex items-center justify-center hover:shadow hover:bg-white dark:hover:bg-slate-700 transition-all active:scale-95 ${favColor} shrink-0 mt-2">
                                <span class="material-symbols-outlined ms-fav-icon text-[20px]" style="font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24">${favIcon}</span>
                            </button>
                        </div>
                    </div>

                    <div class="mb-4">
                        <div class="flex items-center gap-2 mb-1">
                            <h3 class="text-base font-bold text-slate-900 dark:text-white group-hover:text-primary transition-colors line-clamp-1">${mentor.full_name}</h3>
                            ${mentor.country ? `<span class="text-[10px] text-slate-400">📍 ${mentor.country}</span>` : ''}
                        </div>
                        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed h-10 overflow-hidden mt-1">${mentor.short_bio || 'Expert mentor ready to guide you.'}</p>
                    </div>

                    <div class="flex flex-wrap gap-2 mb-4">
                        ${expertiseTags}
                        ${mentor.expertise?.length > 2 ? `<span class="text-[10px] font-bold text-slate-400 self-center">+${mentor.expertise.length - 2} more</span>` : ''}
                    </div>

                    <div class="grid grid-cols-2 gap-3 mb-5 py-4 border-y border-slate-50 dark:border-slate-800">
                        <div class="flex items-center gap-2">
                            <div class="w-8 h-8 rounded-lg bg-slate-50 dark:bg-slate-800 flex items-center justify-center">
                                <span class="material-symbols-outlined text-slate-400 text-[18px]">history</span>
                            </div>
                            <div>
                                <p class="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Sessions</p>
                                <p class="text-xs font-bold text-slate-700 dark:text-slate-200">${mentor.completed_sessions ?? mentor.total_sessions ?? 0}</p>
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <div class="w-8 h-8 rounded-lg bg-slate-50 dark:bg-slate-800 flex items-center justify-center">
                                <span class="material-symbols-outlined text-slate-400 text-[18px]">bolt</span>
                            </div>
                            <div>
                                <p class="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Response</p>
                                <p class="text-xs font-bold text-slate-700 dark:text-slate-200">${formatResp(mentor.avg_response_time)}</p>
                            </div>
                        </div>
                    </div>

                    ${bannerHtml}

                    <a href="/src/pages/mentorship/mentor-profile/index.html?id=${mentor.instructor_id}" 
                       class="mt-auto block w-full py-3 rounded-xl bg-slate-900 dark:bg-primary text-white text-center text-sm font-bold hover:bg-primary dark:hover:bg-primary/90 transition-all shadow-lg shadow-slate-200 dark:shadow-none" onclick="event.stopPropagation()">
                        View Profile
                    </a>
                </div>
            `;
        });
        grid.innerHTML = html;
    }
}

async function loadWishlist() {
    if (window.currentWishlistSubTab === 'mentors') {
        await loadMentorWishlist();
    } else {
        await loadCourseWishlist();
    }
}

window.currentWishlistSubTab = 'courses';
window.switchWishlistTab = function(tabId) {
    window.currentWishlistSubTab = tabId;
    const btnCourses = document.getElementById('subtab-wishlist-courses');
    const btnMentors = document.getElementById('subtab-wishlist-mentors');
    
    if (tabId === 'courses') {
        if(btnCourses) btnCourses.className = 'px-5 py-2.5 text-sm font-bold bg-primary text-white rounded-xl transition-all shadow-lg shadow-primary/20';
        if(btnMentors) btnMentors.className = 'px-5 py-2.5 text-sm font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all border border-transparent';
    } else {
        if(btnCourses) btnCourses.className = 'px-5 py-2.5 text-sm font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all border border-transparent';
        if(btnMentors) btnMentors.className = 'px-5 py-2.5 text-sm font-bold bg-primary text-white rounded-xl transition-all shadow-lg shadow-primary/20';
    }
    loadWishlist();
};

let currentMentorshipSubTab = 'upcoming';

window.switchMentorshipSubTab = function(tabId) {
    currentMentorshipSubTab = tabId;
    loadMentors();
};

async function loadMentors(forceRefresh = false) {
    const mentorsContent = document.getElementById('content-my-mentors');
    
    // Inject loading spinner immediately
    if (mentorsContent) {
        mentorsContent.innerHTML = `
            <div class="flex items-center justify-center py-20 px-4">
                <div class="animate-spin inline-block w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full"></div>
            </div>
        `;
    }

    try {
        await ensureSession();
        if (!currentUserSession?.user) return;
        
        const now = new Date();
        const nowTime = now.getTime();

        // Fix Lagging: Use cached sessions unless forceRefresh is true or cache is stale
        if (forceRefresh || !allMentorshipSessions || (nowTime - lastMentorshipFetch > MENTORSHIP_CACHE_TTL)) {
            allMentorshipSessions = await MentorService.getStudentSessions(currentUserSession.user.id);
            lastMentorshipFetch = nowTime;
        }

        const sessions = allMentorshipSessions;
        
        if (!sessions || sessions.length === 0) {
            mentorsContent.innerHTML = `
                <div class="flex flex-col items-center justify-center py-20 px-4 text-center">
                    <div class="w-24 h-24 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-6 text-slate-400">
                        <span class="material-symbols-outlined text-5xl">person_search</span>
                    </div>
                    <h3 class="text-2xl font-bold text-slate-900 dark:text-white mb-2">No Mentors Yet</h3>
                    <p class="text-slate-500 dark:text-slate-400 max-w-sm mb-8">You haven't booked any mentorship sessions yet. Find a mentor to guide your learning journey.</p>
                    <button onclick="window.location.href='/src/pages/marketplace/marketplace/'"
                        class="bg-primary hover:bg-purple-600 text-white font-semibold py-3 px-8 rounded-lg shadow-lg shadow-primary/20 transition-all flex items-center gap-2">
                        <span class="material-symbols-outlined">search</span>
                        Browse Mentors
                    </button>
                </div>
            `;
            return;
        }

        const upcomingSessions = sessions.filter(s => {
            const status = s.booking_status || s.status;
            let end;
            if (s.mentorship_type === 'program' && s.end_date) {
                end = new Date(s.end_date);
                end.setHours(23, 59, 59, 999);
            } else {
                const start = new Date(s.scheduled_at);
                const duration = s.duration_minutes || 60;
                end = new Date(start.getTime() + duration * 60000);
            }
            // Programs still within end_date stay in Upcoming only if they are confirmed
            const isProgramStillActive = s.mentorship_type === 'program' && s.end_date && now < end && status === 'confirmed';
            return isProgramStillActive || ((status === 'confirmed' || status === 'upcoming') && now < end);
        });
        const historySessions = sessions.filter(s => {
            const status = s.booking_status || s.status;
            let end;
            if (s.mentorship_type === 'program' && s.end_date) {
                end = new Date(s.end_date);
                end.setHours(23, 59, 59, 999);
            } else {
                const start = new Date(s.scheduled_at);
                const duration = s.duration_minutes || 60;
                end = new Date(start.getTime() + duration * 60000);
            }
            // Don't put a program in history if it's still within its end_date
            const isProgramStillActive = s.mentorship_type === 'program' && s.end_date && now < end && status !== 'cancelled';
            if (isProgramStillActive) return false;
            return ['completed', 'cancelled'].includes(status) || ((status === 'confirmed' || status === 'upcoming') && now >= end);
        });

        // "Active Requests" captures all other states (pending, negotiating, link pending, etc.)
        const pendingSessions = sessions.filter(s => !upcomingSessions.includes(s) && !historySessions.includes(s));

        // Updated: Removed auto-switching of tabs to allow viewing empty states as requested.

        const renderSessionCard = (session, isHistory = false) => {
            const date = new Date(session.scheduled_at);
            const duration = session.duration_minutes || 60;
            // Meeting slot end — always duration-based, never program end_date
            const meetingSlotEnd = new Date(date.getTime() + duration * 60000);
            // Legacy endDate for rendering time range only
            const endDate = meetingSlotEnd;
            const isCompleted = now >= meetingSlotEnd;
            const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            const startTimeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            const endTimeStr = meetingSlotEnd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            
            const mentor = session.mentor || {};
            const bookingStatus = session.booking_status || session.status || 'pending_review';

            let statusLabel = 'Pending';
            let statusColor = "bg-amber-100 dark:bg-amber-900/30 text-amber-600";
            let actionHtml = '';
            let cardBg = "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800";
            // For programs: use isMeetingLive from shared helper; for single sessions: use slot times
            const progStatus = session.mentorship_type === 'program' ? getProgramMeetingStatus(session) : null;
            const isStarted = progStatus ? progStatus.isMeetingLive : (now >= date && now < meetingSlotEnd);
            const showNextMeeting = progStatus && !progStatus.isMeetingLive && progStatus.nextMeetingLabel && now >= progStatus.meetingSlotEnd;

            if (bookingStatus === 'pending_payment') {
                statusLabel = "Awaiting Payment";
                statusColor = "bg-orange-100 dark:bg-orange-900/30 text-orange-600";
                actionHtml = `
                    <a href="/src/pages/mentorship/mentor-booking/index.html?id=${session.mentor_id}&resumeSession=${session.id}" class="flex-1 px-4 py-2.5 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 transition-all text-sm flex items-center gap-2 justify-center">
                        <span class="material-symbols-outlined text-[18px]">payment</span> Complete Payment
                    </a>
                `;
            } else if (bookingStatus === 'paid_waiting_review') {
                statusLabel = "Paid \u00b7 Pending Review";
                statusColor = "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600";
            } else if (bookingStatus === 'pending_review' || bookingStatus === 'pending') {
                statusLabel = "Awaiting Approval";
            } else if (bookingStatus === 'pending_rejection_review') {
                statusColor = "bg-red-100 dark:bg-red-900/30 text-red-600";
                statusLabel = "Admin Reviewing Rejection";
            } else if (bookingStatus === 'awaiting_meeting_link') {
                statusColor = "bg-blue-100 dark:bg-blue-900/30 text-blue-600";
                statusLabel = "Accepted — Link Pending";
            } else if (bookingStatus === 'location_negotiation' || bookingStatus === 'negotiating') {
                statusColor = "bg-purple-100 dark:bg-purple-900/30 text-purple-600";
                statusLabel = "Negotiating Location";
            } else if (bookingStatus === 'confirmed' || bookingStatus === 'upcoming') {

                if (isStarted) {
                    statusColor = "bg-emerald-500 text-white animate-pulse shadow-lg shadow-emerald-500/20";
                    statusLabel = "Session Started";
                } else if (showNextMeeting) {
                    statusColor = "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600";
                    statusLabel = `Next: ${progStatus.nextMeetingLabel}`;
                } else if (isCompleted && !progStatus) {
                    statusColor = "bg-slate-100 dark:bg-slate-800 text-slate-500";
                    statusLabel = "Completed";
                } else {
                    statusColor = "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600";
                    statusLabel = "Confirmed";
                }
                
                if (!isHistory && session.meeting_type === 'online' && session.meeting_link) {
                    const isValidLink = typeof MentorService !== 'undefined' && MentorService.isValidMeetingLink 
                        ? MentorService.isValidMeetingLink(session.meeting_link)
                        : true; // fallback if loaded out of order
                    
                    if (isValidLink) {
                        actionHtml = `
                            <button onclick="window.open('${session.meeting_link}', '_blank', 'noopener,noreferrer')" class="flex-1 px-4 py-2.5 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 transition-all text-sm whitespace-nowrap flex items-center gap-2 justify-center shadow-lg shadow-emerald-500/20">
                                <span class="material-symbols-outlined text-[18px]">videocam</span> Join Meeting
                            </button>
                        `;
                    } else {
                        actionHtml = `
                            <button disabled class="flex-1 px-4 py-2.5 bg-red-500 text-white font-bold rounded-xl text-sm whitespace-nowrap flex items-center gap-2 justify-center opacity-80 cursor-not-allowed shadow-sm shadow-red-500/20" title="Meeting link is broken or insecure">
                                <span class="material-symbols-outlined text-[18px]">broken_image</span> Broken Link
                            </button>
                        `;
                    }
                }
            } else if (bookingStatus === 'completed') {
                statusColor = "bg-slate-100 dark:bg-slate-800 text-slate-500";
                statusLabel = "Completed";
            } else if (bookingStatus === 'cancelled') {
                statusColor = "bg-red-500 text-white";
                statusLabel = "Cancelled";
                cardBg = "bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-900/30";
                actionHtml = `
                    <button onclick='window.deleteSession("${session.id}")' class="flex-1 px-4 py-2.5 bg-white dark:bg-slate-800 text-red-600 font-black rounded-xl hover:bg-red-50 transition-all text-sm flex items-center gap-2 justify-center border-2 border-red-100 dark:border-red-900/30">
                        <span class="material-symbols-outlined text-[18px]">delete</span> Remove
                    </button>
                `;
            }

            const locationHtml = session.meeting_type === 'in-person' && session.meeting_location ? `
                <div class="flex items-center gap-3 w-48 shrink-0">
                    <div class="w-10 h-10 bg-slate-50 dark:bg-slate-800 rounded-xl flex items-center justify-center text-primary shrink-0">
                        <span class="material-symbols-outlined text-xl">location_on</span>
                    </div>
                    <div class="min-w-0">
                        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Location</p>
                        <p class="font-bold text-slate-900 dark:text-white text-sm truncate" title="${session.meeting_location}">${session.meeting_location}</p>
                    </div>
                </div>` : '';

            const isProgram = session.mentorship_type === 'program';
            if (isProgram) {
                cardBg = "bg-amber-50/20 dark:bg-amber-900/10 border-amber-200 dark:border-amber-900/30 shadow-md shadow-amber-500/5";
            }
            const programHtml = buildProgramProgressHtml(session);

            return `
                <div class="${cardBg} border rounded-2xl p-4 sm:p-6 hover:shadow-lg transition-all group ${isHistory && bookingStatus !== 'cancelled' ? 'opacity-80 grayscale-[0.3] hover:grayscale-0' : ''} anim-fade-in relative">
                    ${isProgram ? `<div class="absolute top-2 right-2 sm:top-4 sm:right-4 z-10"><div class="px-1.5 py-0.5 sm:px-2.5 sm:py-1 bg-gradient-to-r from-amber-200 to-yellow-400 text-amber-900 rounded-full text-[8px] sm:text-[10px] font-black uppercase tracking-widest flex items-center gap-1 shadow-sm"><span class="material-symbols-outlined text-[10px] sm:text-[14px]">workspace_premium</span> Program<span class="hidden sm:inline"> Mentorship</span></div></div>` : ''}
                    <div class="flex flex-col md:flex-row gap-4 md:gap-6 lg:gap-8 items-start md:items-center relative z-0 mt-3 md:mt-0">
                        <div class="flex items-center gap-3 sm:gap-4 w-full md:w-72 shrink-0">
                            <a href="/src/pages/instructor/public-profile/index.html?id=${session.mentor_id}" class="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl overflow-hidden border-2 border-primary/20 shrink-0 shadow-sm transition-transform hover:scale-110 block" title="View Public Profile">
                                <img src="${mentor.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(mentor.full_name || 'M')}&background=random&color=fff`}" class="w-full h-full object-cover" />
                            </a>
                            <div class="flex-1 min-w-0">
                                <a href="/src/pages/instructor/public-profile/index.html?id=${session.mentor_id}" class="block group/name" title="View Public Profile">
                                    <h4 class="font-bold text-lg text-slate-900 dark:text-white group-hover/name:text-primary transition-colors truncate pr-8 md:pr-0">${mentor.full_name || 'Mentor'}</h4>
                                </a>
                                <div class="flex flex-wrap items-center gap-2 mt-1">
                                    <span class="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-[10px] font-bold text-slate-500 uppercase tracking-wider">${session.meeting_type}</span>
                                    <span class="px-2 py-0.5 ${statusColor} rounded text-[10px] font-bold uppercase tracking-wider">${statusLabel}</span>
                                    ${session.reschedule_requested_by ? `<span class="px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-500 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1"><span class="material-symbols-outlined text-[12px]">edit_calendar</span> Rescheduled</span>` : ''}
                                </div>
                            </div>
                        </div>
                        
                        <div class="flex-1 flex flex-wrap items-center gap-x-6 sm:gap-x-10 gap-y-3 sm:gap-y-4 md:px-6 lg:px-8 border-t md:border-t-0 md:border-l border-slate-100 dark:border-slate-800 pt-3 md:pt-0 min-w-0 w-full md:w-auto">
                            <div class="flex items-center gap-2 sm:gap-3 w-40 sm:w-48 shrink-0">
                                <div class="w-8 h-8 sm:w-10 sm:h-10 bg-slate-50 dark:bg-slate-800 rounded-xl flex items-center justify-center text-primary shrink-0">
                                    <span class="material-symbols-outlined text-xl">event</span>
                                </div>
                                <div class="min-w-0">
                                    <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Schedule</p>
                                    <p class="font-bold text-slate-900 dark:text-white text-sm whitespace-nowrap">${dateStr}</p>
                                    <p class="text-[11px] font-bold text-primary">${startTimeStr} - ${endTimeStr}</p>
                                </div>
                            </div>
                            ${locationHtml}
                            <div class="flex-1 min-w-[180px]">
                                <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Topic</p>
                                <div class="flex items-center justify-between gap-3 mt-1">
                                    <p class="font-medium text-slate-600 dark:text-slate-400 text-sm line-clamp-1 flex-1" title="${(session.topic || 'Mentorship Session').replace(/"/g, '&quot;')}">${session.topic || 'Mentorship Session'}</p>
                                    <button onclick="openTopicModal('${(mentor.full_name || 'Mentor').replace(/'/g, "\\'")}', this.dataset.topic)" data-topic="${(session.topic || 'Mentorship Session').replace(/"/g, '&quot;')}" class="shrink-0 w-8 h-8 flex items-center justify-center bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-primary rounded-lg transition-all"><span class="material-symbols-outlined text-lg">open_in_full</span></button>
                                </div>
                            </div>
                        </div>

                        <div class="w-full md:w-fit flex flex-col sm:flex-row md:flex-col gap-2 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-800 shrink-0">
                            ${actionHtml}
                            <div class="flex gap-2">
                                ${bookingStatus !== 'cancelled' ? `
                                <button onclick='window.openMessagingModal("${session.id}", "${(mentor.full_name || 'Mentor').replace(/'/g, "\\'")}")' class="flex-1 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-all text-sm flex items-center gap-2 justify-center">
                                    <span class="material-symbols-outlined text-[18px]">forum</span>
                                </button>
                                ${isHistory && (bookingStatus === 'completed' || (bookingStatus === 'confirmed' && isCompleted)) ? `
                                    <button onclick="window.location.href='/src/pages/mentorship/mentor-booking/confirmation.html?sessionId=${session.id}'" class="flex-1 px-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-50 transition-all text-sm whitespace-nowrap flex items-center gap-2 justify-center">
                                        <span class="material-symbols-outlined text-[18px]">receipt_long</span> Details
                                    </button>
                                    <button onclick='window.openReviewModal("${mentor.id || session.mentor_id}", "${(mentor.full_name || 'Mentor').replace(/'/g, "\\'")}")' class="flex-1 px-4 py-2.5 bg-amber-500 text-white font-bold rounded-xl hover:bg-amber-600 transition-all text-sm flex items-center gap-2 justify-center shadow-lg shadow-amber-500/20">
                                        <span class="material-symbols-outlined text-[18px]">star</span> Review
                                    </button>
                                ` : (bookingStatus !== 'cancelled' ? `
                                    <button onclick="window.location.href='/src/pages/mentorship/mentor-booking/confirmation.html?sessionId=${session.id}'" class="flex-1 px-5 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-50 transition-all text-sm whitespace-nowrap">
                                        Details
                                    </button>
                                ` : '')}
                                ` : ''}
                            </div>
                        </div>
                    </div>
                    ${programHtml}
                </div>
            `;
        };

        // Surgical Update to prevent flickering
        let navContainer = mentorsContent.querySelector('.mentorship-sub-nav');
        let contentContainer = document.getElementById('mentorship-tab-content');

        if (!navContainer || !contentContainer) {
            mentorsContent.innerHTML = `
                <div class="flex flex-col gap-5 pt-6">
                    <div class="mentorship-sub-nav flex overflow-x-auto no-scrollbar gap-2 sm:gap-3 p-1.5 bg-slate-100/50 dark:bg-slate-800/30 rounded-2xl w-full max-w-fit">
                        <button id="subtab-active" onclick="switchMentorshipSubTab('active')" class="shrink-0"></button>
                        <button id="subtab-upcoming" onclick="switchMentorshipSubTab('upcoming')" class="shrink-0"></button>
                        <button id="subtab-history" onclick="switchMentorshipSubTab('history')" class="shrink-0"></button>
                    </div>
                    <div id="mentorship-tab-content" class="grid grid-cols-1 gap-6"></div>
                </div>
            `;
            navContainer = mentorsContent.querySelector('.mentorship-sub-nav');
            contentContainer = document.getElementById('mentorship-tab-content');
        }

        const activeSubBtnClass = "px-4 py-2 sm:px-6 sm:py-3 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/20 transition-all flex items-center gap-1.5 sm:gap-2 text-xs sm:text-base whitespace-nowrap shrink-0";
        const inactiveSubBtnClass = "px-4 py-2 sm:px-6 sm:py-3 bg-transparent hover:bg-white dark:hover:bg-slate-800 text-slate-500 font-bold rounded-xl transition-all flex items-center gap-1.5 sm:gap-2 text-xs sm:text-base whitespace-nowrap shrink-0 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 hover:shadow-sm";

        // Update button states and counts without re-rendering the entire nav bar
        const updateButton = (id, label, count, icon, tabKey) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.className = currentMentorshipSubTab === tabKey ? activeSubBtnClass : inactiveSubBtnClass;
            btn.innerHTML = `
                <span class="material-symbols-outlined text-[16px] sm:text-[20px]">${icon}</span>
                ${label}
                ${count > 0 ? `<span class="ml-0.5 sm:ml-1 px-1.5 sm:px-2 py-0.5 ${currentMentorshipSubTab === tabKey ? 'bg-white/20' : 'bg-slate-200 dark:bg-slate-700 text-slate-600'} rounded-md text-[9px] sm:text-[10px]">${count}</span>` : ''}
            `;
        };

        updateButton('subtab-active', 'Active Requests', pendingSessions.length, 'pending_actions', 'active');
        updateButton('subtab-upcoming', 'Upcoming', upcomingSessions.length, 'event_upcoming', 'upcoming');
        updateButton('subtab-history', 'History', historySessions.length, 'history', 'history');

        let activeSessions = [];
        let emptyMessage = "No sessions found.";
        let emptyIcon = "event_busy";

        if (currentMentorshipSubTab === 'active') {
            activeSessions = pendingSessions;
            emptyMessage = "You don't have any active requests at the moment.";
            emptyIcon = "browse_gallery";
        } else if (currentMentorshipSubTab === 'upcoming') {
            activeSessions = upcomingSessions;
            emptyMessage = "No upcoming sessions. Time to book a mentor!";
            emptyIcon = "calendar_today";
        } else if (currentMentorshipSubTab === 'history') {
            activeSessions = historySessions;
            emptyMessage = "Your session history is currently empty.";
            emptyIcon = "history_toggle_off";
        }

        // Apply smooth transition by toggling animation class
        contentContainer.classList.remove('anim-fade-in');
        void contentContainer.offsetWidth; // Trigger reflow to restart animation
        contentContainer.classList.add('anim-fade-in');

        if (activeSessions.length === 0) {
            contentContainer.innerHTML = `
                <div class="flex flex-col items-center justify-center py-20 px-4 text-center">
                    <div class="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-3xl flex items-center justify-center mb-6 text-slate-300">
                        <span class="material-symbols-outlined text-4xl">${emptyIcon}</span>
                    </div>
                    <h4 class="text-xl font-bold text-slate-400">${emptyMessage}</h4>
                    <button onclick="window.location.href='/src/pages/marketplace/marketplace/'" class="mt-6 px-6 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold rounded-xl hover:text-primary transition-all flex items-center gap-2">
                        Browse Mentors <span class="material-symbols-outlined text-sm">arrow_forward</span>
                    </button>
                </div>
            `;
        } else {
            contentContainer.innerHTML = activeSessions.map(s => renderSessionCard(s, currentMentorshipSubTab === 'history')).join('');
        }

    } catch (err) {
        console.error("Error loading student mentors:", err);
        mentorsContent.innerHTML = `<div class="p-10 text-center text-red-500 rounded-2xl bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30">Failed to load mentorship sessions.</div>`;
    }
}

window.deleteSession = async function(sessionId) {
    if (!confirm("Are you sure you want to remove this cancelled session from your dashboard? This action cannot be undone.")) return;
    try {
        await MentorService.deleteSession(sessionId);
        await loadMentors(true); // Force refresh cache
    } catch (err) {
        alert("Failed to delete session: " + err.message);
    }
}

/** MESSAGING LOGIC **/
let currentMessageBookingId = null;

let _chatPollInterval = null;
let _lastRenderedMessageId = null;
let _isTyping = false;
let _typingTimeout = null;

function renderChatMessages(messages, myRole) {
    if (messages.length === 0) {
        return `<div class="flex flex-col items-center justify-center h-full text-center py-20 px-8">
            <span class="material-symbols-outlined text-slate-200 dark:text-slate-700 text-7xl mb-4">chat_bubble</span>
            <h4 class="font-bold text-slate-400">No messages yet</h4>
            <p class="text-sm text-slate-400 max-w-[200px] mt-2">Start the conversation with your mentor here.</p>
        </div>`;
    }
    return messages.map(msg => {
        const isMe = msg.sender_role === myRole;
        const senderAvatar = msg.sender?.avatar_url
            || `https://ui-avatars.com/api/?name=${encodeURIComponent(msg.sender?.full_name || (isMe ? 'Me' : 'Them'))}&background=random&color=fff`;
        const timeStr = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const avatarHtml = `<img src="${senderAvatar}" class="w-8 h-8 rounded-full object-cover shrink-0 shadow-sm" title="${msg.sender?.full_name || ''}" />`;
        return `
            <div class="flex items-end gap-2 ${isMe ? 'justify-end' : 'justify-start'}">
                ${!isMe ? avatarHtml : ''}
                <div class="max-w-[85%] p-3.5 rounded-2xl text-sm leading-relaxed ${isMe
                    ? 'bg-primary text-white rounded-tr-none shadow-lg shadow-primary/20'
                    : 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-tl-none shadow-sm shadow-black/5'}">
                    <p>${msg.message_text}</p>
                    <p class="text-[10px] mt-1.5 opacity-60 font-medium">${timeStr}</p>
                </div>
                ${isMe ? avatarHtml : ''}
            </div>`;
    }).join('');
}

function appendTypingIndicatorStudent(container) {
    const existing = container.querySelector('#typing-indicator-row');
    if (existing) existing.remove();
    if (!_isTyping) return;
    const row = document.createElement('div');
    row.id = 'typing-indicator-row';
    row.className = 'flex items-end gap-2 justify-end';
    row.innerHTML = `<div class="px-4 py-2.5 bg-primary/10 rounded-2xl rounded-tr-none">
        <span class="text-[11px] text-primary font-medium flex items-center gap-1.5">
            <span class="inline-flex gap-0.5">
                <span class="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:0ms]"></span>
                <span class="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:150ms]"></span>
                <span class="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:300ms]"></span>
            </span>
            Typing…
        </span>
    </div>`;
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
}

/** REVIEW LOGIC **/
let currentReviewMentorId = null;
let currentRating = 0;

window.openReviewModal = function(mentorId, mentorName) {
    currentReviewMentorId = mentorId;
    currentRating = 0;
    const modal = document.getElementById('mentorship-review-modal');
    const nameLabel = document.getElementById('review-mentor-name');
    const stars = modal.querySelectorAll('.star-btn');
    const comment = document.getElementById('review-comment');

    nameLabel.innerText = mentorName;
    comment.value = '';
    stars.forEach(s => s.classList.remove('text-amber-400', 'bg-amber-50', 'dark:bg-amber-900/20'));

    modal.classList.remove('hidden');
};

window.openMessagingModal = async function(bookingId, mentorName) {

    currentMessageBookingId = bookingId;
    const modal = document.getElementById('booking-message-modal');
    const container = document.getElementById('chat-history-container');
    const nameLabel = document.getElementById('modal-mentor-name');

    nameLabel.innerText = mentorName;
    modal.classList.remove('hidden');
    container.innerHTML = '<div class="py-20 text-center"><div class="animate-spin inline-block w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full"></div></div>';

    if (_chatPollInterval) { clearInterval(_chatPollInterval); _chatPollInterval = null; }
    _lastRenderedMessageId = null;

    const loadMessages = async (isFirstLoad = false) => {
        try {
            const messages = await MentorService.getMessages(bookingId);
            const latestId = messages.length ? messages[messages.length - 1].id : null;
            if (latestId === _lastRenderedMessageId && !isFirstLoad) return;
            _lastRenderedMessageId = latestId;
            const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
            container.innerHTML = renderChatMessages(messages, 'student');
            appendTypingIndicatorStudent(container);
            if (atBottom || isFirstLoad) container.scrollTop = container.scrollHeight;
        } catch { /* silent poll failure */ }
    };

    await loadMessages(true);

    _chatPollInterval = setInterval(() => {
        if (document.getElementById('booking-message-modal')?.classList.contains('hidden')) {
            clearInterval(_chatPollInterval); _chatPollInterval = null;
        } else {
            loadMessages();
        }
    }, 4000);
};

document.addEventListener('DOMContentLoaded', () => {
    // Messaging interactions
    const sendBtn = document.getElementById('send-chat-btn');
    const chatInput = document.getElementById('chat-input');

    if (chatInput) {
        chatInput.addEventListener('input', () => {
            _isTyping = true;
            const container = document.getElementById('chat-history-container');
            appendTypingIndicatorStudent(container);
            clearTimeout(_typingTimeout);
            _typingTimeout = setTimeout(() => {
                _isTyping = false;
                const row = document.getElementById('typing-indicator-row');
                if (row) row.remove();
            }, 2000);
        });
        chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn?.click(); } });
    }

    if (sendBtn) {
        sendBtn.onclick = async () => {
            const text = chatInput.value.trim();
            if (!text || !currentMessageBookingId) return;

            try {
                sendBtn.disabled = true;
                _isTyping = false;
                clearTimeout(_typingTimeout);
                const session = await AuthService.getSession();
                const userId = session?.user?.id;

                if (!userId) {
                    throw new Error("You must be logged in to send messages.");
                }

                await MentorService.sendMessage(currentMessageBookingId, userId, text, 'student');
                chatInput.value = '';
                _lastRenderedMessageId = null;
                await window.openMessagingModal(currentMessageBookingId, document.getElementById('modal-mentor-name').innerText);
            } catch (err) {
                alert('Failed to send message: ' + err.message);
            } finally {
                sendBtn.disabled = false;
            }
        };
    }



    // Review interactions
    const stars = document.querySelectorAll('.star-btn');
    stars.forEach(btn => {
        btn.onclick = () => {
            currentRating = parseInt(btn.dataset.rating);
            stars.forEach(s => {
                const r = parseInt(s.dataset.rating);
                if (r <= currentRating) {
                    s.classList.add('text-amber-400', 'bg-amber-50', 'dark:bg-amber-900/20');
                    s.classList.remove('text-slate-300');
                } else {
                    s.classList.remove('text-amber-400', 'bg-amber-50', 'dark:bg-amber-900/20');
                    s.classList.add('text-slate-300');
                }
            });
        };
    });

    const submitReviewBtn = document.getElementById('submit-review-btn');
    if (submitReviewBtn) {
        submitReviewBtn.onclick = async () => {
            if (currentRating === 0) {
                alert('Please select a rating.');
                return;
            }
            
            const comment = document.getElementById('review-comment').value.trim();
            const session = await AuthService.getSession();
            const userId = session?.user?.id;
            
            if (!userId) {
                window.showToast('You must be logged in to submit a review.', 'error');
                return;
            }
            
            try {
                submitReviewBtn.disabled = true;
                submitReviewBtn.innerText = 'Submitting...';
                await MentorService.submitReview(currentReviewMentorId, userId, currentRating, comment);
                window.showToast('Thank you for your feedback!', 'success');
                document.getElementById('mentorship-review-modal').classList.add('hidden');
            } catch (err) {
                window.showToast('Failed to submit review: ' + err.message, 'error');
            } finally {
                submitReviewBtn.disabled = false;
                submitReviewBtn.innerText = 'Submit Review';
            }
        };
    }
});

async function loadBeginnerCourses() {
    const { data: beginnerCourses, error } = await supabase
        .from('course_marketplace_view')
        .select('*')
        .eq('level', 'Beginner')
        .limit(3);

    const newStudentSection = document.getElementById('new-student-section');
    if (!beginnerCourses || beginnerCourses.length === 0) return;

    // Add a container for beginner courses if it doesn't exist
    let coursesContainer = document.getElementById('beginner-courses-recommendations');
    if (!coursesContainer) {
        const div = document.createElement('div');
        div.id = 'beginner-courses-recommendations';
        div.className = 'mt-12 grid grid-cols-1 md:grid-cols-3 gap-6';
        newStudentSection.appendChild(div);
        coursesContainer = div;
    }

    let html = '<div class="col-span-full border-b border-primary/20 pb-4 mb-4"><h3 class="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-purple-400">Popular Beginner Courses</h3></div>';
    
    beginnerCourses.forEach(course => {
        html += `
        <div onclick="window.location.href='/src/pages/marketplace/course-details/index.html?id=${encodeURIComponent(course.id)}'"
            class="flex flex-col group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden hover:shadow-xl transition-all duration-300 cursor-pointer h-full relative">
            <div class="aspect-video relative overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0">
                <img src="${course.thumbnail_url || 'https://placehold.co/600x400'}" alt="${course.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                <div class="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition-colors"></div>
            </div>
            <div class="p-5 flex flex-col flex-1">
                <div class="flex items-center gap-2 mb-3 shrink-0">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary">Beginner</span>
                </div>
                <h4 class="font-bold text-slate-900 dark:text-white mb-2 line-clamp-2 leading-snug group-hover:text-primary transition-colors flex-1">${course.title}</h4>
                <div class="flex items-center justify-between pt-4 mt-auto border-t border-slate-50 dark:border-slate-800/50">
                    <span class="font-bold text-slate-900 dark:text-white">${course.price_type === 'free' ? 'Free' : '$' + (course.price || 0).toFixed(2)}</span>
                    <button class="text-primary font-bold text-xs uppercase tracking-widest flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                        Detail <span class="material-symbols-outlined text-sm">arrow_forward</span>
                    </button>
                </div>
            </div>
        </div>
        `;
    });
    coursesContainer.innerHTML = html;
}

window.removeFromWishlist = async function(courseId) {
    await ensureSession();
    if (!currentUserSession?.user) return;
    await supabase.from('wishlist').delete().eq('course_id', courseId).eq('student_id', currentUserSession.user.id);
    loadWishlist();
};

window.removeMentorFromWishlist = async function(mentorId) {
    await ensureSession();
    if (!currentUserSession?.user) return;
    try {
        await MentorService.toggleWishlist(mentorId, currentUserSession.user.id);
        await loadWishlist();
    } catch (e) {
        console.error(e);
    }
};

window.enrollCourse = async function(courseId) {
    await ensureSession();
    if (!currentUserSession?.user) return;
    await supabase.from('enrollments').insert({ student_id: currentUserSession.user.id, course_id: courseId, progress_percentage: 0 });
    window.removeFromWishlist(courseId); // Remove from wishlist internally
    await loadMyCourses();
    window.location.href = '/src/pages/learning/learning-interface/index.html?course=' + encodeURIComponent(courseId);
};

document.addEventListener('DOMContentLoaded', initDashboard);
