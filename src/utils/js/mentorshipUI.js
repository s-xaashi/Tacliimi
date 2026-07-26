function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * getProgramMeetingStatus(session)
 * Shared helper — call once per card render, use results everywhere.
 * Returns a rich status object about the current program lifecycle state.
 */
export function getProgramMeetingStatus(session) {
    const now = new Date();
    const originalMeetingStart = new Date(session.scheduled_at);
    const duration = session.duration_minutes || 60;

    // For recurring daily program sessions, compute TODAY's occurrence of the scheduled time slot
    const todaySlotStart = new Date(now);
    todaySlotStart.setHours(originalMeetingStart.getHours(), originalMeetingStart.getMinutes(), 0, 0);
    const todaySlotEnd = new Date(todaySlotStart.getTime() + duration * 60000);

    // Preserve original meetingStart for calculations that need the anchor date
    const meetingStart = originalMeetingStart;
    const meetingSlotEnd = new Date(meetingStart.getTime() + duration * 60000);

    const startDateStr = session.program_start_date || session.scheduled_at;
    const startDate = new Date(startDateStr);
    const dbDuration = session.duration_days || 30;
    const endDate = session.end_date ? new Date(session.end_date) : null;

    const daysElapsed = Math.max(0, Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
    const currentDay = daysElapsed + 1;
    const completedCount = session.completed_sessions_count || 0;
    const totalCount = session.total_sessions || dbDuration;

    const isFullyCompleted = session.booking_status === 'completed' || session.status === 'completed';
    const isProgramDurationPast = endDate && now >= endDate;

    // Is the CURRENT TIME inside today's daily time slot?
    const isMeetingLive = !isFullyCompleted && !isProgramDurationPast && now >= todaySlotStart && now < todaySlotEnd;

    // Auto-compute how many daily meeting slots have fully elapsed
    let meetingsHeld = 0;
    {
        let candidate = new Date(meetingStart);
        while (true) {
            const candidateEnd = new Date(candidate.getTime() + duration * 60000);
            if (candidate > now) break;
            if (now >= candidateEnd) meetingsHeld++;
            candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
        }
    }

    // effectiveCompleted: use whichever is higher — DB value or auto-computed elapsed slots.
    // This ensures progress moves correctly even if DB completed_sessions_count hasn't been updated yet.
    const effectiveCompleted = completedCount + meetingsHeld;
    const daysRemaining = Math.max(0, totalCount - effectiveCompleted);
    const isFullyCompletedFinal = isFullyCompleted || (totalCount > 0 && effectiveCompleted >= totalCount);

    // Find next recurring daily meeting that hasn't started yet
    // If we're currently in a live slot, next meeting is tomorrow's occurrence
    let nextMeeting = null;
    if (!isFullyCompletedFinal && !isProgramDurationPast) {
        if (isMeetingLive) {
            // Next meeting is tomorrow at the same time
            nextMeeting = new Date(todaySlotStart.getTime() + 24 * 60 * 60 * 1000);
        } else {
            let candidate = new Date(meetingStart);
            while (candidate <= now) {
                candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
            }
            nextMeeting = candidate;
        }
    }

    // Human-readable "Next in X" label using calendar date comparison
    let nextMeetingLabel = null;
    if (nextMeeting) {
        const diffMs = nextMeeting.getTime() - now.getTime();
        const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        const timeStr = nextMeeting.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

        // Calendar-day based labeling (not hour-count based)
        const nowDateStr = now.toDateString();
        const nextDateStr = nextMeeting.toDateString();
        const tomorrowDate = new Date(now); tomorrowDate.setDate(now.getDate() + 1);
        const tomorrowDateStr = tomorrowDate.toDateString();

        if (nextDateStr === nowDateStr) {
            // Same calendar day as today
            nextMeetingLabel = diffMins < 60
                ? `Today at ${timeStr} (in ${diffMins}m)`
                : `Today at ${timeStr} (in ${diffHrs}h ${diffMins}m)`;
        } else if (nextDateStr === tomorrowDateStr) {
            nextMeetingLabel = `Tomorrow at ${timeStr} (in ${diffHrs}h ${diffMins}m)`;
        } else {
            const dateStr = nextMeeting.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            nextMeetingLabel = `${dateStr} at ${timeStr} (in ${diffDays}d ${diffHrs % 24}h)`;
        }
    }

    let progressPercent = 0;
    if (isFullyCompletedFinal) {
        progressPercent = 100;
    } else {
        progressPercent = Math.min(100, Math.round((effectiveCompleted / totalCount) * 100));
    }

    return {
        now, meetingStart: todaySlotStart, meetingSlotEnd: todaySlotEnd, startDate, dbDuration, endDate,
        daysElapsed, daysRemaining, currentDay,
        meetingsHeld, completedCount, effectiveCompleted, totalCount,
        isMeetingLive, nextMeeting, nextMeetingLabel,
        isFullyCompleted: isFullyCompletedFinal, isProgramDurationPast, progressPercent
    };
}

/**
 * buildProgramProgressHtml(session)
 * Renders the bottom progress panel on any program mentorship card.
 * Single source of truth — used by Instructor, Student, and Admin dashboards.
 */
export function buildProgramProgressHtml(session) {
    if (!session || session.mentorship_type !== 'program') return '';
    if (session.booking_status === 'cancelled') return '';

    const s = getProgramMeetingStatus(session);
    const programGoal = session.topic || 'Program Mentorship';

    // Session label: "Session X of Y · N meetings held"
    // Use effectiveCompleted (max of DB count and auto-computed elapsed slots) so it's always accurate
    const displaySessionNum = Math.min(s.effectiveCompleted + 1, s.totalCount);
    const dayLabel = s.isFullyCompleted
        ? `Program Completed · ${s.effectiveCompleted} meeting${s.effectiveCompleted !== 1 ? 's' : ''} held`
        : `Session ${displaySessionNum} of ${s.totalCount} · ${s.effectiveCompleted} meeting${s.effectiveCompleted !== 1 ? 's' : ''} held`;

    // Next meeting banner — always show when there's an upcoming slot, even during a live session
    const nextMeetingHtml = (s.nextMeetingLabel && !s.isFullyCompleted) ? `
        <div class="flex items-center gap-2 bg-indigo-50/60 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl px-3 py-2 mt-3">
            <span class="material-symbols-outlined text-indigo-500 text-[16px] shrink-0">event_upcoming</span>
            <div class="min-w-0">
                <p class="text-[9px] font-black text-indigo-500 uppercase tracking-widest">Next Meeting</p>
                <p class="text-[11px] font-bold text-slate-700 dark:text-slate-300 truncate">${s.nextMeetingLabel}</p>
            </div>
        </div>` : '';

    return `
        <div class="mt-6 pt-5 border-t border-amber-200/50 dark:border-amber-900/30 flex flex-col items-stretch gap-4 w-full">
            <div class="flex justify-between items-center bg-amber-50/50 dark:bg-amber-900/20 p-3 rounded-xl border border-amber-100 dark:border-amber-900/30 w-full mb-1">
                <div class="flex items-center gap-3 min-w-0 flex-1">
                    <span class="material-symbols-outlined text-amber-500 text-2xl">flag</span>
                    <div class="min-w-0">
                        <p class="text-[10px] font-bold text-amber-600/70 uppercase tracking-widest">Program Goal</p>
                        <p class="font-bold text-slate-800 dark:text-slate-200 text-sm truncate" title="${escapeHtml(programGoal)}">${escapeHtml(programGoal)}</p>
                    </div>
                </div>
            </div>
            
            <div class="flex flex-col md:flex-row gap-6 md:gap-10 w-full">
                <div class="flex-1 w-full flex flex-col justify-center">
                    <div class="flex items-center justify-between text-xs font-bold mb-2">
                        <span class="text-slate-500">Program Progress</span>
                        <span class="text-amber-600">${s.progressPercent}%</span>
                    </div>
                    <div class="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden shadow-inner flex">
                        <div class="bg-gradient-to-r from-amber-400 to-yellow-500 h-full rounded-full transition-all duration-1000 w-full" style="max-width: ${s.progressPercent}%"></div>
                    </div>
                    <p class="text-[10px] text-slate-400 font-medium mt-1 uppercase tracking-wider">${dayLabel}</p>
                    ${nextMeetingHtml}
                </div>
                
                <div class="flex gap-8 shrink-0">
                    <div>
                        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1 mb-1"><span class="material-symbols-outlined text-[14px]">hourglass_bottom</span> Remaining</p>
                        <div class="flex items-end gap-1"><span class="text-lg font-black text-slate-700 dark:text-slate-300 leading-none">${s.daysRemaining}</span> <span class="text-xs text-slate-500 mb-0.5 font-bold">Sessions</span></div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function buildMonthlyBadgeHtml() {
    return `
        <div class="px-3 py-1 bg-gradient-to-r from-amber-200 to-yellow-400 text-amber-900 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1 shadow-lg shadow-amber-500/20">
            <span class="material-symbols-outlined text-[14px]">workspace_premium</span> Program
        </div>
    `;
}

/**
 * SHARED MODAL: openMentorshipRescheduleModal
 * Inject and open a standalone reschedule modal on any dashboard.
 * @param {string} sessionId
 * @param {string} currentScheduledAt - ISO timestamp
 * @param {string|number} currentDurationStr - duration in minutes
 * @param {string} studentName
 * @param {string} triggerRole - 'admin' or 'mentor'
 * @param {Function} onConfirmCallback - async (sessionId, newDateObj, dur, note) => void
 * @param {Array} [rescheduleHistory] - array of previous reschedule log entries from DB
 */
export function openMentorshipRescheduleModal(sessionId, currentScheduledAt, currentDurationStr, studentName, triggerRole, onConfirmCallback, rescheduleHistory) {
    let rescheduleModal = document.getElementById('reschedule-modal');
    if (!rescheduleModal) {
        const modalHtml = `
        <div id="reschedule-modal" class="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 opacity-0 pointer-events-none transition-opacity duration-300">
            <div class="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-md shadow-2xl shadow-slate-900/20 border border-slate-200 dark:border-slate-700 transform scale-95 transition-transform duration-300 flex flex-col max-h-[90vh]">
                <div class="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
                    <h3 id="res-modal-title" class="font-bold text-lg text-slate-900 dark:text-white">Reschedule Meeting</h3>
                    <button type="button" class="close-reschedule-btn w-8 h-8 flex items-center justify-center bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full transition-colors">
                        <span class="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </div>
                <div class="p-6 overflow-y-auto flex-1">
                    <p class="text-sm text-slate-500 mb-4">You are rescheduling a meeting for student <strong id="res-student-name" class="text-slate-700 dark:text-slate-300">Student</strong>.</p>

                    <div id="res-history-panel" class="hidden mb-5">
                        <div class="flex items-center gap-2 mb-2">
                            <span class="material-symbols-outlined text-[16px] text-slate-400">history</span>
                            <p class="text-xs font-bold text-slate-500 uppercase tracking-wider">Reschedule History</p>
                        </div>
                        <div id="res-history-list" class="space-y-2 max-h-40 overflow-y-auto pr-1"></div>
                    </div>

                    <div class="space-y-4">
                        <div>
                            <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">New Date</label>
                            <input type="date" id="res-date" class="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-900 dark:text-white font-medium" />
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Start Time</label>
                                <input type="time" id="res-time" class="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-900 dark:text-white font-medium" />
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Duration (mins)</label>
                                <input type="number" id="res-duration" class="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-900 dark:text-white font-medium" min="15" step="5" />
                            </div>
                        </div>
                        <div id="res-note-container">
                            <!-- Populated dynamically based on role -->
                        </div>
                    </div>

                    <div class="mt-8 flex gap-3">
                        <button type="button" class="close-reschedule-btn flex-1 px-4 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">Cancel</button>
                        <button type="button" id="confirm-reschedule-btn" class="flex-1 px-4 py-3 bg-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-indigo-500/20 hover:bg-indigo-700 transition-all flex items-center justify-center gap-2">
                            <span class="material-symbols-outlined text-[18px]">check_circle</span> Update Schedule
                        </button>
                    </div>
                </div>
            </div>
        </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        rescheduleModal = document.getElementById('reschedule-modal');
        
        rescheduleModal.querySelectorAll('.close-reschedule-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                rescheduleModal.classList.remove('opacity-100', 'pointer-events-auto');
                rescheduleModal.querySelector('.scale-100').classList.replace('scale-100', 'scale-95');
                setTimeout(() => rescheduleModal.classList.add('hidden'), 300);
            });
        });
    }

    // Render reschedule history panel
    const historyPanel = document.getElementById('res-history-panel');
    const historyList = document.getElementById('res-history-list');
    if (historyPanel && historyList) {
        const history = Array.isArray(rescheduleHistory) ? rescheduleHistory : [];
        if (history.length > 0) {
            historyPanel.classList.remove('hidden');
            historyList.innerHTML = history.slice().reverse().map(entry => {
                const prevDate = entry.previous_scheduled_at ? new Date(entry.previous_scheduled_at) : null;
                const dateStr = prevDate
                    ? prevDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                    : 'Unknown date';
                const timeStr = prevDate
                    ? prevDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                    : '';
                const dur = entry.previous_duration ? `${entry.previous_duration} min` : '';
                const isAdmin = entry.requested_by === 'admin';
                const actor = isAdmin
                    ? `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 rounded text-[9px] font-bold uppercase tracking-wider"><span class="material-symbols-outlined text-[10px]">admin_panel_settings</span>Admin</span>`
                    : `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 rounded text-[9px] font-bold uppercase tracking-wider"><span class="material-symbols-outlined text-[10px]">school</span>Instructor</span>`;
                const noteHtml = entry.note
                    ? `<p class="text-[11px] text-slate-500 dark:text-slate-400 mt-1 italic">&ldquo;${escapeHtml(entry.note)}&rdquo;</p>`
                    : '';
                return `
                    <div class="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700 rounded-xl">
                        <div class="flex items-center justify-between gap-2 flex-wrap">
                            <div class="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                                <span class="material-symbols-outlined text-[13px] text-slate-400">event</span>
                                <span class="text-xs font-semibold">${dateStr}${timeStr ? ' @ ' + timeStr : ''}${dur ? ' &bull; ' + dur : ''}</span>
                            </div>
                            ${actor}
                        </div>
                        ${noteHtml}
                    </div>
                `;
            }).join('');
        } else {
            historyPanel.classList.add('hidden');
            historyList.innerHTML = '';
        }
    }

    // Role specific templating
    if (triggerRole === 'admin') {
        document.getElementById('res-modal-title').innerText = "Admin Reschedule Meeting";
        document.getElementById('res-note-container').innerHTML = `
            <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Admin Note (Internal/Audit)</label>
            <input type="text" id="res-note" placeholder="Reason for admin overwrite" class="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-900 dark:text-white text-sm" />
        `;
    } else {
        document.getElementById('res-modal-title').innerText = "Reschedule Meeting";
        document.getElementById('res-note-container').innerHTML = `
            <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Note to Student (Optional)</label>
            <input type="text" id="res-note" placeholder="Reason for rescheduling" class="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-900 dark:text-white text-sm" />
        `;
    }

    const currentD = new Date(currentScheduledAt);
    document.getElementById('res-student-name').innerText = studentName;
    document.getElementById('res-date').value = currentD.toISOString().split('T')[0];
    document.getElementById('res-time').value = currentD.toTimeString().substring(0, 5);
    document.getElementById('res-duration').value = currentDurationStr || 60;
    
    const noteInput = document.getElementById('res-note');
    if (noteInput) noteInput.value = '';

    const confirmBtn = document.getElementById('confirm-reschedule-btn');
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

    newConfirmBtn.addEventListener('click', async () => {
        const d = document.getElementById('res-date').value;
        const t = document.getElementById('res-time').value;
        const dur = parseInt(document.getElementById('res-duration').value) || 60;
        const note = noteInput ? noteInput.value : '';
        
        if (!d || !t) return window.showAlertModal?.({ title: "Error", message: "Please provide date and time.", type: "error" }) || alert("Please provide date and time.");

        const newDateObj = new Date(d + 'T' + t);
        if(isNaN(newDateObj.getTime())) return window.showAlertModal?.({ title: "Error", message: "Invalid date/time.", type: "error" }) || alert("Invalid date/time.");

        try {
            newConfirmBtn.disabled = true;
            newConfirmBtn.innerHTML = '<span class="material-symbols-outlined animate-spin text-[18px]">sync</span> Updating...';
            
            await onConfirmCallback(sessionId, newDateObj, dur, note);
            
            rescheduleModal.classList.remove('opacity-100', 'pointer-events-auto');
            rescheduleModal.querySelector('.scale-100').classList.replace('scale-100', 'scale-95');
            setTimeout(() => rescheduleModal.classList.add('hidden'), 300);
            
        } catch(err) {
            console.error("Reschedule Error", err);
            window.showToast?.("Failed to reschedule: " + err.message, "error") || alert("Failed: " + err.message);
            newConfirmBtn.disabled = false;
            newConfirmBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">check_circle</span> Update Schedule';
        }
    });

    rescheduleModal.classList.remove('hidden');
    void rescheduleModal.offsetWidth;
    rescheduleModal.classList.add('opacity-100', 'pointer-events-auto');
    rescheduleModal.querySelector('.scale-95').classList.replace('scale-95', 'scale-100');
}
