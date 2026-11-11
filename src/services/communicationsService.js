/**
 * communicationsService.js
 * Handles all data operations for the Instructor Communications tab.
 * Core design: messages are grouped per STUDENT (not per session).
 * All sessions for the same student are merged into one conversation thread,
 * with session dividers rendered client-side.
 */
import { supabase } from './supabaseClient.js';

/**
 * Returns one conversation entry per unique student who has at least one session
 * with the given mentor. Includes: avatar, name, last message preview, timestamps.
 * @param {string} mentorId - The logged-in mentor/instructor's profile UUID
 * @returns {Promise<Array>}
 */
export async function getConversationList(mentorId) {
    // 1. Get all mentor's sessions with student profile info
    const { data: sessions, error: sessionsError } = await supabase
        .from('mentorship_sessions')
        .select(`
            id,
            student_id,
            topic,
            scheduled_at,
            status,
            created_at,
            serial_id,
            student:profiles!mentorship_sessions_student_id_fkey (
                id,
                full_name,
                avatar_url,
                avatar_storage_key
            )
        `)
        .eq('mentor_id', mentorId)
        .neq('student_id', mentorId)
        .order('created_at', { ascending: false });

    if (sessionsError) throw sessionsError;
    if (!sessions || sessions.length === 0) return [];

    // 2. Get all messages for ALL of this mentor's sessions in one query
    const sessionIds = sessions.map(s => s.id);
    const { data: messages, error: msgError } = await supabase
        .from('mentorship_booking_messages')
        .select('id, booking_id, message_text, created_at, sender_role')
        .in('booking_id', sessionIds)
        .order('created_at', { ascending: false });

    if (msgError) throw msgError;

    // 3. Build a map: sessionId → messages[]
    const msgBySession = {};
    for (const msg of (messages || [])) {
        if (!msgBySession[msg.booking_id]) msgBySession[msg.booking_id] = [];
        msgBySession[msg.booking_id].push(msg);
    }

    // 4. Group sessions by student_id
    const studentMap = new Map();
    for (const session of sessions) {
        const sid = session.student_id;
        if (!studentMap.has(sid)) {
            studentMap.set(sid, {
                student_id: sid,
                student_name: session.student?.full_name || 'Unknown Student',
                avatar_url: session.student?.avatar_url || null,
                avatar_storage_key: session.student?.avatar_storage_key || null,
                sessions: [],
                all_messages: [],
            });
        }
        const entry = studentMap.get(sid);
        entry.sessions.push(session);

        const sessionMsgs = msgBySession[session.id] || [];
        entry.all_messages.push(...sessionMsgs);
    }

    // 5. For each student entry, compute derived fields
    const result = [];
    for (const [, entry] of studentMap) {
        // Sort messages newest-first to get the last one
        entry.all_messages.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        const lastMsg = entry.all_messages[0] || null;

        // Find most recent non-cancelled session for send target
        const activeSessions = entry.sessions.filter(s => s.status !== 'cancelled');
        activeSessions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        result.push({
            student_id: entry.student_id,
            student_name: entry.student_name,
            avatar_url: entry.avatar_url,
            avatar_storage_key: entry.avatar_storage_key,
            session_count: entry.sessions.length,
            last_message: lastMsg ? lastMsg.message_text : null,
            last_message_at: lastMsg ? lastMsg.created_at : null,
            last_message_role: lastMsg ? lastMsg.sender_role : null,
            latest_active_session_id: activeSessions[0]?.id || entry.sessions[0]?.id || null,
        });
    }

    // Sort by last_message_at desc (students with most recent activity first)
    result.sort((a, b) => {
        if (!a.last_message_at && !b.last_message_at) return 0;
        if (!a.last_message_at) return 1;
        if (!b.last_message_at) return -1;
        return new Date(b.last_message_at) - new Date(a.last_message_at);
    });

    return result;
}

/**
 * Returns the full conversation thread for a specific student with the mentor.
 * Merges all sessions + their messages into a single chronological list
 * with session boundary markers.
 *
 * Returns an array of items, each either:
 *   { type: 'session_divider', session: {...} }
 *   { type: 'message', message: {...} }
 *
 * @param {string} mentorId
 * @param {string} studentId
 * @returns {Promise<{items: Array, latestActiveSessionId: string|null, sessions: Array}>}
 */
export async function getStudentThread(mentorId, studentId) {
    // 1. Get all sessions between this mentor and student
    const { data: sessions, error: sErr } = await supabase
        .from('mentorship_sessions')
        .select(`
            id,
            serial_id,
            topic,
            scheduled_at,
            status,
            created_at,
            mentorship_type,
            duration_minutes
        `)
        .eq('mentor_id', mentorId)
        .eq('student_id', studentId)
        .order('created_at', { ascending: true });

    if (sErr) throw sErr;
    if (!sessions || sessions.length === 0) return { items: [], latestActiveSessionId: null, sessions: [] };

    const sessionIds = sessions.map(s => s.id);

    // 2. Get ALL messages for all those sessions
    const { data: messages, error: mErr } = await supabase
        .from('mentorship_booking_messages')
        .select(`
            id,
            booking_id,
            sender_id,
            sender_role,
            message_text,
            created_at,
            sender:profiles!mentorship_booking_messages_sender_id_fkey (
                id,
                full_name,
                avatar_url,
                avatar_storage_key
            )
        `)
        .in('booking_id', sessionIds)
        .order('created_at', { ascending: true });

    if (mErr) throw mErr;

    // 3. Build ordered thread with session dividers
    const msgBySession = {};
    for (const msg of (messages || [])) {
        if (!msgBySession[msg.booking_id]) msgBySession[msg.booking_id] = [];
        msgBySession[msg.booking_id].push(msg);
    }

    const items = [];
    for (const session of sessions) {
        items.push({ type: 'session_divider', session });

        const sessionMsgs = msgBySession[session.id] || [];
        for (const msg of sessionMsgs) {
            items.push({ type: 'message', message: msg, sessionId: session.id });
        }
    }

    // Find latest active session for sending
    const activeSessions = sessions.filter(s => s.status !== 'cancelled').slice().reverse();
    const latestActiveSessionId = activeSessions[0]?.id || sessions[sessions.length - 1]?.id || null;

    return { items, latestActiveSessionId, sessions };
}

/**
 * Sends a new message in a session.
 * @param {string} sessionId - The session (booking) to attach the message to
 * @param {string} senderId - The sender's profile UUID
 * @param {string} text - Message content
 * @param {string} role - The sender's role ('mentor' | 'student')
 * @returns {Promise<Object>} - The inserted message row
 */
export async function sendMessage(sessionId, senderId, text, role = 'mentor') {
    const { data, error } = await supabase
        .from('mentorship_booking_messages')
        .insert({
            booking_id: sessionId,
            sender_id: senderId,
            message_text: text.trim(),
            sender_role: role,
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

/**
 * Subscribe to new messages on multiple sessions via Supabase Realtime.
 * @param {Array<string>} sessionIds - Array of session IDs to listen to
 * @param {Function} onMessage - Callback receiving new message row
 * @returns {Object|null} - Supabase channel (call .unsubscribe() on cleanup)
 */
export function subscribeToThread(sessionIds, onMessage) {
    if (!sessionIds || sessionIds.length === 0) return null;

    const sessionSet = new Set(sessionIds);
    const channelName = `messages_thread_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const channel = supabase
        .channel(channelName)
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'mentorship_booking_messages',
            },
            (payload) => {
                if (payload.new && sessionSet.has(payload.new.booking_id)) {
                    onMessage(payload.new);
                }
            }
        )
        .subscribe();

    return channel;
}

// ─────────────────────────────────────────────────────────────────────────────
// STUDENT FACING FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns one conversation entry per unique MENTOR for a student.
 * @param {string} studentId - The logged-in student's profile UUID
 * @returns {Promise<Array>}
 */
export async function getMentorConversationList(studentId) {
    // 1. Get all student's sessions with mentor profile info
    const { data: sessions, error: sessionsError } = await supabase
        .from('mentorship_sessions')
        .select(`
            id, mentor_id, topic, scheduled_at, status, created_at, serial_id,
            mentor:profiles!mentorship_sessions_mentor_id_fkey (id, full_name, avatar_url, avatar_storage_key)
        `)
        .eq('student_id', studentId)
        .neq('mentor_id', studentId)
        .order('created_at', { ascending: false });

    if (sessionsError) throw sessionsError;
    if (!sessions || sessions.length === 0) return [];

    // 2. Get all messages for ALL of this student's sessions
    const sessionIds = sessions.map(s => s.id);
    const { data: messages, error: msgError } = await supabase
        .from('mentorship_booking_messages')
        .select('id, booking_id, message_text, created_at, sender_role')
        .in('booking_id', sessionIds)
        .order('created_at', { ascending: false });

    if (msgError) throw msgError;

    // 3. Build a map: sessionId → messages[]
    const msgBySession = {};
    for (const msg of (messages || [])) {
        if (!msgBySession[msg.booking_id]) msgBySession[msg.booking_id] = [];
        msgBySession[msg.booking_id].push(msg);
    }

    // 4. Group sessions by mentor_id
    const mentorMap = new Map();
    for (const session of sessions) {
        const mid = session.mentor_id;
        if (!mentorMap.has(mid)) {
            mentorMap.set(mid, {
                mentor_id: mid,
                mentor_name: session.mentor?.full_name || 'Unknown Mentor',
                avatar_url: session.mentor?.avatar_url || null,
                avatar_storage_key: session.mentor?.avatar_storage_key || null,
                sessions: [],
                all_messages: [],
            });
        }
        const entry = mentorMap.get(mid);
        entry.sessions.push(session);
        entry.all_messages.push(...(msgBySession[session.id] || []));
    }

    // 5. For each mentor, sort messages and compute active session
    const result = [];
    for (const [, entry] of mentorMap) {
        entry.all_messages.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const lastMsg = entry.all_messages[0] || null;

        const activeSessions = entry.sessions.filter(s => s.status !== 'cancelled');
        activeSessions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        result.push({
            mentor_id: entry.mentor_id,
            mentor_name: entry.mentor_name,
            avatar_url: entry.avatar_url,
            avatar_storage_key: entry.avatar_storage_key,
            session_count: entry.sessions.length,
            last_message: lastMsg ? lastMsg.message_text : null,
            last_message_at: lastMsg ? lastMsg.created_at : null,
            last_message_role: lastMsg ? lastMsg.sender_role : null,
            latest_active_session_id: activeSessions[0]?.id || entry.sessions[0]?.id || null,
        });
    }

    // Sort by latest message
    result.sort((a, b) => {
        if (!a.last_message_at && !b.last_message_at) return 0;
        if (!a.last_message_at) return 1;
        if (!b.last_message_at) return -1;
        return new Date(b.last_message_at) - new Date(a.last_message_at);
    });

    return result;
}

/**
 * Returns the full thread for a student and mentor.
 * @param {string} studentId
 * @param {string} mentorId 
 * @returns {Promise<{items: Array, latestActiveSessionId: string|null, sessions: Array}>}
 */
export async function getMentorThread(studentId, mentorId) {
    const { data: sessions, error: sErr } = await supabase
        .from('mentorship_sessions')
        .select(`
            id, serial_id, topic, scheduled_at, status, created_at, mentorship_type, duration_minutes
        `)
        .eq('student_id', studentId)
        .eq('mentor_id', mentorId)
        .order('created_at', { ascending: true });

    if (sErr) throw sErr;
    if (!sessions || sessions.length === 0) return { items: [], latestActiveSessionId: null, sessions: [] };

    const sessionIds = sessions.map(s => s.id);

    const { data: messages, error: mErr } = await supabase
        .from('mentorship_booking_messages')
        .select(`
            id, booking_id, sender_id, sender_role, message_text, created_at,
            sender:profiles!mentorship_booking_messages_sender_id_fkey (full_name, avatar_url, avatar_storage_key)
        `)
        .in('booking_id', sessionIds)
        .order('created_at', { ascending: true });

    if (mErr) throw mErr;

    const msgBySession = {};
    for (const msg of (messages || [])) {
        if (!msgBySession[msg.booking_id]) msgBySession[msg.booking_id] = [];
        msgBySession[msg.booking_id].push(msg);
    }

    const items = [];
    for (const session of sessions) {
        items.push({ type: 'session_divider', session });
        const sessionMsgs = msgBySession[session.id] || [];
        for (const msg of sessionMsgs) {
            items.push({ type: 'message', message: msg, sessionId: session.id });
        }
    }

    const activeSessions = sessions.filter(s => s.status !== 'cancelled').slice().reverse();
    const latestActiveSessionId = activeSessions[0]?.id || sessions[sessions.length - 1]?.id || null;

    return { items, latestActiveSessionId, sessions };
}
