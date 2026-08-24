import { supabase } from '../../../services/supabaseClient.js';
import { AuthService } from '../../../services/authService.js';

async function initConfirmation() {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('sessionId');

    if (!sessionId) {
        console.error("No session ID found in URL");
        return;
    }

    try {
        let session;
        const authSession = await AuthService.getSession();
        
        if (authSession && authSession.is_admin) {
            // Admin: Use RPC to bypass RLS
            const { data, error } = await supabase.rpc('admin_get_session_details', {
                p_admin_id: authSession.user.id,
                p_session_id: sessionId
            });
            if (error) throw error;
            if (data && data.length > 0) {
                // Map RPC columns to match table structure expectation
                const raw = data[0];
                session = {
                    ...raw,
                    mentor: {
                        full_name: raw.mentor_full_name,
                        avatar_url: raw.mentor_avatar_url
                    }
                };

                // Fallback: If RPC missed serial_id, try a quick direct fetch
                if (!session.serial_id) {
                    const { data: directData } = await supabase
                        .from('mentorship_sessions')
                        .select('serial_id')
                        .eq('id', sessionId)
                        .single();
                    if (directData) session.serial_id = directData.serial_id;
                }

                // Map payment_serial_id from RPC into the payments array format
                if (raw.payment_serial_id) {
                    session.payments = [{ serial_id: raw.payment_serial_id }];
                }
            }
        } else {
            // Student/Mentor: Use direct query (honors RLS)
            const { data, error } = await supabase
                .from('mentorship_sessions')
                .select(`
                    *,
                    mentor:profiles!mentorship_sessions_mentor_id_fkey (
                        full_name,
                        avatar_url
                    ),
                    student:profiles!mentorship_sessions_student_id_fkey (
                        full_name,
                        avatar_url
                    ),
                    payments!payments_mentorship_session_id_fkey (
                        serial_id
                    )
                `)
                .eq('id', sessionId)
                .single();
            
            if (error) throw error;
            session = data;
        }
        if (!session) {
            console.error("Session not found");
            return;
        }

        // Populate details
        const isMentor = authSession?.user?.id === session.mentor_id;

        if (isMentor) {
            const studentName = session.student?.full_name || 'a student';
            const noticeParent = document.getElementById('conf-mentor-name')?.parentElement;
            if (noticeParent) {
                noticeParent.innerHTML = `Your student <span class="font-bold text-slate-900 dark:text-white">${studentName}</span> has booked a 1-on-1 session with you. <span id="conf-meeting-type-note"></span>`;
            }
            document.getElementById('conf-mentor-display-name').textContent = studentName;
            
            // Change the 'MENTOR' label to 'STUDENT'
            const nameLabel = document.getElementById('conf-mentor-display-name').previousElementSibling;
            if (nameLabel) nameLabel.textContent = 'STUDENT';
            
            // Hide prep tips since they are for student
            const prepTips = document.querySelector('.bg-primary\\/5.rounded-xl.p-6');
            if (prepTips) prepTips.classList.add('hidden');
        } else {
            const mentorName = session.mentor?.full_name || 'Your Mentor';
            document.getElementById('conf-mentor-name').textContent = mentorName;
            document.getElementById('conf-mentor-display-name').textContent = mentorName;
        }
        
        const scheduledDate = new Date(session.scheduled_at);
        document.getElementById('conf-date').textContent = scheduledDate.toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
        const duration = session.duration_minutes || 60;
        const endDate = new Date(scheduledDate.getTime() + duration * 60000);
        
        const startTimeStr = scheduledDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const endTimeStr = endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        
        document.getElementById('conf-time').textContent = `${startTimeStr} — ${endTimeStr}`;

        document.getElementById('conf-topic').textContent = session.topic || 'General Mentorship';

        // Populate Standardized IDs
        const sessId = session.serial_id ? `SES-${session.serial_id}` : 'SES-XXXX';
        
        let paySerialId = null;

        // 1. Try from the joined payments data (works for students via RLS: student_id = auth.uid())
        if (session.payments && session.payments.length > 0) {
            paySerialId = session.payments[0].serial_id;
        }

        // 2. Fallback: explicit query using mentorship_session_id
        if (!paySerialId) {
            const { data: payData } = await supabase
                .from('payments')
                .select('serial_id')
                .eq('mentorship_session_id', sessionId)
                .limit(1)
                .maybeSingle();
            if (payData) paySerialId = payData.serial_id;
        }

        const payId = paySerialId ? `PAY-${paySerialId}` : '—';
        
        const confSessEl = document.getElementById('conf-session-id');
        const confPayEl = document.getElementById('conf-payment-id');
        if (confSessEl) confSessEl.textContent = sessId;
        if (confPayEl) confPayEl.textContent = payId;

        const meetingTypeNote = document.getElementById('conf-meeting-type-note');
        const meetingTypeLabel = document.getElementById('conf-meeting-type-label');
        if (meetingTypeLabel) meetingTypeLabel.textContent = session.meeting_type.toUpperCase();

        if (session.meeting_type === 'online') {
            meetingTypeNote.textContent = "Your session will be held online. Please expect a WhatsApp, Zoom, or Google Meet invitation details via email soon.";
        } else if (session.meeting_type === 'in-person') {
            meetingTypeNote.textContent = "Your session will be held in-person. The mentor will contact you to coordinate the final meeting details.";
            
            const locationSection = document.getElementById('conf-location-section');
            if (locationSection) {
                locationSection.classList.remove('hidden');
                document.getElementById('conf-location').textContent = session.meeting_location || "Waiting to be negotiated";
            }
        }

        // Show join link if confirmed and online
        if (session.status === 'confirmed' && session.meeting_type === 'online' && session.meeting_link) {
            const actionsContainer = document.querySelector('.flex-col.sm-flex-row.gap-4');
            if (actionsContainer) {
                const joinBtn = document.createElement('a');
                joinBtn.href = session.meeting_link;
                joinBtn.target = "_blank";
                joinBtn.className = "flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 px-6 rounded-lg flex items-center justify-center gap-2 transition-all order-first";
                joinBtn.innerHTML = '<span class="material-symbols-outlined text-xl">videocam</span> Join Meeting Now';
                actionsContainer.appendChild(joinBtn);
            }
        }

        // --- Admin UI Adjustments ---
        if (authSession && authSession.is_admin) {
            // 1. Hide Student-specific Header Elements
            // Note: These usually get injected by Header/Nav so we hide them after a short delay or target existing ones
            const hideStudentUI = () => {
                document.querySelectorAll('nav, .sm\\:flex.items-center.justify-center.rounded-lg.bg-primary').forEach(el => {
                    const txt = (el.innerText || '').toLowerCase();
                    if (txt.includes('browse mentors') || txt.includes('dashboard') || txt.includes('teacher')) {
                        el.style.display = 'none';
                    }
                });
            };
            hideStudentUI();
            setTimeout(hideStudentUI, 500); // Guard against delayed injection

            // 2. Hide Preparation Tips and Calendar Sync
            const prepTips = document.querySelector('.bg-primary\\/5.rounded-xl.p-6');
            if (prepTips) prepTips.remove();
            
            const calendarBtn = document.querySelector('.mt-8.text-center');
            if (calendarBtn) calendarBtn.remove();

            // 3. Update Action Buttons
            const dashBtn = document.getElementById('conf-dashboard-btn');
            const marketBtn = document.getElementById('conf-marketplace-btn');
            
            if (dashBtn) {
                dashBtn.innerHTML = '<span class="material-symbols-outlined text-xl">arrow_back</span> Back to Bookings Review';
                dashBtn.onclick = () => window.location.href = '/src/pages/admin/bookings-review/index.html';
                dashBtn.className = dashBtn.className.replace('bg-primary', 'bg-indigo-600').replace('hover:bg-primary/90', 'hover:bg-indigo-700');
            }
            
            if (marketBtn) {
                marketBtn.innerHTML = '<span class="material-symbols-outlined text-xl">dashboard</span> View System Dashboard';
                marketBtn.onclick = () => window.location.href = '/src/pages/admin/dashboard/index.html';
                marketBtn.className = marketBtn.className.replace('text-slate-700', 'text-indigo-600').replace('dark:text-slate-300', 'dark:text-indigo-400');
            }
        }

    } catch (err) {
        console.error("Error loading confirmation details:", err);
    } finally {
        const skeletonLoader = document.getElementById('skeleton-loader');
        const contentContainer = document.getElementById('content-container');
        if (skeletonLoader) skeletonLoader.classList.add('hidden');
        if (contentContainer) contentContainer.classList.remove('hidden');
    }
}

document.addEventListener('DOMContentLoaded', initConfirmation);
