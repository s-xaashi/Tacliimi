import { supabase } from '/src/services/supabaseClient.js';
import { AuthService } from '/src/services/authService.js';
import { MentorService } from '/src/services/mentorService.js';
import { showToast, showConfirmModal, showAlertModal } from '/src/services/uiUtils.js';
import { buildProgramProgressHtml, getProgramMeetingStatus, openMentorshipRescheduleModal } from '/src/utils/js/mentorshipUI.js';

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


window.triggerAdminReschedule = function(sessionId, currentScheduledAt, currentDurationStr, studentNameStr, historyJson) {
    let history = [];
    try { history = historyJson ? JSON.parse(historyJson) : []; } catch(e) { history = []; }
    openMentorshipRescheduleModal(
        sessionId, currentScheduledAt, currentDurationStr, studentNameStr, 'admin',
        async (id, newDateObj, newDur, note) => {
            const session = await AuthService.getSession();
            if (!session || !session.user) throw new Error("Not logged in");

            const { error } = await supabase.rpc('admin_reschedule_session', {
                p_admin_id: session.user.id,
                p_session_id: id,
                p_new_scheduled_at: newDateObj.toISOString(),
                p_new_duration_minutes: newDur,
                p_note: note || null
            });
            if (error) throw error;
            if (typeof window.location.reload === 'function') setTimeout(() => window.location.reload(), 500);
        },
        history
    );
};

document.addEventListener('DOMContentLoaded', async () => {
    const overviewList = document.getElementById('overview-list');
    const rejectionsList = document.getElementById('rejections-list');
    const loader = document.getElementById('loader');
    const emptyState = document.getElementById('empty-state');
    const rejectionCount = document.getElementById('rejection-count');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    let allSessions = [];
    let currentTab = 'overview';
    let selectedStatus = 'all';
    let selectedType = 'all';
    let startDate = null;
    let endDate = null;

    const LOADER_HTML = `
        <div class="flex flex-col items-center justify-center py-20 gap-4">
            <div class="w-12 h-12 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin"></div>
            <p class="text-slate-400 font-medium font-display animate-pulse">Fetching bookings data...</p>
        </div>
    `;

    const EMPTY_STATE_HTML = `
        <div class="flex flex-col items-center justify-center py-32 text-center">
            <div class="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-3xl flex items-center justify-center mb-6">
                <span class="material-symbols-outlined text-slate-300 text-4xl">event_busy</span>
            </div>
            <h3 class="text-xl font-bold mb-2 text-slate-900 dark:text-white">No Bookings Found</h3>
            <p class="text-slate-500 max-w-sm">No mentorship sessions currently match the selected criteria.</p>
        </div>
    `;

    // 1. Auth Check & Profile
    const profile = await AuthService.getCurrentProfile();
    const avatarEl = document.getElementById('header-avatar') || document.getElementById('admin-avatar');
    // 2. Fetch Data
    const fetchData = async () => {
        // Show loaders in all lists
        overviewList.innerHTML = LOADER_HTML;
        rejectionsList.innerHTML = LOADER_HTML;
        document.getElementById('completed-list').innerHTML = LOADER_HTML;
        
        try {
            // Get session first as it's needed for the RPC
            const session = await AuthService.getSession();
            if (!session || !session.is_admin) {
                throw new Error('Not authenticated as admin.');
            }

            // Fetch data and profile in parallel to save time
            const [dataRes, profileRes] = await Promise.all([
                supabase.rpc('admin_get_all_mentorship_sessions', {
                    p_admin_id: session.user.id
                }),
                AuthService.getCurrentProfile()
            ]);

            if (dataRes.error) throw dataRes.error;
            allSessions = dataRes.data || [];
            
            // Update profile UI if needed
            if (profileRes && avatarEl) {
                avatarEl.src = profileRes.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(profileRes.full_name)}&background=4F46E5&color=fff`;
            }

            renderStats();
            renderTab();
        } catch (err) {
            console.error("Error fetching admin bookings:", err);
            const errorHTML = `<p class="text-red-500 font-bold p-12 text-center">Error: ${err.message}</p>`;
            overviewList.innerHTML = errorHTML;
            rejectionsList.innerHTML = errorHTML;
            document.getElementById('completed-list').innerHTML = errorHTML;
        }
    };

    const renderStats = () => {
        const total = allSessions.length;
        const confirmed = allSessions.filter(s => (s.booking_status || s.status) === 'confirmed').length;
        const pending = allSessions.filter(s => (s.booking_status || s.status) === 'pending_review').length;
        const completed = allSessions.filter(s => (s.booking_status || s.status) === 'completed').length;

        document.getElementById('stat-total').textContent = total;
        document.getElementById('stat-confirmed').textContent = confirmed;
        document.getElementById('stat-pending').textContent = pending;
        document.getElementById('stat-completed').textContent = completed;
    };

    // 3. Rendering
    const renderTab = () => {
        const rejections = allSessions.filter(s => s.booking_status === 'pending_rejection_review');
        
        // Update Rejection Badge
        if (rejections.length > 0) {
            rejectionCount.textContent = rejections.length;
            rejectionCount.classList.remove('hidden');
        } else {
            rejectionCount.classList.add('hidden');
        }

        if (currentTab === 'overview') {
            renderOverview();
        } else if (currentTab === 'completed') {
            renderCompleted();
        } else {
            renderRejections(rejections);
        }
    };

    const renderOverview = () => {
        const now = new Date();
        const activeSessions = allSessions.filter(session => {
            const status = (session.booking_status || session.status || 'pending').toLowerCase();
            const start = new Date(session.scheduled_at);
            const duration = session.duration_minutes || 60;
            let end = new Date(start.getTime() + duration * 60000);
            if (session.mentorship_type === 'program' && session.end_date) {
                end = new Date(session.end_date);
                end.setHours(23, 59, 59, 999);
            }
            
            // For program mentorships, override: if within end_date, it is still active
            // regardless of whether booking_status was prematurely set to 'completed'
            const isProgramStillActive = session.mentorship_type === 'program' 
                && session.end_date 
                && now < end 
                && status !== 'cancelled';

            // Exclude sessions that should be in the "Completed" tab
            const isAutoCompleted = status === 'confirmed' && now >= end;
            const matchesActiveTab = isProgramStillActive || (
                status !== 'cancelled' && status !== 'rejected' && status !== 'completed' && !isAutoCompleted
            );
            
            let matchesStatusFilter = selectedStatus === 'all' || status === selectedStatus;
            // For programs still active despite 'completed' status in DB, match 'confirmed' filter too
            if (isProgramStillActive && selectedStatus === 'confirmed') matchesStatusFilter = true;
            
            // Special handling for legacy "Started" filter
            const isStarted = now >= start && now < end;
            if (selectedStatus === 'started') {
                matchesStatusFilter = isStarted;
            }
            
            let matchesTypeFilter = selectedType === 'all' || (session.mentorship_type || 'single') === selectedType;
            
            return matchesActiveTab && matchesStatusFilter && matchesTypeFilter;
        });

        const overviewPane = document.getElementById('overview-pane');
        overviewPane.classList.remove('hidden');
        overviewList.classList.remove('hidden');

        if (activeSessions.length === 0) {
            overviewList.innerHTML = EMPTY_STATE_HTML;
            return;
        }

        const mentorProfileBase = '/src/pages/instructor/public-profile/index.html';
        const studentProfileBase = '/src/pages/admin/users/index.html';
        const confirmationBase = '/src/pages/mentorship/mentor-booking/confirmation.html';

        overviewList.innerHTML = activeSessions.map(session => {
            // Robust data extraction with fallbacks
            const student = session.student || { 
                full_name: session.student_name || 'Anonymous Student',
                avatar_url: session.student_avatar || null,
                professional_title: 'Student'
            };
            const mentor = session.mentor || { 
                full_name: session.mentor_name || 'Unknown Mentor',
                avatar_url: session.mentor_avatar || null,
                professional_title: 'Instructor'
            };
            
            const start = new Date(session.scheduled_at);
            const duration = session.duration_minutes || 60;
            // Meeting slot end — always duration-based for badge logic
            const meetingSlotEnd = new Date(start.getTime() + duration * 60000);
            // program lifecycle end (for health/filter use only)
            let progEnd = meetingSlotEnd;
            if (session.mentorship_type === 'program' && session.end_date) {
                progEnd = new Date(session.end_date);
                progEnd.setHours(23, 59, 59, 999);
            }

            // isMeetingLive: only true during the actual meeting slot
            const isMeetingLive = now >= start && now < meetingSlotEnd;
            // For program: after slot ends, compute next meeting
            const progStatus = session.mentorship_type === 'program' ? getProgramMeetingStatus(session) : null;
            const isStarted = progStatus ? progStatus.isMeetingLive : isMeetingLive;
            const showNextMeeting = progStatus && !progStatus.isMeetingLive && progStatus.nextMeetingLabel && now >= progStatus.meetingSlotEnd;

            const dateStr = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            // Display end time is always the meeting slot, not program end
            const endStr = meetingSlotEnd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            
            let statusColor = "bg-slate-100 text-slate-600";
            let statusLabel = (session.booking_status || '').replace(/_/g, ' ');
            
            if (isStarted) {
                statusColor = "bg-amber-400 text-white animate-pulse shadow-lg shadow-amber-400/20";
                statusLabel = "Session Started";
            } else if (showNextMeeting) {
                statusColor = "bg-indigo-100 text-indigo-600 border border-indigo-200";
                statusLabel = `Next: ${progStatus.nextMeetingLabel}`;
            } else {
                if (session.booking_status === 'confirmed') statusColor = "bg-emerald-100 text-emerald-600";
                if (session.booking_status === 'pending_review') statusColor = "bg-amber-100 text-amber-600";
                if (session.booking_status === 'paid_waiting_review') statusColor = "bg-indigo-100 text-indigo-600";
                if (session.booking_status === 'pending_rejection_review') statusColor = "bg-red-100 text-red-600";
                if (session.booking_status === 'awaiting_meeting_link') statusColor = "bg-blue-100 text-blue-600";
            }

            const studentAvatar = student.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(student.full_name)}&background=6366f1&color=fff`;
            const mentorAvatar = mentor.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(mentor.full_name)}&background=7c3aed&color=fff`;
            
            let healthHtml = '';
            if (session.mentorship_type === 'program') {
                const dbStartDateStr = session.program_start_date || session.scheduled_at;
                const dbStartDate = new Date(dbStartDateStr);
                const dbDuration = session.duration_days || 30;
                
                const hasStarted = (session.booking_status === 'confirmed' || session.booking_status === 'completed');
                
                let healthColor = 'text-slate-500 bg-slate-100 dark:bg-slate-800';
                let healthIcon = 'schedule';
                let healthLabel = 'Inactive';
                
                if (hasStarted) {
                    const daysElapsed = Math.floor((now.getTime() - dbStartDate.getTime()) / (1000 * 60 * 60 * 24));
                    const progressPct = Math.min(100, Math.round((daysElapsed / dbDuration) * 100));
                    const completedSessions = session.completed_sessions_count || 0;
                    const daysRemaining = Math.max(0, dbDuration - daysElapsed);
                    
                    // Health is time-based: on track if program is progressing normally
                    if (progressPct < 100) {
                        healthColor = 'text-emerald-700 bg-emerald-100 border-emerald-300 dark:bg-emerald-900/40 dark:border-emerald-800';
                        healthIcon = 'vital_signs';
                        healthLabel = `On Track · ${daysRemaining}d left`;
                    } else {
                        healthColor = 'text-blue-700 bg-blue-100 border-blue-300 dark:bg-blue-900/40 dark:border-blue-800';
                        healthIcon = 'done_all';
                        healthLabel = 'Duration Complete';
                    }
                }

                healthHtml = `
                    <div class="flex items-center gap-1 ${healthColor} px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider mt-1.5 border shadow-sm" title="Program Health Indicator">
                        <span class="material-symbols-outlined text-[10px]">${healthIcon}</span> ${healthLabel}
                    </div>
                `;
            }

            const programHtml = buildProgramProgressHtml(session);

            let cardClasses = "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700";
            if (session.mentorship_type === 'program') {
                cardClasses = "bg-amber-50/20 dark:bg-amber-900/10 border-2 border-amber-200 dark:border-amber-900/30 shadow-md shadow-amber-500/5 hover:border-amber-400 dark:hover:border-amber-700";
            }

            return `
                <div class="${cardClasses} rounded-3xl p-6 hover:shadow-xl transition-all duration-300 group relative session-card" data-session-id="${session.id}">
                    ${session.mentorship_type === 'program' ? `<div class="absolute -top-3 right-8 z-10"><div class="px-3 py-1 bg-gradient-to-r from-amber-200 to-yellow-400 text-amber-900 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1 shadow-lg shadow-amber-500/20"><span class="material-symbols-outlined text-[14px]">workspace_premium</span> Program Mentorship</div></div>` : ''}
                    <div class="flex flex-col lg:flex-row items-center justify-between gap-8 mt-2 lg:mt-0">
                        
                        <!-- Connection Flow Container -->
                        <div class="flex items-center justify-between gap-4 md:gap-8 flex-1 w-full max-w-4xl">
                            
                            <!-- Student -->
                            <div class="flex items-center gap-3 md:gap-4 min-w-0 flex-1 cursor-pointer group/profile" 
                                 onclick="event.stopPropagation(); window.openStudentProfile(${JSON.stringify(session.student_profile || student).replace(/"/g, '&quot;')})">
                                <div class="profile-link shrink-0 ring-4 ring-slate-50 dark:ring-slate-800 group-hover/profile:ring-indigo-100 dark:group-hover/profile:ring-indigo-900/30 rounded-2xl overflow-hidden transition-all">
                                    <img src="${studentAvatar}" class="w-12 h-12 md:w-14 md:h-14 object-cover">
                                </div>
                                <div class="min-w-0">
                                    <p class="text-[9px] font-black text-indigo-500 uppercase tracking-widest mb-0.5">Student</p>
                                    <p class="font-bold text-slate-900 dark:text-white truncate block group-hover/profile:text-indigo-600 transition-colors">${escapeHtml(student.full_name || "")}</p>
                                    <div class="flex items-center gap-1.5 mt-1">
                                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                        <p class="text-[10px] text-slate-500 truncate lowercase">${student.email || 'no email'}</p>
                                    </div>
                                </div>
                            </div>

                            <!-- Connector Arrow -->
                            <div class="flex flex-col items-center gap-2 px-2 shrink-0">
                                <div class="flex items-center">
                                    <div class="w-8 md:w-16 h-0.5 bg-gradient-to-r from-indigo-100 to-indigo-400 dark:from-indigo-900/50 dark:to-indigo-500 rounded-full"></div>
                                    <span class="material-symbols-outlined text-indigo-500 text-base -ml-2">chevron_right</span>
                                </div>
                                <span class="px-2 py-0.5 ${statusColor} rounded-full text-[9px] font-black uppercase tracking-tighter whitespace-nowrap border border-current opacity-80 mt-1">
                                    ${statusLabel}
                                </span>
                                ${healthHtml}
                            </div>

                            <!-- Mentor -->
                            <div class="flex items-center gap-3 md:gap-4 min-w-0 flex-1 justify-end text-right">
                                <div class="min-w-0 order-1 md:order-none">
                                    <p class="text-[9px] font-black text-purple-500 uppercase tracking-widest mb-0.5">Mentor</p>
                                    <a href="${mentorProfileBase}?id=${session.mentor_id}"
                                       class="profile-link font-bold text-slate-900 dark:text-white truncate block hover:text-purple-600 transition-colors"
                                       onclick="event.stopPropagation()">${escapeHtml(mentor.full_name || "")}</a>
                                    <div class="flex items-center gap-1.5 mt-1 justify-end">
                                        <p class="text-[10px] text-slate-500 truncate lowercase">${mentor.email || 'no email'}</p>
                                        <span class="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                                    </div>
                                </div>
                                <a href="${mentorProfileBase}?id=${session.mentor_id}"
                                   class="profile-link shrink-0 ring-4 ring-slate-50 dark:ring-slate-800 group-hover:ring-purple-100 dark:group-hover:ring-purple-900/30 rounded-2xl overflow-hidden transition-all order-first md:order-none"
                                   onclick="event.stopPropagation()">
                                    <img src="${mentorAvatar}" class="w-12 h-12 md:w-14 md:h-14 object-cover">
                                </a>
                            </div>
                        </div>

                        <!-- Session Details (Time & Action) -->
                        <div class="flex items-center gap-6 shrink-0 w-full lg:w-auto pt-6 lg:pt-0 border-t lg:border-t-0 border-slate-100 dark:border-slate-800">
                             <div class="flex-1 lg:text-right">
                                 <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Scheduled For</p>
                                 <div class="flex lg:flex-col items-baseline lg:items-end gap-2 lg:gap-0">
                                     <span class="font-bold text-slate-700 dark:text-slate-200 text-sm whitespace-nowrap">${dateStr}</span>
                                     <span class="text-[11px] text-slate-500 font-medium">${timeStr} — ${endStr}</span>
                                 </div>
                             </div>
                             <div class="flex items-center gap-2">
                                 <button onclick="event.stopPropagation(); window.triggerAdminReschedule('${session.id}', '${progStatus && progStatus.nextMeeting ? progStatus.nextMeeting.toISOString() : session.scheduled_at}', '${duration}', '${(student.full_name || 'Student').replace(/'/g, "\\'").replace(/"/g, '&quot;')}', this.dataset.history)" data-history="${JSON.stringify(session.reschedule_history || []).replace(/"/g, '&quot;')}" class="w-10 h-10 rounded-xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center text-slate-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:text-indigo-600 transition-all z-10 relative">
                                     <span class="material-symbols-outlined text-[18px]">edit_calendar</span>
                                 </button>
                                 <div class="w-10 h-10 rounded-xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center text-slate-400 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-900/30 group-hover:text-indigo-600 transition-all">
                                     <span class="material-symbols-outlined">launch</span>
                                 </div>
                             </div>
                        </div>
                    </div>
                    ${programHtml}
                </div>
            `;
        }).join('');

        // Bind card-level click to booking confirmation
        overviewList.querySelectorAll('.session-card').forEach(card => {
            card.onclick = () => window.location.href = `${confirmationBase}?sessionId=${card.dataset.sessionId}`;
        });

        // Highlight focused session if present in URL
        const urlParams = new URLSearchParams(window.location.search);
        const focusSession = urlParams.get('focusSession');
        if (focusSession) {
            setTimeout(() => {
                const targetCard = overviewList.querySelector(`[data-session-id="${focusSession}"]`);
                if (targetCard) {
                    targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    targetCard.classList.add('ring-4', 'ring-indigo-500', 'shadow-2xl', 'scale-[1.02]');
                    setTimeout(() => {
                        targetCard.classList.remove('ring-4', 'ring-indigo-500', 'shadow-2xl', 'scale-[1.02]');
                        // also remove the parameter so it doesn't happen again on refresh
                        const newUrl = new URL(window.location);
                        newUrl.searchParams.delete('focusSession');
                        window.history.replaceState({}, '', newUrl);
                    }, 2500);
                } else {
                    // Try to look in other tabs? Usually the admin clicks in from an active payment, but if not found in active, it might be in completed or rejections.
                }
            }, 300);
        }
    };

    const renderCompleted = () => {
        const completedList = document.getElementById('completed-list');
        const completedPane = document.getElementById('completed-pane');
        
        overviewList.classList.add('hidden');
        rejectionsList.classList.add('hidden');
        completedPane.classList.remove('hidden');

        const now = new Date();
        const completedSessions = allSessions.filter(s => {
            const status = s.booking_status || s.status;
            const start = new Date(s.scheduled_at);
            const duration = s.duration_minutes || 60;
            let end = new Date(start.getTime() + duration * 60000);
            if (s.mentorship_type === 'program' && s.end_date) {
                end = new Date(s.end_date);
                end.setHours(23, 59, 59, 999);
            }

            // If this is a program still within its end_date, it belongs in Active, not Completed
            const isProgramStillActive = s.mentorship_type === 'program'
                && s.end_date
                && now < end
                && status !== 'cancelled';
            if (isProgramStillActive) return false;
            
            const isCompleted = ['completed', 'cancelled'].includes(status) || (status === 'confirmed' && now >= end);
            
            if (!isCompleted) return false;

            // Date filtering
            if (startDate) {
                const sDate = new Date(startDate);
                sDate.setHours(0,0,0,0);
                if (start < sDate) return false;
            }
            if (endDate) {
                const eDate = new Date(endDate);
                eDate.setHours(23,59,59,999);
                if (start > eDate) return false;
            }
            
            return true;
        }).sort((a,b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));

        if (completedSessions.length === 0) {
            completedList.innerHTML = EMPTY_STATE_HTML;
            return;
        }

        const confirmationBase = '/src/pages/mentorship/mentor-booking/confirmation.html';

        completedList.innerHTML = completedSessions.map(session => {
            const student = session.student || { full_name: 'Unknown' };
            const mentor = session.mentor || { full_name: 'Unknown' };
            const start = new Date(session.scheduled_at);
            const duration = session.duration_minutes || 60;
            let end = new Date(start.getTime() + duration * 60000);
            if (session.mentorship_type === 'program' && session.end_date) {
                end = new Date(session.end_date);
                end.setHours(23, 59, 59, 999);
            }

            const dateStr = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            const endStr = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

            const status = session.booking_status || session.status;
            let statusColor = "bg-slate-100 text-slate-500";
            if (status === 'cancelled') statusColor = "bg-red-50 text-red-500";
            if (status === 'confirmed') statusColor = "bg-blue-50 text-blue-500"; // Case where it's past but confirmed

            return `
                <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 hover:shadow-md transition-all cursor-pointer session-card group" data-session-id="${session.id}">
                    <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div class="flex items-center gap-4">
                            <div class="w-12 h-12 rounded-xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center text-slate-400 group-hover:text-primary transition-colors">
                                <span class="material-symbols-outlined">history</span>
                            </div>
                            <div>
                                <h4 class="font-bold text-slate-900 dark:text-white">${escapeHtml(student.full_name || "")} <span class="text-slate-400 font-medium">with</span> ${escapeHtml(mentor.full_name || "")}</h4>
                                <div class="flex items-center gap-3 mt-1">
                                    <span class="text-xs text-slate-500 flex items-center gap-1">
                                        <span class="material-symbols-outlined text-sm">calendar_today</span> ${dateStr}
                                    </span>
                                    <span class="text-xs text-slate-500 flex items-center gap-1">
                                        <span class="material-symbols-outlined text-sm">schedule</span> ${timeStr} — ${endStr}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div class="flex items-center gap-3">
                            <span class="px-3 py-1 ${statusColor} rounded-lg text-[10px] font-black uppercase tracking-widest">
                                ${(status === 'confirmed' || status === 'completed') ? 'Completed' : status.replace(/_/g, ' ')}
                            </span>
                            <span class="material-symbols-outlined text-slate-300 group-hover:text-primary transition-colors">chevron_right</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        completedList.querySelectorAll('.session-card').forEach(card => {
            card.onclick = () => window.location.href = `${confirmationBase}?sessionId=${card.dataset.sessionId}`;
        });
    };

    const renderRejections = (rejections) => {
        rejectionsList.classList.remove('hidden');
        overviewList.classList.add('hidden');

        if (rejections.length === 0) {
            rejectionsList.innerHTML = EMPTY_STATE_HTML;
            return;
        }

        rejectionsList.innerHTML = rejections.map(session => {
            const mentor = session.mentor || { full_name: 'Unknown' };
            const student = session.student || { full_name: 'Unknown' };
            const date = new Date(session.scheduled_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

            return `
                <div class="bg-white dark:bg-slate-900 border-2 border-amber-200 dark:border-amber-900/30 rounded-3xl p-8 flex flex-col gap-6 shadow-xl shadow-amber-500/5">
                    <div class="flex justify-between items-start">
                        <div class="flex items-center gap-4">
                            <div class="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center text-amber-500">
                                <span class="material-symbols-outlined text-3xl">feedback</span>
                            </div>
                            <div>
                                <h4 class="font-black text-lg">Rejection Review</h4>
                                <p class="text-xs text-slate-500">Submitted for: ${date}</p>
                            </div>
                        </div>
                        <span class="px-3 py-1 bg-amber-100 text-amber-700 rounded-lg text-[10px] font-black uppercase tracking-widest">Pending Decision</span>
                    </div>

                    <div class="p-5 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700">
                        <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Mentor's Note</p>
                        <p class="text-slate-700 dark:text-slate-300 italic">"${session.rejection_note || 'No reason provided.'}"</p>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50">
                            <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Mentor Contact</p>
                            <p class="font-bold text-sm truncate">${escapeHtml(mentor.full_name || "")}</p>
                            <p class="text-[11px] text-slate-500 truncate">${mentor.email || 'N/A'}</p>
                            <p class="text-[11px] text-slate-500">${mentor.phone_number || 'N/A'}</p>
                        </div>
                        <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50">
                            <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Student Contact</p>
                            <p class="font-bold text-sm truncate">${escapeHtml(student.full_name || "")}</p>
                            <p class="text-[11px] text-slate-500 truncate">${student.email || 'N/A'}</p>
                        </div>
                    </div>

                    <div class="flex gap-4 mt-2">
                        <button class="approve-btn flex-1 py-3 bg-red-600 text-white font-black rounded-xl hover:bg-red-700 transition-all text-sm flex items-center justify-center gap-2 shadow-lg shadow-red-500/20" data-id="${session.id}">
                            Confirm Rejection
                        </button>
                        <button class="deny-btn flex-1 py-3 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-black rounded-xl hover:bg-slate-50 transition-all text-sm" data-id="${session.id}">
                            Deny & Keep
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // Bind Actions
        rejectionsList.querySelectorAll('.approve-btn').forEach(btn => {
            btn.onclick = () => handleDecision(btn.dataset.id, 'cancelled', btn);
        });
        rejectionsList.querySelectorAll('.deny-btn').forEach(btn => {
            btn.onclick = () => handleDecision(btn.dataset.id, 'pending_review', btn);
        });
    };

    const handleDecision = async (sessionId, status, btn) => {
        const originalText = btn.innerText;
        try {
            btn.disabled = true;
            btn.innerHTML = '<span class="animate-spin material-symbols-outlined text-sm">sync</span> Processing...';
            
            // Admin has no real Supabase JWT, so direct table updates are blocked by RLS.
            // Use the SECURITY DEFINER RPC instead.
            const session = await AuthService.getSession();
            const adminId = session.user.id;
            
            const { error } = await supabase.rpc('admin_update_session_status', {
                p_admin_id: adminId,
                p_session_id: sessionId,
                p_booking_status: status
            });
            
            if (error) throw error;

            // Refund logic for confirmed rejections
            try {
                const sessionData = allSessions.find(s => s.id === sessionId);
                if (sessionData) {
                    const isConfirmed = status === 'cancelled';
                    
                    if (isConfirmed) {
                        const wasPaid = sessionData.booking_status === 'paid_waiting_review';
                        if (wasPaid) {
                            try {
                                const { data: payment } = await supabase
                                    .from('payments')
                                    .select('id')
                                    .eq('mentorship_session_id', sessionId)
                                    .eq('status', 'paid')
                                    .single();

                                if (payment) {
                                    await supabase.from('refund_requests').insert({
                                        payment_id: payment.id,
                                        student_id: sessionData.student_id,
                                        reason: 'Session cancelled after payment — mentor rejection confirmed by admin.',
                                        status: 'pending'
                                    });
                                }
                            } catch (refundErr) {
                                console.error('Could not auto-create refund request:', refundErr);
                            }
                        }
                    }
                }
            } catch (err) {
                console.error('Error in post-decision logic:', err);
            }
            
            // Refresh data locally
            allSessions = allSessions.map(s => s.id === sessionId ? { ...s, booking_status: status } : s);
            renderTab();
        } catch (err) {
            console.error(err);
            showAlertModal({ title: 'Error', message: 'Error processing decision: ' + err.message, type: 'error' });
            btn.disabled = false;
            btn.innerText = originalText;
        }
    };

    // 4. Tab Logic
    tabBtns.forEach(btn => {
        btn.onclick = () => {
            tabBtns.forEach(b => b.classList.remove('active', 'bg-indigo-50', 'dark:bg-indigo-900/20', 'text-indigo-600', 'dark:text-indigo-400', 'border-indigo-600'));
            tabBtns.forEach(b => b.classList.add('text-slate-500', 'dark:text-slate-400'));
            
            btn.classList.add('active');
            btn.classList.remove('text-slate-500', 'dark:text-slate-400');
            
            currentTab = btn.dataset.tab;
            
            // Toggle Tab Panes
            tabPanes.forEach(pane => {
                if (pane.id === `${currentTab}-pane`) {
                    pane.classList.remove('hidden');
                } else {
                    pane.classList.add('hidden');
                }
            });

            renderTab();
        };
    });

    // Status Filter Logic
    const statusFilter = document.getElementById('status-filter');
    if (statusFilter) {
        statusFilter.onchange = (e) => {
            selectedStatus = e.target.value;
            renderOverview();
        };
    }

    // Type Filter Logic
    const typeFilter = document.getElementById('type-filter');
    if (typeFilter) {
        typeFilter.onchange = (e) => {
            selectedType = e.target.value;
            renderOverview();
        };
    }

    // Date Filter Listeners
    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');
    const resetDatesBtn = document.getElementById('reset-dates');

    if (startDateInput) {
        startDateInput.onchange = (e) => {
            startDate = e.target.value;
            renderCompleted();
        };
    }

    if (endDateInput) {
        endDateInput.onchange = (e) => {
            endDate = e.target.value;
            renderCompleted();
        };
    }

    if (resetDatesBtn) {
        resetDatesBtn.onclick = () => {
            startDate = null;
            endDate = null;
            startDateInput.value = '';
            endDateInput.value = '';
            renderCompleted();
        };
    }

    // 5. Theme & Sidebar
    const themeToggle = document.getElementById('theme-toggle');
    themeToggle.onclick = () => {
        document.documentElement.classList.toggle('dark');
        const icon = themeToggle.querySelector('.material-symbols-outlined');
        icon.innerText = document.documentElement.classList.contains('dark') ? 'light_mode' : 'dark_mode';
    };

    const toggleSidebar = document.getElementById('toggle-sidebar');
    const sidebar = document.getElementById('sidebar');
    toggleSidebar.onclick = () => sidebar.classList.toggle('-translate-x-full');

    document.getElementById('logout-btn').onclick = async () => {
        await AuthService.logout();
        window.location.href = '/src/pages/auth/login-select/index.html';
    };

    // 6. Student Profile Modal Logic
    window.openStudentProfile = function(student) {
        const modal = document.getElementById('student-profile-modal');
        if (!modal) return;

        document.getElementById('student-modal-avatar').src = student.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(student.full_name || 'S')}&background=random&color=fff`;
        document.getElementById('student-modal-name').textContent = student.full_name || 'Unknown Student';
        document.getElementById('student-modal-title').textContent = student.professional_title || 'Student';
        document.getElementById('student-modal-email').textContent = student.email || 'No email shared';
        document.getElementById('student-modal-phone').textContent = student.phone_number || 'Not provided';
        document.getElementById('student-modal-location').textContent = (student.city && student.country) ? `${student.city}, ${student.country}` : (student.country || student.city || 'Not provided');
        document.getElementById('student-modal-bio').textContent = student.short_bio ? `"${student.short_bio}"` : '"No bio shared yet."';

        // Social Links
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

        // Interests
        const interestsContainer = document.getElementById('student-interests-list');
        if (interestsContainer) {
            const interests = student.learning_interests || [];
            if (Array.isArray(interests) && interests.length > 0) {
                interestsContainer.innerHTML = interests.map(interest => 
                    `<span class="px-3 py-1 bg-primary/5 text-primary rounded-lg text-[10px] font-black uppercase tracking-widest">${interest}</span>`
                ).join('');
            } else {
                interestsContainer.innerHTML = '<span class="text-slate-400 text-[10px] font-bold uppercase tracking-widest">No interests listed</span>';
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

    // Close on Escape or Backdrop
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') window.closeStudentModal();
    });
    const profileModal = document.getElementById('student-profile-modal');
    if (profileModal) {
        profileModal.addEventListener('click', (e) => {
            if (e.target === profileModal) window.closeStudentModal();
        });
    }

    // Initial Load
    fetchData();
});

