import { supabase } from '/src/services/supabaseClient.js';
import { AuthService } from '/src/services/authService.js';
import { MentorService } from '/src/services/mentorService.js';

let currentUserSession = null;
let currentProfile = null;
let allMentorshipSessions = null;
let lastMentorshipFetch = 0;
const MENTORSHIP_CACHE_TTL = 60000; // 1 minute

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
            btn.className = "pb-4 text-primary font-semibold border-b-2 border-primary flex items-center gap-2 transition-colors";
        } else {
            btn.className = "pb-4 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-medium flex items-center gap-2 border-b-2 border-transparent transition-colors";
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

    await loadMyCourses();
    await loadWishlist();
    await loadMentors();
}

async function loadMyCourses() {
    await ensureSession();
    if (!currentUserSession?.user) return;

    const { data: enrollments, error } = await supabase
        .from('enrollments')
        .select('*, courses(*, course_categories(*), instructor:profiles(*))')
        .eq('student_id', currentUserSession.user.id);
    
    const continueSection = document.getElementById('continue-learning-section');
    const newStudentSection = document.getElementById('new-student-section');
    const enrolledCoursesGrid = document.getElementById('enrolled-courses-grid');
    const welcomeMsg = document.getElementById('dashboard-welcome-msg');
    const emptyState = document.getElementById('global-courses-empty-state');
    
    if (!enrollments || enrollments.length === 0) {
        continueSection.classList.add('hidden');
        newStudentSection.classList.remove('hidden');
        enrolledCoursesGrid.classList.add('hidden');
        emptyState.classList.remove('hidden');
        if (welcomeMsg) welcomeMsg.textContent = "Start your learning journey by exploring our beginner-friendly courses.";
        
        // Fetch and show beginner courses in new student section
        await loadBeginnerCourses();
    } else {
        newStudentSection.classList.add('hidden');
        continueSection.classList.remove('hidden');
        enrolledCoursesGrid.classList.remove('hidden');
        emptyState.classList.add('hidden');

        // Sort by most recently accessed (updated_at)
        enrollments.sort((a,b) => {
            const dateA = new Date(a.updated_at || a.enrolled_at);
            const dateB = new Date(b.updated_at || b.enrolled_at);
            return dateB - dateA;
        });

        const activeEnrollments = enrollments.filter(e => (e.progress_percentage || 0) < 100);
        const completedEnrollments = enrollments.filter(e => (e.progress_percentage || 0) === 100);
        
        if (welcomeMsg) {
            if (activeEnrollments.length > 0) {
                welcomeMsg.textContent = `Welcome back! You're making great progress in ${activeEnrollments.length} courses.`;
                
                // Populate Continue Learning Section with the most recent course
                const latest = activeEnrollments[0];
                const course = latest.courses;
                if (course) {
                    continueSection.innerHTML = `
                    <div class="bg-gradient-to-r from-indigo-600 to-primary rounded-3xl p-6 md:p-8 text-white shadow-xl shadow-primary/20 relative overflow-hidden group cursor-pointer" onclick="window.location.href='/src/pages/learning/learning-interface/index.html?course=${course.id}'">
                        <div class="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32 blur-3xl group-hover:scale-110 transition-transform duration-700"></div>
                        <div class="relative z-10 flex flex-col md:flex-row items-center gap-6 md:gap-8">
                            <div class="w-full md:w-1/3 aspect-video rounded-2xl overflow-hidden shadow-2xl shrink-0">
                                <img src="${course.thumbnail_url || 'https://placehold.co/600x400'}" alt="${course.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                            </div>
                            <div class="flex-1 text-center md:text-left">
                                <div class="flex items-center justify-center md:justify-start gap-2 mb-4">
                                    <span class="px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-[10px] font-bold uppercase tracking-widest">Resume Learning</span>
                                    <span class="px-3 py-1 bg-amber-400/20 backdrop-blur-md rounded-full text-[10px] font-bold uppercase tracking-widest text-amber-200">Active</span>
                                </div>
                                <h2 class="text-2xl md:text-3xl font-extrabold mb-4 tracking-tight line-clamp-2">${course.title}</h2>
                                <div class="flex flex-col sm:flex-row items-center gap-6 mt-6">
                                    <div class="w-full sm:w-48">
                                        <div class="flex justify-between text-[11px] mb-2 text-indigo-100 font-bold uppercase tracking-wider">
                                            <span>Progress</span>
                                            <span>${latest.progress_percentage || 0}%</span>
                                        </div>
                                        <div class="w-full bg-white/20 rounded-full h-2 overflow-hidden backdrop-blur-sm">
                                            <div class="bg-white h-full rounded-full transition-all duration-1000" style="width: ${latest.progress_percentage || 0}%"></div>
                                        </div>
                                    </div>
                                    <button class="px-6 py-3 bg-white text-indigo-600 rounded-xl font-bold hover:bg-slate-50 transition-all flex items-center gap-2 shadow-lg shadow-black/10 group-hover:translate-x-1">
                                        Continue <span class="material-symbols-outlined font-bold">play_arrow</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    `;
                    continueSection.classList.remove('hidden');
                }
            } else {
                welcomeMsg.textContent = `Congratulations! You've completed all your enrolled courses. Ready for something new?`;
                continueSection.classList.add('hidden');
            }
        }

        // Render active courses grid
        let activeHtml = '';
        activeEnrollments.forEach(enr => {
            activeHtml += renderCourseCard(enr);
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
            completedHtml += renderCourseCard(enr);
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

function renderCourseCard(enr) {
    const course = enr.courses;
    if(!course) return '';
    const category = course.categories ? course.categories.name : 'Course';
    const progress = enr.progress_percentage || 0;
    
    return `
    <div class="flex flex-col group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden hover:shadow-xl transition-all duration-300 cursor-pointer h-full" onclick="window.location.href='/src/pages/learning/learning-interface/index.html?course=${encodeURIComponent(course.id)}'">
        <div class="aspect-video relative overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0">
            <img src="${course.thumbnail_url || 'https://placehold.co/600x400'}" alt="${course.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
            <div class="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span class="material-symbols-outlined text-white text-5xl">${progress === 100 ? 'replay' : 'play_circle'}</span>
            </div>
            ${progress === 100 ? `
            <div class="absolute top-3 right-3 bg-emerald-500 text-white px-2 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 shadow-lg">
                <span class="material-symbols-outlined text-[12px]">verified</span> COMPLETED
            </div>
            ` : ''}
        </div>
        <div class="p-5 flex flex-col flex-1">
            <div class="flex items-center gap-2 mb-3 shrink-0">
                <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary">${category}</span>
                ${course.serial_id ? `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700 font-mono">CRS-${course.serial_id}</span>` : ''}
            </div>
            <h4 class="font-bold text-slate-900 dark:text-white mb-4 line-clamp-2 min-h-[3rem] group-hover:text-primary transition-colors shrink-0">${course.title}</h4>
            <div class="space-y-3 mt-auto shrink-0">
                <div class="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                    <span>${progress === 100 ? 'Course Finished' : 'Your Progress'}</span>
                    <span class="font-bold">${progress}%</span>
                </div>
                <div class="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div class="${progress === 100 ? 'bg-emerald-500' : 'bg-primary'} h-full rounded-full transition-all duration-1000" style="width: ${progress}%"></div>
                </div>
            </div>
        </div>
    </div>
    `;
}

async function loadWishlist() {
    await ensureSession();
    if (!currentUserSession?.user) return;

    const { data: wishlisted, error } = await supabase
        .from('wishlist')
        .select('*, courses(*, instructor:profiles!courses_instructor_id_fkey(*), categories:course_categories!courses_category_id_fkey(*))')
        .eq('student_id', currentUserSession.user.id);

    const wishlistContainer = document.getElementById('wishlist-container');
    const wishlistEmptyState = document.getElementById('wishlist-empty-state');
    
    if (!wishlisted || wishlisted.length === 0) {
        wishlistContainer.innerHTML = '';
        wishlistContainer.appendChild(wishlistEmptyState);
    } else {
        wishlistContainer.innerHTML = '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-6"></div>';
        const grid = wishlistContainer.querySelector('.grid');
        
        wishlisted.forEach(w => {
            const course = w.courses;
            if(!course) return;
            const instructorName = course.instructor ? course.instructor.full_name : 'Instructor';
            const category = course.categories ? course.categories.name : 'Course';
            const price = Number(course.price) === 0 ? 'Free' : '$' + Number(course.price).toFixed(2);
            const ratingDisplay = '4.5';
            
            const html = `
                <div onclick="window.location.href='/src/pages/marketplace/course-details/index.html?id=${encodeURIComponent(course.id)}'"
                    class="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 group border border-slate-200 dark:border-slate-700 hover:border-primary/50 cursor-pointer flex flex-col relative">
                    <button onclick="event.stopPropagation(); window.removeFromWishlist('${course.id}');" 
                        class="absolute top-3 right-3 z-10 w-8 h-8 bg-white/90 dark:bg-slate-800/90 backdrop-blur-md rounded-full flex items-center justify-center text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 transition-all shadow-sm">
                        <span class="material-symbols-outlined text-[18px]">favorite</span>
                    </button>
                    <div class="relative aspect-video">
                        <img alt="${course.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" src="${course.thumbnail_url || 'https://placehold.co/600x400'}" />
                    </div>
                    <div class="p-5 flex flex-col flex-1">
                        <div class="text-xs text-primary font-bold uppercase tracking-widest mb-2">${category}</div>
                        <h3 class="font-bold text-slate-900 dark:text-white mb-2 line-clamp-2 leading-snug group-hover:text-primary transition-colors">${course.title}</h3>
                        <p class="text-sm text-slate-500 mb-4">${instructorName}</p>
                        <div class="flex items-center gap-1 mb-4 mt-auto">
                            <span class="font-bold text-sm text-yellow-500">${ratingDisplay}</span>
                            <div class="flex text-yellow-400">
                                <span class="material-symbols-outlined text-[14px]">star</span>
                            </div>
                            <span class="text-xs text-slate-400">(0)</span>
                        </div>
                        <div class="flex items-center justify-between border-t border-slate-100 dark:border-slate-700 pt-4 mt-2">
                            <span class="text-lg font-bold text-slate-900 dark:text-white">${price}</span>
                            <button onclick="event.stopPropagation(); window.enrollCourse('${course.id}');" 
                                class="px-4 py-2 bg-primary/10 text-primary hover:bg-primary font-medium hover:text-white rounded-lg transition-colors text-sm">
                                Enroll Now
                            </button>
                        </div>
                    </div>
                </div>
            `;
            grid.insertAdjacentHTML('beforeend', html);
        });
    }
}

let currentMentorshipSubTab = 'upcoming';

window.switchMentorshipSubTab = function(tabId) {
    currentMentorshipSubTab = tabId;
    loadMentors();
};

async function loadMentors(forceRefresh = false) {
    const mentorsContent = document.getElementById('content-my-mentors');
    
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
            const start = new Date(s.scheduled_at);
            const duration = s.duration_minutes || 60;
            const end = new Date(start.getTime() + duration * 60000);
            return (status === 'confirmed' || status === 'upcoming') && now < end;
        });
        const historySessions = sessions.filter(s => {
            const status = s.booking_status || s.status;
            const start = new Date(s.scheduled_at);
            const duration = s.duration_minutes || 60;
            const end = new Date(start.getTime() + duration * 60000);
            return ['completed', 'cancelled'].includes(status) || ((status === 'confirmed' || status === 'upcoming') && now >= end);
        });

        // "Active Requests" captures all other states (pending, negotiating, link pending, etc.)
        const pendingSessions = sessions.filter(s => !upcomingSessions.includes(s) && !historySessions.includes(s));

        // Updated: Removed auto-switching of tabs to allow viewing empty states as requested.

        const renderSessionCard = (session, isHistory = false) => {
            const date = new Date(session.scheduled_at);
            const duration = session.duration_minutes || 60;
            const endDate = new Date(date.getTime() + duration * 60000);
            const isCompleted = now >= endDate;
            const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            const startTimeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            const endTimeStr = endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            
            const mentor = session.mentor || {};
            const bookingStatus = session.booking_status || session.status || 'pending_review';

            let statusLabel = 'Pending';
            let statusColor = "bg-amber-100 dark:bg-amber-900/30 text-amber-600";
            let actionHtml = '';
            let cardBg = "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800";

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
                const isStarted = now >= date && now < endDate;

                if (isStarted) {
                    statusColor = "bg-emerald-500 text-white animate-pulse shadow-lg shadow-emerald-500/20";
                    statusLabel = "Session Started";
                } else if (isCompleted) {
                    statusColor = "bg-slate-100 dark:bg-slate-800 text-slate-500";
                    statusLabel = "Completed";
                } else {
                    statusColor = "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600";
                    statusLabel = "Confirmed";
                }
                
                if (!isHistory && session.meeting_type === 'online' && session.meeting_link) {
                    actionHtml = `
                        <a href="${session.meeting_link}" target="_blank" class="flex-1 px-4 py-2.5 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 transition-all text-sm whitespace-nowrap flex items-center gap-2 justify-center shadow-lg shadow-emerald-500/20">
                            <span class="material-symbols-outlined text-[18px]">videocam</span> Join Meeting
                        </a>
                    `;
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

            return `
                <div class="${cardBg} border rounded-2xl p-6 hover:shadow-lg transition-all group ${isHistory && bookingStatus !== 'cancelled' ? 'opacity-80 grayscale-[0.3] hover:grayscale-0' : ''} anim-fade-in">
                    <div class="flex flex-col md:flex-row gap-8 items-center">
                        <div class="flex items-center gap-4 w-full md:w-72 shrink-0">
                            <a href="/src/pages/instructor/public-profile/index.html?id=${session.mentor_id}" class="w-16 h-16 rounded-2xl overflow-hidden border-2 border-primary/20 shrink-0 shadow-sm transition-transform hover:scale-110 block" title="View Public Profile">
                                <img src="${mentor.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(mentor.full_name || 'M')}&background=random&color=fff`}" class="w-full h-full object-cover" />
                            </a>
                            <div class="flex-1 min-w-0">
                                <a href="/src/pages/instructor/public-profile/index.html?id=${session.mentor_id}" class="block group/name" title="View Public Profile">
                                    <h4 class="font-bold text-lg text-slate-900 dark:text-white group-hover/name:text-primary transition-colors truncate">${mentor.full_name || 'Mentor'}</h4>
                                </a>
                                <div class="flex flex-wrap items-center gap-2 mt-1">
                                    <span class="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-[10px] font-bold text-slate-500 uppercase tracking-wider">${session.meeting_type}</span>
                                    <span class="px-2 py-0.5 ${statusColor} rounded text-[10px] font-bold uppercase tracking-wider">${statusLabel}</span>
                                    ${session.serial_id ? `<span class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest bg-slate-50 dark:bg-slate-800/10 text-slate-400 border border-slate-200 dark:border-slate-700 font-mono">SES-${session.serial_id}</span>` : ''}
                                </div>
                            </div>
                        </div>
                        
                        <div class="flex-1 flex flex-wrap items-center gap-x-10 gap-y-4 md:px-8 border-t md:border-t-0 md:border-l border-slate-100 dark:border-slate-800 pt-4 md:pt-0 min-w-0">
                            <div class="flex items-center gap-3 w-48 shrink-0">
                                <div class="w-10 h-10 bg-slate-50 dark:bg-slate-800 rounded-xl flex items-center justify-center text-primary shrink-0">
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

                        <div class="w-full md:w-fit flex flex-col sm:flex-row md:flex-col gap-2 pt-4 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-800">
                            ${actionHtml}
                            <div class="flex gap-2">
                                ${bookingStatus !== 'cancelled' ? `
                                <button onclick='window.openMessagingModal("${session.id}", "${(mentor.full_name || 'Mentor').replace(/'/g, "\\'")}")' class="flex-1 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-all text-sm flex items-center gap-2 justify-center">
                                    <span class="material-symbols-outlined text-[18px]">forum</span>
                                </button>
                                ` : ''}
                                ${isHistory && (bookingStatus === 'completed' || (bookingStatus === 'confirmed' && isCompleted)) ? `
                                    <button onclick='window.openReviewModal("${mentor.id || session.mentor_id}", "${(mentor.full_name || 'Mentor').replace(/'/g, "\\'")}")' class="flex-1 px-4 py-2.5 bg-amber-500 text-white font-bold rounded-xl hover:bg-amber-600 transition-all text-sm flex items-center gap-2 justify-center shadow-lg shadow-amber-500/20">
                                        <span class="material-symbols-outlined text-[18px]">star</span> Review
                                    </button>
                                ` : (bookingStatus !== 'cancelled' ? `
                                    <button onclick="window.location.href='/src/pages/mentorship/mentor-booking/confirmation.html?sessionId=${session.id}'" class="flex-1 px-5 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-50 transition-all text-sm whitespace-nowrap">
                                        Details
                                    </button>
                                ` : '')}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        };

        // Surgical Update to prevent flickering
        let navContainer = mentorsContent.querySelector('.mentorship-sub-nav');
        let contentContainer = document.getElementById('mentorship-tab-content');

        if (!navContainer || !contentContainer) {
            mentorsContent.innerHTML = `
                <div class="flex flex-col gap-8 pt-6">
                    <div class="mentorship-sub-nav flex flex-wrap gap-3 p-1.5 bg-slate-100/50 dark:bg-slate-800/30 rounded-2xl w-fit">
                        <button id="subtab-active" onclick="switchMentorshipSubTab('active')"></button>
                        <button id="subtab-upcoming" onclick="switchMentorshipSubTab('upcoming')"></button>
                        <button id="subtab-history" onclick="switchMentorshipSubTab('history')"></button>
                    </div>
                    <div id="mentorship-tab-content" class="grid grid-cols-1 gap-6"></div>
                </div>
            `;
            navContainer = mentorsContent.querySelector('.mentorship-sub-nav');
            contentContainer = document.getElementById('mentorship-tab-content');
        }

        const activeSubBtnClass = "px-6 py-3 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/20 transition-all flex items-center gap-2";
        const inactiveSubBtnClass = "px-6 py-3 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all flex items-center gap-2";

        // Update button states and counts without re-rendering the entire nav bar
        const updateButton = (id, label, count, icon, tabKey) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.className = currentMentorshipSubTab === tabKey ? activeSubBtnClass : inactiveSubBtnClass;
            btn.innerHTML = `
                <span class="material-symbols-outlined text-[20px]">${icon}</span>
                ${label}
                ${count > 0 ? `<span class="ml-1 px-2 py-0.5 ${currentMentorshipSubTab === tabKey ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'} rounded-md text-[10px]">${count}</span>` : ''}
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

window.openMessagingModal = async function(bookingId, mentorName) {
    currentMessageBookingId = bookingId;
    const modal = document.getElementById('booking-message-modal');
    const container = document.getElementById('chat-history-container');
    const nameLabel = document.getElementById('modal-mentor-name');
    
    nameLabel.innerText = mentorName;
    modal.classList.remove('hidden');
    container.innerHTML = '<div class="py-20 text-center"><div class="animate-spin inline-block w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full"></div></div>';
    
    try {
        const messages = await MentorService.getMessages(bookingId);
        if (messages.length === 0) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-center py-20 px-8">
                    <span class="material-symbols-outlined text-slate-200 dark:text-slate-700 text-7xl mb-4">chat_bubble</span>
                    <h4 class="font-bold text-slate-400">No messages yet</h4>
                    <p class="text-sm text-slate-400 max-w-[200px] mt-2">Start the conversation with your mentor here.</p>
                </div>
            `;
        } else {
            container.innerHTML = messages.map(msg => {
                const isStudent = msg.sender_role === 'student';
                return `
                    <div class="flex ${isStudent ? 'justify-end' : 'justify-start'}">
                        <div class="max-w-[85%] p-4 rounded-2xl ${isStudent ? 'bg-primary text-white rounded-tr-none shadow-lg shadow-primary/20' : 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-tl-none shadow-sm shadow-black/5'}">
                            <p class="text-sm leading-relaxed">${msg.message_text}</p>
                            <p class="text-[10px] mt-2 opacity-60 font-medium">${new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                        </div>
                    </div>
                `;
            }).join('');
            container.scrollTop = container.scrollHeight;
        }
    } catch (err) {
        container.innerHTML = '<p class="text-red-500 text-center py-10 font-bold">Failed to load chat history.</p>';
    }
};

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

document.addEventListener('DOMContentLoaded', () => {
    // Messaging interactions
    const sendBtn = document.getElementById('send-chat-btn');
    const chatInput = document.getElementById('chat-input');
    
    if (sendBtn) {
        sendBtn.onclick = async () => {
            const text = chatInput.value.trim();
            if (!text || !currentMessageBookingId) return;
            
            try {
                sendBtn.disabled = true;
                const session = await AuthService.getSession();
                const userId = session?.user?.id;
                
                if (!userId) {
                    throw new Error("You must be logged in to send messages.");
                }

                await MentorService.sendMessage(currentMessageBookingId, userId, text, 'student');
                chatInput.value = '';
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
                alert('You must be logged in to submit a review.');
                return;
            }
            
            try {
                submitReviewBtn.disabled = true;
                submitReviewBtn.innerText = 'Submitting...';
                await MentorService.submitReview(currentReviewMentorId, userId, currentRating, comment);
                alert('Thank you for your feedback!');
                document.getElementById('mentorship-review-modal').classList.add('hidden');
            } catch (err) {
                alert('Failed to submit review: ' + err.message);
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

window.enrollCourse = async function(courseId) {
    await ensureSession();
    if (!currentUserSession?.user) return;
    await supabase.from('enrollments').insert({ student_id: currentUserSession.user.id, course_id: courseId, progress_percentage: 0 });
    window.removeFromWishlist(courseId); // Remove from wishlist internally
    await loadMyCourses();
    window.location.href = '/src/pages/learning/learning-interface/index.html?course=' + encodeURIComponent(courseId);
};

document.addEventListener('DOMContentLoaded', initDashboard);
