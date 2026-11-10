import { AuthService } from '/src/services/authService.js';
import { resolveProfileAvatar } from '/src/services/r2ImageUpload.js';
import { getMentorConversationList, getMentorThread, sendMessage, subscribeToThread } from '/src/services/communicationsService.js';

window.initStudentCommunications = initStudentCommunications;

let currentStudentId = null;
let currentMentorId = null;
let currentLatestSessionId = null;
let activeChannel = null;
let allConversations = [];

// Base UI injected into #student-communications-wrapper
const UI_TEMPLATE = `
    <!-- LEFT PANEL: Mentors list -->
    <div class="w-full md:w-80 border-r border-slate-200 dark:border-slate-800 flex flex-col shrink-0" id="student-conv-panel">
        <div class="p-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
            <div class="relative">
                <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">search</span>
                <input id="student-conv-search" class="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary transition-all" placeholder="Search mentors..." type="text"/>
            </div>
        </div>
        <div class="flex-1 overflow-y-auto no-scrollbar" id="student-conv-list">
            <div id="student-conv-loading" class="flex flex-col items-center justify-center py-16 gap-3">
                <div class="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
            </div>
            <div id="student-conv-empty" class="hidden flex flex-col items-center justify-center py-16 px-6 text-center gap-3">
                <div class="w-12 h-12 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center">
                    <span class="material-symbols-outlined text-slate-300 dark:text-slate-600 text-xl">forum</span>
                </div>
                <p class="text-sm font-medium text-slate-500">No conversations yet</p>
                <p class="text-xs text-slate-400">Book sessions with mentors to start playing.</p>
            </div>
            <div id="student-conv-items"></div>
        </div>
    </div>

    <!-- RIGHT PANEL: Chat Pane -->
    <div class="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden h-full" style="height: 100%;" id="student-chat-pane">
        <!-- Placeholder -->
        <div id="student-chat-placeholder" class="flex-1 flex flex-col items-center justify-center p-8 bg-slate-50/50 dark:bg-slate-900/50 text-center">
            <div class="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                <span class="material-symbols-outlined text-primary text-4xl" style="font-variation-settings:'FILL' 0">chat</span>
            </div>
            <h3 class="text-lg font-bold text-slate-900 dark:text-white">Select a Mentor</h3>
            <p class="text-sm text-slate-500 mt-2 max-w-xs">Review your chat history and continue the conversation across all your sessions.</p>
        </div>

        <!-- Active View -->
        <div id="student-chat-active" class="hidden flex-col min-h-0 overflow-hidden bg-white dark:bg-slate-900 h-full" style="flex:1; height: 100%;">
            <!-- Header -->
            <div class="h-16 px-5 flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 shrink-0">
                <button id="student-chat-back" class="md:hidden p-1.5 -ml-2 text-slate-500 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">
                    <span class="material-symbols-outlined">arrow_back</span>
                </button>
                <div class="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex-shrink-0 relative overflow-hidden cursor-pointer hover:opacity-80 transition-opacity" id="student-chat-avatar-click">
                    <div id="student-chat-avatar" class="w-full h-full pointer-events-none"></div>
                </div>
                <div class="flex-1 min-w-0">
                    <p class="font-bold text-slate-900 dark:text-white truncate text-sm cursor-pointer hover:text-primary transition-colors hover:underline" id="student-chat-name"></p>
                    <p class="text-[11px] text-slate-500" id="student-chat-meta">Loading sessions...</p>
                </div>
            </div>
            
            <!-- Messages -->
            <div class="flex-1 overflow-y-auto no-scrollbar p-5 space-y-2 bg-slate-50 dark:bg-slate-950/30 min-h-0" id="student-chat-messages">
                <div id="student-msgs-loading" class="flex justify-center py-10">
                    <div class="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                </div>
                <div id="student-msgs-empty" class="hidden py-10 text-center text-sm text-slate-400">No messages yet.</div>
                <div id="student-msgs-list"></div>
            </div>

            <!-- Input -->
            <div class="shrink-0 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                <div class="flex items-end gap-3">
                    <textarea id="student-chat-input" rows="1" class="flex-1 resize-none bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all leading-relaxed custom-scroll" placeholder="Type a message..." style="max-height: 120px; min-height: 44px;"></textarea>
                    <button id="student-chat-send" class="flex-shrink-0 w-11 h-11 bg-primary text-white rounded-xl flex items-center justify-center disabled:opacity-50 transition-all hover:bg-purple-600 shadow-md p-0" disabled>
                        <span class="material-symbols-outlined text-[18px]" style="font-variation-settings:'FILL' 1">send</span>
                    </button>
                </div>
                <p class="text-[10px] text-slate-400 mt-2 pl-1" id="student-chat-info">Sending to latest active session</p>
            </div>
        </div>
    </div>
`;

// Helper styles required for msg bubbles + custom scroll in the new container
const styleInject = document.createElement('style');
styleInject.textContent = `
    .student-msg-bubble-me {
        background-color: #A855F7;
        color: white;
        border-radius: 1rem 1rem 0.25rem 1rem;
        padding: 0.5rem 0.875rem;
        display: inline-block;
        width: fit-content;
        max-width: 100%;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
        box-sizing: border-box;
    }
    .student-msg-bubble-other {
        background-color: white;
        color: #1e293b;
        border: 1px solid #e2e8f0;
        border-radius: 1rem 1rem 1rem 0.25rem;
        padding: 0.5rem 0.875rem;
        display: inline-block;
        width: fit-content;
        max-width: 100%;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
        box-sizing: border-box;
    }
    .dark .student-msg-bubble-other {
        background-color: #1e293b;
        color: #f1f5f9;
        border-color: #334155;
    }
    .student-convo-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        cursor: pointer;
        border-bottom: 1px solid #f1f5f9;
        transition: background-color 0.2s;
    }
    .dark .student-convo-item { border-bottom-color: #1e293b; }
    .student-convo-item:hover { background-color: #f8fafc; }
    .dark .student-convo-item:hover { background-color: rgba(30, 41, 59, 0.6); }
    .student-convo-item.active { background-color: #f3e8ff; border-left: 2px solid #A855F7; }
    .dark .student-convo-item.active { background-color: rgba(168, 85, 247, 0.1); border-left-color: #A855F7; }
`;
document.head.appendChild(styleInject);

function buildAvatarHTML(avatarUrl, name, sizeClass = 'w-10 h-10') {
    const initials = (name || '?').split(' ').map(p=>p[0]).join('').substring(0, 2).toUpperCase();
    if (avatarUrl) {
        return `<img src="${avatarUrl}" class="${sizeClass} rounded-full object-cover">
                <div class="${sizeClass} rounded-full bg-slate-200 dark:bg-slate-700 items-center justify-center text-slate-500 font-bold text-xs hidden">${initials}</div>`;
    }
    return `<div class="${sizeClass} rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-500 font-bold text-xs">${initials}</div>`;
}

function relativeTime(dateStr) {
    if (!dateStr) return '';
    const diff = Math.floor((new Date() - new Date(dateStr)) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return new Date(dateStr).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

function formatMsgTime(dateStr) {
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
    return (text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

export async function initStudentCommunications() {
    const wrapper = document.getElementById('student-communications-wrapper');
    if (!wrapper || wrapper.dataset.initialized === "true") return;

    wrapper.innerHTML = UI_TEMPLATE;
    wrapper.dataset.initialized = "true";

    const session = await AuthService.getSession();
    if (!session) return;
    currentStudentId = session.user.id;

    // Load profile for avatar/name use in message bubbles
    try {
        const profile = await AuthService.getCurrentProfile();
        if (profile) {
            window._studentAvatarSrc = await resolveProfileAvatar(profile).catch(() => null) || '';
            window._studentName = profile.full_name || '';
        }
    } catch (_) {}

    const listContainer = document.getElementById('student-conv-items');
    const loadingEl = document.getElementById('student-conv-loading');
    const emptyEl = document.getElementById('student-conv-empty');
    const searchInput = document.getElementById('student-conv-search');

    const chatPlaceholder = document.getElementById('student-chat-placeholder');
    const chatActive = document.getElementById('student-chat-active');
    
    const chatName = document.getElementById('student-chat-name');
    const chatMeta = document.getElementById('student-chat-meta');
    const chatAvWrap = document.getElementById('student-chat-avatar');
    
    // Add navigational clicks to mentor profile
    document.getElementById('student-chat-avatar-click').addEventListener('click', () => {
        if (currentMentorId) window.location.href = '/src/pages/instructor/public-profile/index.html?id=' + currentMentorId;
    });
    chatName.addEventListener('click', () => {
        if (currentMentorId) window.location.href = '/src/pages/instructor/public-profile/index.html?id=' + currentMentorId;
    });

    const msgsList = document.getElementById('student-msgs-list');
    const msgInput = document.getElementById('student-chat-input');
    const btnSend = document.getElementById('student-chat-send');
    const sendInfo = document.getElementById('student-chat-info');

    // Mobile specific
    const leftPanel = document.getElementById('student-conv-panel');
    const chatPane = document.getElementById('student-chat-pane');
    const btnBack = document.getElementById('student-chat-back');
    
    // Check mobile responsive classes
    const style = document.createElement('style');
    style.textContent = `
        @media (max-width: 767px) {
            #student-chat-pane { display: none; }
            #student-chat-pane.mobile-open { display: flex; }
            #student-conv-panel.mobile-hide { display: none; }
        }
    `;
    document.head.appendChild(style);

    async function renderList(list) {
        loadingEl.classList.add('hidden');
        if (!list || list.length === 0) {
            emptyEl.classList.remove('hidden');
            listContainer.innerHTML = '';
            return;
        }
        emptyEl.classList.add('hidden');
        const resolvedList = await Promise.all(list.map(async conversation => ({
            ...conversation,
            _resolvedAvatar: await resolveProfileAvatar({
                id: conversation.mentor_id,
                avatar_url: conversation.avatar_url,
                avatar_storage_key: conversation.avatar_storage_key
            }, 'mentorship-participant').catch(() => null)
        })));
        listContainer.innerHTML = resolvedList.map(c => {
            const preview = c.last_message ? (c.last_message.length > 35 ? c.last_message.substring(0,35)+'…' : c.last_message) : '<i class="text-slate-400">No messages</i>';
            return `
            <div class="student-convo-item" data-id="${c.mentor_id}" data-name="${escapeHtml(c.mentor_name)}" data-avatar="${c._resolvedAvatar || ''}">
                ${buildAvatarHTML(c._resolvedAvatar, c.mentor_name, 'w-10 h-10')}
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-center text-xs">
                        <span class="font-bold text-slate-800 dark:text-slate-200 truncate pr-2">${escapeHtml(c.mentor_name)}</span>
                        <span class="text-slate-400 text-[10px] whitespace-nowrap">${relativeTime(c.last_message_at)}</span>
                    </div>
                    <p class="text-[11px] text-slate-500 truncate">${preview}</p>
                </div>
            </div>`;
        }).join('');

        listContainer.querySelectorAll('.student-convo-item').forEach(el => {
            el.addEventListener('click', () => {
                listContainer.querySelectorAll('.student-convo-item').forEach(x => x.classList.remove('active'));
                el.classList.add('active');
                openThread(el.dataset.id, el.dataset.name, el.dataset.avatar);
            });
        });
    }

    async function openThread(mentorId, mentorName, avatar) {
        currentMentorId = mentorId;
        leftPanel.classList.add('mobile-hide');
        chatPane.classList.add('mobile-open');

        chatPlaceholder.classList.add('hidden');
        chatActive.classList.remove('hidden');
        chatActive.classList.add('flex');

        chatName.textContent = mentorName;
        chatMeta.textContent = 'Loading...';
        chatAvWrap.innerHTML = buildAvatarHTML(avatar, mentorName, 'w-10 h-10');

        // Store for use in appendMessage avatar rendering
        window._mentorAvatarSrc = avatar || '';
        window._mentorName = mentorName || '';
        
        // Retain student avatar URL or check header profile image fallback
        if (!window._studentAvatarSrc) {
            const profileImg = document.querySelector('#global-profile-header-container img, [data-role="profile-image"] img');
            if (profileImg && profileImg.src && !profileImg.src.includes('IMG_7448') && !profileImg.src.includes('IMG_7454')) {
                window._studentAvatarSrc = profileImg.src;
            }
        }
        msgsList.innerHTML = '';
        document.getElementById('student-msgs-loading').classList.remove('hidden');
        document.getElementById('student-msgs-empty').classList.add('hidden');
        btnSend.disabled = true;

        if (activeChannel) {
            activeChannel.unsubscribe();
            activeChannel = null;
        }

        try {
            const { items, latestActiveSessionId, sessions } = await getMentorThread(currentStudentId, mentorId);
            currentLatestSessionId = latestActiveSessionId;
            
            document.getElementById('student-msgs-loading').classList.add('hidden');
            chatMeta.textContent = `${sessions.length} session${sessions.length===1?'':'s'} total`;

            if (items.filter(i=>i.type==='message').length === 0) {
                document.getElementById('student-msgs-empty').classList.remove('hidden');
            }

            for (const item of items) {
                if (item.type === 'session_divider') {
                    const statusColor = item.session.status==='completed'?'text-emerald-500':item.session.status==='cancelled'?'text-red-400':'text-primary';
                    msgsList.insertAdjacentHTML('beforeend', `
                        <div class="flex items-center gap-3 my-4 px-2">
                            <div class="flex-1 h-px bg-slate-200 dark:bg-slate-700"></div>
                            <div class="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-1 rounded-full whitespace-nowrap">
                                Session #${item.session.serial_id} · <span class="${statusColor}">${item.session.status}</span>
                            </div>
                            <div class="flex-1 h-px bg-slate-200 dark:bg-slate-700"></div>
                        </div>`);
                } else {
                    appendMessage(item.message);
                }
            }

            if (currentLatestSessionId) {
                btnSend.disabled = false;
                sendInfo.textContent = 'Sending to latest active session';
                const sessionIds = sessions.map(s => s.id);
                activeChannel = subscribeToThread(sessionIds, (newMsg) => {
                    // avoid self-duplicates
                    if (!msgsList.querySelector(`[data-msg-id="${newMsg.id}"]`)) {
                        appendMessage(newMsg);
                        scrollToBottom();
                    }
                });
            } else {
                sendInfo.textContent = 'No active sessions to send messages to.';
            }

            scrollToBottom();
        } catch (e) {
            console.error('Thread error:', e);
        }
    }

    function appendMessage(msg) {
        const isMe = msg.sender_role === 'student';
        const justify = isMe ? 'justify-end' : 'justify-start';
        const align = isMe ? 'items-end' : 'items-start';
        const bubbleCls = isMe ? 'student-msg-bubble-me' : 'student-msg-bubble-other';

        // Mine: show student avatar (right side), theirs: show mentor avatar (left side)
        const myAvatarSrc = window._studentAvatarSrc || '';
        const myInitials = (window._studentName||'S').split(' ').map(p=>p[0]).join('').substring(0,2).toUpperCase();
        const mentorAvatarSrc = window._mentorAvatarSrc || '';
        const mentorInitials = (window._mentorName||'M').split(' ').map(p=>p[0]).join('').substring(0,2).toUpperCase();

        const myAvatar = myAvatarSrc
            ? `<img src="${myAvatarSrc}" class="w-7 h-7 rounded-full object-cover flex-shrink-0">`
            : `<div class="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">${myInitials}</div>`;
        const mentorAvatar = mentorAvatarSrc
            ? `<img src="${mentorAvatarSrc}" class="w-7 h-7 rounded-full object-cover flex-shrink-0">`
            : `<div class="w-7 h-7 rounded-full bg-slate-300 flex items-center justify-center text-slate-600 text-[10px] font-bold flex-shrink-0">${mentorInitials}</div>`;

        const cleanText = (msg.message_text || '').trim();
        msgsList.insertAdjacentHTML('beforeend', `
            <div class="flex ${justify} gap-2 mb-3" data-msg-id="${msg.id}">
                ${!isMe ? mentorAvatar : ''}
                <div class="flex flex-col gap-0.5 ${align} max-w-[80%] sm:max-w-[70%]">
                    <div class="${bubbleCls} ${isMe ? 'self-end' : 'self-start'} w-fit">${escapeHtml(cleanText)}</div>
                    <span class="text-[9px] text-slate-400 px-1">${formatMsgTime(msg.created_at)}</span>
                </div>
                ${isMe ? myAvatar : ''}
            </div>`);
    }

    function scrollToBottom() {
        const area = document.getElementById('student-chat-messages');
        if (area) area.scrollTop = area.scrollHeight;
    }

    async function handleSend() {
        const text = msgInput.value.trim();
        if (!text || !currentLatestSessionId) return;

        btnSend.disabled = true;
        msgInput.value = '';
        msgInput.style.height = '44px';

        try {
            const msg = await sendMessage(currentLatestSessionId, currentStudentId, text, 'student');
            
            appendMessage(msg);
            scrollToBottom();
            
            const activeNode = listContainer.querySelector('.student-convo-item.active p');
            if (activeNode) activeNode.textContent = text.length > 35 ? text.substring(0,35)+'…' : text;
        } catch(e) {
            console.error(e);
            msgInput.value = text;
        } finally {
            btnSend.disabled = false;
            msgInput.focus();
        }
    }

    msgInput.addEventListener('input', function() {
        this.style.height = '44px';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        btnSend.disabled = !this.value.trim() || !currentLatestSessionId;
    });

    msgInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });
    btnSend.addEventListener('click', handleSend);

    searchInput.addEventListener('input', async e => {
        const q = e.target.value.toLowerCase().trim();
        const filtered = q ? allConversations.filter(c => c.mentor_name.toLowerCase().includes(q)) : allConversations;
        await renderList(filtered);
    });

    btnBack.addEventListener('click', () => {
        leftPanel.classList.remove('mobile-hide');
        chatPane.classList.remove('mobile-open');
    });

    try {
        allConversations = await getMentorConversationList(currentStudentId);
        await renderList(allConversations);
    } catch(e) {
        console.error('Init error:', e);
    }
}
