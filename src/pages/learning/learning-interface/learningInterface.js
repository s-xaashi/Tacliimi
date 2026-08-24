import { supabase } from '/src/services/supabaseClient.js';
import { CourseService } from '/src/services/courseService.js';
import { AuthService } from '/src/services/authService.js';
import { getEmbedUrl, getEmbedPlatform } from '/src/utils/js/videoEmbed.js';

let activePlayer = null; // current YT.Player / Vimeo.Player instance — destroyed on every lesson change

function loadYouTubeAPI() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (window._ytApiPromise) return window._ytApiPromise;
    window._ytApiPromise = new Promise((resolve) => {
        const prevReady = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => { if (prevReady) prevReady(); resolve(); };
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
    });
    return window._ytApiPromise;
}

function loadVimeoAPI() {
    if (window.Vimeo && window.Vimeo.Player) return Promise.resolve();
    if (window._vimeoApiPromise) return window._vimeoApiPromise;
    window._vimeoApiPromise = new Promise((resolve) => {
        const tag = document.createElement('script');
        tag.src = 'https://player.vimeo.com/api/player.js';
        tag.onload = resolve;
        document.head.appendChild(tag);
    });
    return window._vimeoApiPromise;
}

let currentCourseData = null;
let currentLessonData = null;
let currentUser = null;
window.currentCourseData = null;
window.currentUser = null;
let completedLessonIds = new Set();
let totalLessonCount = 0;

// getEmbedUrl is now imported from /src/utils/js/videoEmbed.js

// ---------------------------------------------------------------
// REVIEW FUNCTIONS
// ---------------------------------------------------------------


async function loadReview(courseId, studentId) {
    const reviews = await CourseService.getCourseReviews(courseId);
    return reviews.find(r => r.student_id === studentId) || null;
}

async function saveReview(courseId, studentId, rating, comment) {
    await CourseService.submitReview(courseId, studentId, rating, comment);
}

async function renderReviewTab() {
    if (!currentCourseData || !currentUser) return;
    const reviewContainer = document.getElementById('tab-content-review');
    if (!reviewContainer) return;

    reviewContainer.innerHTML = '<p class="text-slate-600 dark:text-slate-400">Loading your review...</p>';

    try {
        const existingReview = await loadReview(currentCourseData.id, currentUser.id);

        if (existingReview) {
            let stars = '';
            for (let i = 1; i <= 5; i++) {
                stars += `<span class="material-symbols-outlined text-lg ${i <= existingReview.rating ? 'text-yellow-400' : 'text-slate-300'}">star</span>`;
            }
            reviewContainer.innerHTML = `
                <div class="bg-white dark:bg-slate-800 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 mb-6 max-w-2xl shadow-sm">
                    <div class="flex justify-between items-start mb-6">
                        <div>
                            <h3 class="text-lg font-bold text-slate-900 dark:text-white mb-2">Your Course Review</h3>
                            <div class="flex gap-1">${stars}</div>
                        </div>
                        <span class="text-xs font-bold text-slate-500 bg-slate-100 dark:bg-slate-800/50 px-4 py-1.5 rounded-full border border-slate-200 dark:border-slate-700">${new Date(existingReview.created_at).toLocaleDateString()}</span>
                    </div>
                    <p class="text-slate-600 dark:text-slate-300 text-base whitespace-pre-wrap leading-relaxed italic">"${existingReview.review_text}"</p>
                </div>
                <button onclick="window.renderReviewForm(${existingReview.rating}, \`${existingReview.review_text.replace(/`/g, '\\`')}\`)" class="group px-6 py-2.5 rounded-xl border-2 border-primary/20 text-primary font-bold hover:bg-primary hover:text-white transition-all flex items-center gap-2">
                    <span class="material-symbols-outlined text-xl transition-transform group-hover:rotate-12">edit</span> 
                    Edit Your Review
                </button>
            `;
        } else {
            window.renderReviewForm();
        }
    } catch (e) {
        reviewContainer.innerHTML = `<p class="text-rose-500 font-medium">Error loading review: ${e.message}</p>`;
    }
}

window.renderReviewForm = function (initRating = 0, initComment = '') {
    const reviewContainer = document.getElementById('tab-content-review');
    if (!reviewContainer) return;

    let starsHtml = '';
    for (let i = 1; i <= 5; i++) {
        starsHtml += `<button type="button" onclick="window.setDraftRating(${i})" class="review-star-btn material-symbols-outlined text-4xl ${i <= initRating ? 'text-yellow-400' : 'text-slate-300'} hover:text-yellow-400 transition-all active:scale-90" data-rating="${i}">star</button>`;
    }

    reviewContainer.innerHTML = `
        <div class="max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-2xl shadow-sm">
            <div class="mb-8">
                <h3 class="text-xl font-bold text-slate-900 dark:text-white mb-2">Review your experience</h3>
                <p class="text-sm text-slate-500">Your feedback helps us and other students improve the learning journey.</p>
            </div>
            <div class="mb-8">
                <label class="block text-xs font-bold text-slate-400 mb-3 uppercase tracking-widest">Rate the entire course</label>
                <div class="flex gap-3" id="review-stars-container" data-current="${initRating}">${starsHtml}</div>
            </div>
            <div class="mb-8">
                <label class="block text-xs font-bold text-slate-400 mb-3 uppercase tracking-widest">Your review</label>
                <textarea id="review-comment-input" rows="5" class="w-full rounded-2xl border-slate-200 dark:border-slate-800 dark:bg-slate-900/50 focus:ring-2 focus:ring-primary/20 focus:border-primary text-base p-5 transition-all placeholder:text-slate-400" placeholder="What did you think of the curriculum, instructor, and overall content?">${initComment}</textarea>
            </div>
            <button id="submit-review-btn" onclick="window.submitReview()" class="w-fit px-8 py-4 bg-primary hover:bg-indigo-700 text-white font-bold rounded-2xl transition-all shadow-xl shadow-primary/20 active:scale-[0.98] flex items-center gap-3">
                <span class="material-symbols-outlined text-xl">send</span> Submit Review
            </button>
            <p id="review-error-msg" class="mt-4 text-sm text-rose-500 font-medium hidden"></p>
        </div>
    `;
};

window.setDraftRating = function (rating) {
    const container = document.getElementById('review-stars-container');
    container.setAttribute('data-current', rating);
    container.querySelectorAll('.review-star-btn').forEach((star, i) => {
        star.classList.toggle('text-yellow-400', i < rating);
        star.classList.toggle('text-slate-300', i >= rating);
    });
};

window.submitReview = async function () {
    const rating = parseInt(document.getElementById('review-stars-container')?.getAttribute('data-current') || '0', 10);
    const comment = document.getElementById('review-comment-input')?.value.trim();
    const submitBtn = document.getElementById('submit-review-btn');
    const errorMsg = document.getElementById('review-error-msg');

    if (!rating) {
        if (errorMsg) { errorMsg.textContent = "Please select a rating."; errorMsg.classList.remove('hidden'); }
        return;
    }
    if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<span class="animate-spin inline-block w-5 h-5 border-2 border-white/30 border-t-white rounded-full mr-2"></span> Submitting...'; }
    try {
        await saveReview(currentCourseData.id, currentUser.id, rating, comment);
        renderReviewTab();
    } catch (e) {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<span class="material-symbols-outlined text-xl">send</span> Submit Review'; }
        if (errorMsg) { errorMsg.textContent = "Failed to save review: " + e.message; errorMsg.classList.remove('hidden'); }
    }
};

// ---------------------------------------------------------------
// QUIZ ANSWER PERSISTENCE
// ---------------------------------------------------------------

// Cache: quizId -> { questionId -> { optionId, isCorrect } }
let savedAnswersCache = {};

async function loadSavedAnswers(quizIds) {
    if (!currentUser || !quizIds || quizIds.length === 0) return;
    try {
        const { data: submissions } = await supabase
            .from('quiz_submissions')
            .select('id, quiz_id')
            .eq('student_id', currentUser.id)
            .in('quiz_id', quizIds);

        if (!submissions || submissions.length === 0) return;

        const submissionIds = submissions.map(s => s.id);
        const { data: answers } = await supabase
            .from('quiz_submission_answers')
            .select('submission_id, question_id, option_id, is_correct')
            .in('submission_id', submissionIds);

        if (!answers) return;

        const subMap = {};
        submissions.forEach(s => { subMap[s.id] = s.quiz_id; });
        answers.forEach(ans => {
            const quizId = subMap[ans.submission_id];
            if (!quizId) return;
            if (!savedAnswersCache[quizId]) savedAnswersCache[quizId] = {};
            savedAnswersCache[quizId][ans.question_id] = { optionId: ans.option_id, isCorrect: ans.is_correct };
        });
    } catch(e) {
        console.warn('Could not load saved quiz answers:', e.message);
    }
}

async function saveAnswer(quizId, questionId, optionId, isCorrect) {
    if (!currentUser) return;
    try {
        const { data: sub, error: subErr } = await supabase
            .from('quiz_submissions')
            .upsert({ student_id: currentUser.id, quiz_id: quizId }, { onConflict: 'student_id,quiz_id' })
            .select('id')
            .single();
        if (subErr) throw subErr;
        const { error: ansErr } = await supabase
            .from('quiz_submission_answers')
            .upsert({ submission_id: sub.id, question_id: questionId, option_id: optionId, is_correct: isCorrect }, { onConflict: 'submission_id,question_id' });
        if (ansErr) throw ansErr;
        if (!savedAnswersCache[quizId]) savedAnswersCache[quizId] = {};
        savedAnswersCache[quizId][questionId] = { optionId, isCorrect };
    } catch(e) {
        console.warn('Could not save quiz answer:', e.message);
    }
}

// ---------------------------------------------------------------
// LESSON NAVIGATION + PROGRESS
// ---------------------------------------------------------------

window.playLesson = function (sIdx, lIdx) {
    if (!currentCourseData) return;
    const sourceCurriculum = currentCourseData.course_sections || [];
    const section = sourceCurriculum[sIdx];
    const items = section?.course_lessons || [];
    const lesson = items[lIdx];
    if (!lesson) return;
    currentLessonData = lesson;

    // Global lesson index
    let itemIndex = 1, currentGlobalIndex = 1;
    sourceCurriculum.forEach((sec, sI) => {
        (sec.course_lessons || []).forEach((it, lI) => {
            if (sI === sIdx && lI === lIdx) currentGlobalIndex = itemIndex;
            itemIndex++;
        });
    });

    document.getElementById('li-lesson-title').textContent = `${currentGlobalIndex}. ${lesson.title || 'Untitled Lesson'}`;

    // Video — detect embed URLs (YouTube/Vimeo) and render as iframe
    const videoPlayer = document.getElementById('main-video-player');
    const videoContainer = videoPlayer.parentElement.parentElement; // outer aspect-video wrapper
    if (lesson.video_url) {
        const embedSrc = getEmbedUrl(lesson.video_url);
        const innerVideoDiv = videoPlayer.parentElement; // the actual black wrapper
        if (embedSrc) {
            // External embed: replace <video> with an <iframe>
            videoPlayer.style.display = 'none';

            // Destroy whatever player was bound to the previous lesson's iframe
            if (activePlayer) {
                try { activePlayer.destroy(); } catch (_) {}
                activePlayer = null;
            }

            // Always fully remove the old iframe so we don't leak state or postMessage listeners
            let oldIframe = innerVideoDiv.querySelector('#embed-iframe');
            if (oldIframe) {
                oldIframe.remove();
            }

            let iframe = document.createElement('iframe');
            iframe.id = 'embed-iframe';
            iframe.className = 'w-full h-full object-contain bg-black';
            iframe.setAttribute('frameborder', '0');
            iframe.setAttribute('allowfullscreen', '');
            iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
            innerVideoDiv.appendChild(iframe);

            const platform = getEmbedPlatform(embedSrc);
            const thisLessonId = lesson.id;

            iframe.onload = () => {
                if (!currentLessonData || currentLessonData.id !== thisLessonId) return;

                if (platform === 'youtube') {
                    loadYouTubeAPI().then(() => {
                        if (!currentLessonData || currentLessonData.id !== thisLessonId) return;
                        activePlayer = new YT.Player('embed-iframe', {
                            events: {
                                onStateChange: (e) => {
                                    if (e.data === YT.PlayerState.ENDED &&
                                        currentLessonData && currentLessonData.id === thisLessonId) {
                                        markLessonComplete(thisLessonId, 'video');
                                    }
                                }
                            }
                        });
                    });
                } else if (platform === 'vimeo') {
                    loadVimeoAPI().then(() => {
                        if (!currentLessonData || currentLessonData.id !== thisLessonId) return;
                        activePlayer = new Vimeo.Player(iframe);
                        activePlayer.on('ended', () => {
                            if (currentLessonData && currentLessonData.id === thisLessonId) {
                                markLessonComplete(thisLessonId, 'video');
                            }
                        });
                    });
                }
            };

            // Trigger the iframe load (onload event will fire afterwards)
            iframe.src = embedSrc;
            iframe.style.display = 'block';
        } else {
            if (activePlayer) { try { activePlayer.destroy(); } catch (_) {} activePlayer = null; }
            // Direct video file
            const existingIframe = innerVideoDiv.querySelector('#embed-iframe');
            if (existingIframe) existingIframe.style.display = 'none';
            videoPlayer.style.display = 'block';
            videoPlayer.src = lesson.video_url;
        }
        videoContainer.classList.remove('hidden');
    } else {
        if (activePlayer) { try { activePlayer.destroy(); } catch (_) {} activePlayer = null; }
        videoPlayer.src = '';
        videoPlayer.style.display = 'block';
        const existingIframe = videoContainer.querySelector('#embed-iframe');
        if (existingIframe) existingIframe.style.display = 'none';
        videoContainer.classList.add('hidden');
    }

    // Quizzes
    const quizTabBtn = document.querySelector('button[data-tab="quiz"]');
    const quizContent = document.getElementById('tab-content-quiz');
    const quizzes = Array.isArray(lesson.quizzes) ? lesson.quizzes : (lesson.quizzes ? [lesson.quizzes] : []);

    if (quizTabBtn && quizContent) {
        if (quizzes.length > 0) {
            quizTabBtn.classList.remove('hidden');
            quizTabBtn.innerHTML = `Quiz (${quizzes.length})`;

            let quizHtml = `<div class="space-y-6">`;
            quizzes.forEach((quiz, qidx) => {
                const qCount = quiz.questions ? quiz.questions.length : 0;
                quizHtml += `
                <div class="mb-10 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden">
                    <div class="p-6 border-b border-slate-50 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 flex items-center justify-between">
                        <div>
                            <h3 class="text-lg font-bold text-slate-800 dark:text-white">${quiz.title || 'Lesson Quiz'}</h3>
                            <p class="text-sm text-slate-500 mt-1">${quiz.description || 'Test your knowledge on this lesson.'}</p>
                        </div>
                        <div class="flex items-center gap-2 px-3 py-1 bg-primary/10 text-primary rounded-full">
                            <span class="text-xs font-bold uppercase tracking-wider">${qCount} Questions</span>
                        </div>
                    </div>
                    <div class="p-8 text-center" id="start-btn-${qidx}">
                        <button onclick="window.startQuiz(${sIdx}, ${lIdx}, ${qidx})" class="px-8 py-3 bg-primary hover:bg-primary/90 text-white rounded-xl font-bold transition-all shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 flex items-center gap-2 mx-auto">
                            Start Quiz Now
                            <span class="material-symbols-outlined text-lg">arrow_forward</span>
                        </button>
                    </div>
                    <div id="quiz-content-${qidx}" class="p-8 hidden"></div>
                </div>`;
            });
            quizHtml += `</div>`;
            quizContent.innerHTML = quizHtml;

            // Preload saved answers then auto-start quizzes that have saved answers
            const quizIds = quizzes.map(q => q.id).filter(Boolean);
            loadSavedAnswers(quizIds).then(() => {
                quizzes.forEach((quiz, qidx) => {
                    if (quiz.id && savedAnswersCache[quiz.id] && Object.keys(savedAnswersCache[quiz.id]).length > 0) {
                        window.startQuiz(sIdx, lIdx, qidx);
                    }
                });
            });
        } else {
            quizTabBtn.classList.add('hidden');
            quizContent.innerHTML = `<p class="text-slate-600 dark:text-slate-400">No quizzes for this lesson.</p>`;
        }
    }

    // Resources
    const resourcesTabBtn = document.querySelector('button[data-tab="resources"]');
    const resourcesContent = document.getElementById('tab-content-resources');
    const resources = Array.isArray(lesson.lesson_resources) ? lesson.lesson_resources : (lesson.lesson_resources ? [lesson.lesson_resources] : []);
    if (resourcesTabBtn && resourcesContent) {
        if (resources.length > 0) {
            resourcesTabBtn.innerHTML = `Resources (${resources.length})`;
            let resHtml = `<ul class="space-y-4">`;
            resources.forEach(res => {
                resHtml += `
                <li class="flex items-center justify-between p-4 border border-slate-200 dark:border-slate-800 rounded-xl hover:bg-white dark:hover:bg-slate-800 hover:shadow-md transition-all group">
                    <div class="flex items-center gap-4">
                        <div class="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 flex items-center justify-center">
                            <span class="material-symbols-outlined">description</span>
                        </div>
                        <div>
                            <p class="text-sm font-bold text-slate-900 dark:text-white mb-0.5">${res.title || 'Downloadable File'}</p>
                            <p class="text-xs font-semibold text-slate-400">Resource File</p>
                        </div>
                    </div>
                    <a href="${res.file_url}" target="_blank" class="text-emerald-600 font-bold text-sm px-4 py-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 focus:opacity-100">
                        <span class="material-symbols-outlined text-sm shrink-0">download</span> <span class="hidden sm:inline">Download</span>
                    </a>
                </li>`;
            });
            resHtml += `</ul>`;
            resourcesContent.innerHTML = resHtml;
        } else {
            resourcesTabBtn.innerHTML = `Resources`;
            resourcesContent.innerHTML = `<p class="text-slate-600 dark:text-slate-400">No resources for this lesson.</p>`;
        }
    }

    renderReviewTab();

    if (!lesson.video_url) {
        if (quizzes.length > 0) document.querySelector('button[data-tab="quiz"]')?.click();
        else if (resources.length > 0) document.querySelector('button[data-tab="resources"]')?.click();
        else document.querySelector('button[data-tab="review"]')?.click();
    }

    // Sidebar highlight
    document.querySelectorAll('.sidebar-lesson-btn').forEach(btn => {
        btn.classList.remove('bg-white', 'dark:bg-slate-800', 'shadow-sm', 'border-l-4', 'border-primary', 'pl-5');
        const dot = btn.querySelector('.lesson-active-dot');
        if (dot) dot.classList.replace('bg-primary', 'bg-transparent');
    });
    const activeBtn = document.getElementById(`sidebar-btn-s${sIdx}-l${lIdx}`);
    if (activeBtn) {
        activeBtn.classList.add('bg-white', 'dark:bg-slate-800', 'shadow-sm', 'border-l-4', 'border-primary', 'pl-5');
        const dot = activeBtn.querySelector('.lesson-active-dot');
        if (dot) dot.classList.replace('bg-transparent', 'bg-primary');
        activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Save resume point
    updateLastAccessed(lesson.id);
};

async function updateLastAccessed(lessonId) {
    if (!currentUser || !currentCourseData) return;
    try {
        await supabase
            .from('enrollments')
            .update({ last_accessed_lesson_id: lessonId || null, updated_at: new Date().toISOString() })
            .eq('student_id', currentUser.id)
            .eq('course_id', currentCourseData.id);
    } catch (e) {
        console.error("Error updating last accessed:", e);
    }
}

// Session-level partial completion tracking
const sessionProgress = new Map(); // lessonId -> { video: boolean, quiz: boolean }

async function markLessonComplete(lessonId, type = 'manual') {
    if (!currentUser) return;

    const lesson = currentCourseData?.course_sections?.flatMap(s => s.course_lessons || []).find(l => l.id === lessonId);
    if (!lesson) return;

    const hasVideo = !!lesson.video_url;
    const hasQuiz = Array.isArray(lesson.quizzes) ? lesson.quizzes.length > 0 : !!lesson.quizzes;

    if (!sessionProgress.has(lessonId)) {
        sessionProgress.set(lessonId, { video: !hasVideo, quiz: !hasQuiz });
    }
    const state = sessionProgress.get(lessonId);
    if (type === 'video') state.video = true;
    if (type === 'quiz') state.quiz = true;

    // Prevent un-completing a lesson that is already completed in completedLessonIds
    const wasCompleted = completedLessonIds.has(lessonId);
    const isNowCompleted = state.video && state.quiz;
    const finalCompleted = wasCompleted || isNowCompleted;

    // Persist progress
    try {
        await supabase.from('lesson_progress').upsert({
            student_id: currentUser.id,
            lesson_id: lessonId,
            completed: finalCompleted,
            completed_at: finalCompleted ? new Date().toISOString() : null,
            progress_data: state
        }, { onConflict: 'student_id, lesson_id' });
    } catch (e) {
        console.error("Error saving progress:", e);
    }

    if (finalCompleted && !wasCompleted) {
        completedLessonIds.add(lessonId);
        updateProgressUI();
        await syncCourseProgress();
        showCompletionToast();
        updateSidebarCheckmarks(lessonId);
    }
}

function updateSidebarCheckmarks(lessonId) {
    // Find the sidebar button for this lesson and update its icon
    const allSections = currentCourseData?.course_sections || [];
    allSections.forEach((sec, sIdx) => {
        (sec.course_lessons || []).forEach((lesson, lIdx) => {
            if (lesson.id === lessonId) {
                const btn = document.getElementById(`sidebar-btn-s${sIdx}-l${lIdx}`);
                if (btn) {
                    const numeralSpan = btn.querySelector('.li-lesson-numeral');
                    if (numeralSpan) numeralSpan.outerHTML = `<span class="li-lesson-numeral material-symbols-outlined text-emerald-500 text-[20px]">check_circle</span>`;
                    const titleEl = btn.querySelector('p');
                    if (titleEl) { titleEl.classList.remove('text-slate-700', 'dark:text-slate-300'); titleEl.classList.add('text-emerald-600', 'dark:text-emerald-400'); }
                }
            }
        });
    });
}

function showCompletionToast() {
    const existing = document.getElementById('completion-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'completion-toast';
    toast.className = 'fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-6 py-3 bg-emerald-500 text-white font-bold rounded-2xl shadow-xl shadow-emerald-500/30';
    toast.innerHTML = `<span class="material-symbols-outlined">check_circle</span> Lesson Complete!`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

async function syncCourseProgress() {
    if (!currentUser || !currentCourseData || totalLessonCount === 0) return;
    const courseLessonIds = new Set();
    currentCourseData.course_sections.forEach(s => (s.course_lessons || []).forEach(l => courseLessonIds.add(l.id)));
    let count = 0;
    completedLessonIds.forEach(id => { if (courseLessonIds.has(id)) count++; });
    const percentage = Math.min(100, Math.round((count / totalLessonCount) * 100));
    try {
        await supabase.from('enrollments').update({ progress_percentage: percentage, updated_at: new Date().toISOString() })
            .eq('student_id', currentUser.id).eq('course_id', currentCourseData.id);

        if (percentage === 100) {
            // Only ever sets completed_at the first time — no-op on subsequent calls.
            await supabase.from('enrollments')
                .update({ completed_at: new Date().toISOString() })
                .eq('student_id', currentUser.id).eq('course_id', currentCourseData.id)
                .is('completed_at', null);
            maybeShowCertificateButton(true);
        } else {
            maybeShowCertificateButton(false);
        }
    } catch (e) {
        console.error("Error syncing course progress:", e);
    }
}

function maybeShowCertificateButton(isComplete = false) {
    const btn = document.getElementById('li-certificate-btn');
    if (!btn || !currentCourseData?.certificate_enabled) return;

    // Always show the button when certificates are enabled
    btn.classList.remove('hidden');

    if (isComplete) {
        // Unlock: gold styling, clickable
        btn.disabled = false;
        btn.title = 'Click to generate your certificate!';
        btn.className = 'mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 bg-accent-gold hover:brightness-95 text-white font-bold rounded-xl transition-all shadow-lg shadow-accent-gold/20 cursor-pointer';
    } else {
        // Locked: grayed out, not clickable
        btn.disabled = true;
        btn.title = 'Complete all lessons to unlock your certificate';
        btn.className = 'mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 font-bold rounded-xl transition-all opacity-40 cursor-not-allowed bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400';
    }
}

function updateProgressUI() {
    const progressText = document.getElementById('li-progress-text');
    const progressBar = document.getElementById('li-progress-bar');
    const progressRibbon = document.getElementById('li-progress-ribbon');
    if (totalLessonCount === 0) return;
    const courseLessonIds = new Set();
    if (currentCourseData?.course_sections) currentCourseData.course_sections.forEach(s => (s.course_lessons || []).forEach(l => courseLessonIds.add(l.id)));
    let count = 0;
    completedLessonIds.forEach(id => { if (courseLessonIds.has(id)) count++; });
    const percentage = Math.min(100, Math.round((count / totalLessonCount) * 100));
    if (progressText) progressText.textContent = `${percentage}% Complete`;
    if (progressBar) progressBar.style.width = `${percentage}%`;
    if (progressRibbon) progressRibbon.style.height = `${percentage}%`;
    if (percentage === 100 && progressText) {
        progressText.classList.remove('bg-primary/10', 'text-primary');
        progressText.classList.add('bg-emerald-100', 'text-emerald-700');
    }
}

// Auto-mark complete when video ends
document.getElementById('main-video-player')?.addEventListener('ended', () => {
    if (currentLessonData) markLessonComplete(currentLessonData.id, 'video');
});

window.startQuiz = function (sIdx, lIdx, qidx) {
    const lesson = currentLessonData;
    if (!lesson?.quizzes?.[qidx]) return;
    const quiz = lesson.quizzes[qidx];
    const cachedAnswers = (quiz.id && savedAnswersCache[quiz.id]) ? savedAnswersCache[quiz.id] : {};

    document.getElementById(`start-btn-${qidx}`)?.classList.add('hidden');
    const container = document.getElementById(`quiz-content-${qidx}`);
    if (!container) return;
    container.classList.remove('hidden');

    let questionsHtml = '';
    (quiz.questions || []).forEach((q, ansIdx) => {
        const savedAns = cachedAnswers[q.id];
        questionsHtml += `
            <div class="mb-8 p-4 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800" id="q-block-${qidx}-${ansIdx}">
                <h5 class="font-semibold text-slate-800 dark:text-slate-200 mb-4 text-[15px]">
                    <span class="text-primary mr-2">${ansIdx + 1}.</span> ${q.question_text || 'Untitled Question'}
                </h5>
                <div class="space-y-3">`;
        (q.options || []).forEach((opt) => {
            const isCorrect = opt.is_correct === true;
            const isSaved = savedAns && savedAns.optionId === opt.id;
            let savedClass = '';
            let savedIcon = '';
            if (isSaved) {
                savedClass = isCorrect
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 opacity-100'
                    : 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800 opacity-100';
                savedIcon = `<span class="status-icon material-symbols-outlined text-xl ${isCorrect ? 'text-emerald-500' : 'text-rose-500'}">${isCorrect ? 'check_circle' : 'cancel'}</span>`;
            }
            const clickHandler = savedAns
                ? ''
                : `onclick="window.selectAnswer(this, ${sIdx}, ${lIdx}, ${qidx}, ${ansIdx}, '${quiz.id}', '${q.id}', '${opt.id}', ${isCorrect})"`;
            questionsHtml += `
                <label class="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 ${savedAns ? 'pointer-events-none opacity-70' : 'hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer'} ${savedClass} transition-colors"
                       ${clickHandler}>
                    <input type="radio" name="q-${qidx}-${ansIdx}" class="form-radio text-primary focus:ring-primary border-slate-300 pointer-events-none" ${isSaved ? 'checked' : ''}>
                    <span class="text-sm font-medium text-slate-700 dark:text-slate-300 flex-1">${opt.option_text}</span>
                    ${savedAns ? savedIcon : '<span class="status-icon hidden material-symbols-outlined text-xl"></span>'}
                </label>`;
        });
        questionsHtml += `</div></div>`;
    });
    container.innerHTML = questionsHtml;

    // Check completion if all answers were already saved
    if (quiz.questions && Object.keys(cachedAnswers).length >= quiz.questions.length) {
        checkQuizCompletion(qidx);
    }
};

window.selectAnswer = function (labelEl, sIdx, lIdx, qidx, ansIdx, quizId, questionId, optionId, isCorrect) {
    const block = document.getElementById(`q-block-${qidx}-${ansIdx}`);
    block.querySelectorAll('label').forEach(l => {
        l.classList.add('pointer-events-none', 'opacity-70');
        const radio = l.querySelector('input');
        if (radio) radio.checked = false;
    });
    labelEl.classList.remove('opacity-70');
    labelEl.classList.add('opacity-100');
    labelEl.querySelector('input').checked = true;

    const statusIcon = labelEl.querySelector('.status-icon');
    statusIcon.classList.remove('hidden');
    if (isCorrect) {
        labelEl.classList.add('bg-emerald-50', 'dark:bg-emerald-900/20', 'border-emerald-200', 'dark:border-emerald-800');
        labelEl.classList.remove('border-slate-200', 'dark:border-slate-700', 'hover:bg-slate-50', 'dark:hover:bg-slate-800');
        statusIcon.textContent = 'check_circle';
        statusIcon.classList.add('text-emerald-500');
    } else {
        labelEl.classList.add('bg-rose-50', 'dark:bg-rose-900/20', 'border-rose-200', 'dark:border-rose-800');
        labelEl.classList.remove('border-slate-200', 'dark:border-slate-700', 'hover:bg-slate-50', 'dark:hover:bg-slate-800');
        statusIcon.textContent = 'cancel';
        statusIcon.classList.add('text-rose-500');
    }
    saveAnswer(quizId, questionId, optionId, isCorrect);
    checkQuizCompletion(qidx);
};

function checkQuizCompletion(qidx) {
    if (!currentLessonData) return;
    
    // Check if ALL quizzes in this lesson are completely answered
    const quizzes = Array.isArray(currentLessonData.quizzes) ? currentLessonData.quizzes : 
                    (currentLessonData.quizzes ? [currentLessonData.quizzes] : []);
    
    let allQuizzesAnswered = true;

    quizzes.forEach((quiz, idx) => {
        const container = document.getElementById(`quiz-content-${idx}`);
        if (!container) {
            allQuizzesAnswered = false;
            return;
        }
        const blocks = container.querySelectorAll('[id^="q-block-"]');
        if (blocks.length === 0) {
            allQuizzesAnswered = false;
            return;
        }
        blocks.forEach(block => {
            const icon = block.querySelector('.status-icon');
            // If the icon is hidden, this question hasn't been answered yet
            if (!icon || icon.classList.contains('hidden')) {
                allQuizzesAnswered = false;
            }
        });
    });

    // If every question in every quiz has an answer selected (right or wrong), the quiz requirement is met.
    if (allQuizzesAnswered) {
        markLessonComplete(currentLessonData.id, 'quiz');
    }
}

// ---------------------------------------------------------------
// INITIALIZATION
// ---------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const courseId = urlParams.get('course') || urlParams.get('id');
    if (!courseId) { alert("No course selected."); return; }

    try {
        const [courseData, session] = await Promise.all([
            CourseService.getCourseFull(courseId),
            AuthService.getSession()
        ]);

        if (!courseData) {
            document.getElementById('li-lesson-title').textContent = "Course not found.";
            return;
        }

        currentCourseData = courseData;
        window.currentCourseData = courseData;
        currentUser = session ? session.user : null;
        window.currentUser = currentUser;

        const backBtn = document.getElementById('back-to-dashboard-btn');
        if (backBtn && session) {
            if (session.is_admin) {
                backBtn.href = '/src/pages/admin/dashboard/index.html';
            } else if (session.user?.user_metadata?.role === 'instructor') {
                backBtn.href = '/src/pages/instructor/instructor-dashboard/index.html';
            } else {
                backBtn.href = '/src/pages/student/student-dashboard/index.html';
            }
        }

        let lastAccessedLessonId = null;

        if (currentUser) {
            const lessonIds = [];
            courseData.course_sections.forEach(s => (s.course_lessons || []).forEach(l => lessonIds.push(l.id)));

            const [progressResult, enrollmentResult] = await Promise.all([
                supabase.from('lesson_progress').select('lesson_id, completed, progress_data')
                    .eq('student_id', currentUser.id).in('lesson_id', lessonIds),
                supabase.from('enrollments').select('last_accessed_lesson_id, progress_percentage, completed_at')
                    .eq('student_id', currentUser.id).eq('course_id', courseId).maybeSingle()
            ]);

            const existingProgress = enrollmentResult.data?.progress_percentage || 0;
            const alreadyCompleted = enrollmentResult.data?.completed_at != null || existingProgress === 100;
            window._cachedEnrollment = enrollmentResult.data;

            if (progressResult.data) {
                progressResult.data.forEach(p => {
                    if (p.completed) completedLessonIds.add(p.lesson_id);
                    // Always restore partial progress (even if completed),
                    // so that checking a quiz again on a completed lesson
                    // doesn't reset video progress to false.
                    if (p.progress_data) {
                        sessionProgress.set(p.lesson_id, {
                            video: !!p.progress_data.video,
                            quiz: !!p.progress_data.quiz
                        });
                    }
                });
            }

            if (enrollmentResult.data?.last_accessed_lesson_id) {
                lastAccessedLessonId = enrollmentResult.data.last_accessed_lesson_id;
            }

            // Show certificate button with correct state for returning students
            if (currentCourseData?.certificate_enabled) {
                maybeShowCertificateButton(alreadyCompleted);
            }
        }

        document.getElementById('li-course-title').textContent = courseData.title;
        document.title = courseData.title + ' - Learning Interface';

        const sidebarContainer = document.getElementById('li-sidebar-curriculum');
        if (!sidebarContainer) return;

        const sections = courseData.course_sections || [];
        let html = '<div class="divide-y divide-slate-100 dark:divide-slate-800/50">';
        let itemIndex = 1;
        let firstSIdx = -1, firstLIdx = -1;
        let resumeSIdx = -1, resumeLIdx = -1;

        const sortedSections = [...sections].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

        sortedSections.forEach((section, sIdx) => {
            const secTitle = section.title || `Section ${sIdx + 1}`;
            html += `
            <div class="bg-slate-50 dark:bg-slate-800/50 px-6 py-4 sticky top-0 z-10 backdrop-blur-md">
                <span class="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">${secTitle}</span>
            </div>`;

            const lessons = [...(section.course_lessons || [])].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
            if (lessons.length > 0) {
                lessons.forEach((lesson, lIdx) => {
                    if (firstSIdx === -1) { firstSIdx = sIdx; firstLIdx = lIdx; }
                    if (lastAccessedLessonId && lesson.id === lastAccessedLessonId) { resumeSIdx = sIdx; resumeLIdx = lIdx; }

                    const isCompleted = completedLessonIds.has(lesson.id);
                    const titleStr = `${lesson.title || 'Untitled Lesson'}`;
                    const paddedIdx = String(itemIndex).padStart(2, '0');

                    let metaIconsHtml = '';
                    if (lesson.video_url) metaIconsHtml += `<div class="flex items-center gap-1 font-semibold text-primary"><span class="material-symbols-outlined text-[15px]">play_circle</span></div>`;
                    if (lesson.quizzes?.length) metaIconsHtml += `<div class="flex items-center gap-1 font-bold text-amber-500"><span class="material-symbols-outlined text-[15px]">quiz</span><span class="text-[10px] bg-amber-100 dark:bg-amber-900/40 px-1.5 rounded-full">${lesson.quizzes.length}</span></div>`;
                    if (lesson.lesson_resources?.length) metaIconsHtml += `<div class="flex items-center gap-1 font-bold text-emerald-500"><span class="material-symbols-outlined text-[15px]">attachment</span><span class="text-[10px] bg-emerald-100 dark:bg-emerald-900/40 px-1.5 rounded-full">${lesson.lesson_resources.length}</span></div>`;

                    const completedHtml = isCompleted
                        ? `<div class="shrink-0 flex items-center justify-center w-6 h-6 relative"><span class="li-lesson-numeral material-symbols-outlined text-emerald-500 text-[20px]">check_circle</span><div class="lesson-active-dot absolute left-[-16px] top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-transparent transition-colors"></div></div>`
                        : `<div class="shrink-0 flex items-center justify-center w-6 h-6 relative"><span class="li-lesson-numeral font-serif text-slate-300 dark:text-slate-600 text-[15px] italic group-hover:text-primary transition-colors">${paddedIdx}</span><div class="lesson-active-dot absolute left-[-16px] top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-transparent transition-colors"></div></div>`;

                    html += `
                    <button id="sidebar-btn-s${sIdx}-l${lIdx}" onclick="window.playLesson(${sIdx}, ${lIdx})"
                        class="sidebar-lesson-btn w-full flex items-start gap-4 px-6 py-5 hover:bg-white dark:hover:bg-slate-800/80 text-left group transition-all border-l-4 border-transparent">
                        ${completedHtml}
                        <div class="flex-1">
                            <p class="text-[14px] font-bold ${isCompleted ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300'} mb-2 leading-snug group-hover:text-primary transition-colors font-serif">${titleStr}</p>
                            <div class="flex items-center gap-3">${metaIconsHtml}</div>
                        </div>
                    </button>`;
                    itemIndex++;
                });
            } else {
                html += `<div class="p-5 text-sm font-medium text-slate-400 italic px-6 text-center">Empty section</div>`;
            }
        });
        html += '</div>';
        sidebarContainer.innerHTML = html;

        // Count lessons with content
        let validCount = 0;
        sortedSections.forEach(s => (s.course_lessons || []).forEach(l => {
            if (l.video_url || l.quizzes?.length || l.lesson_resources?.length) validCount++;
        }));
        totalLessonCount = validCount;
        updateProgressUI();
        
        let alreadyCompleted = false;
        if (currentUser) {
            const existingProgress = window._cachedEnrollment?.progress_percentage || 0;
            alreadyCompleted = window._cachedEnrollment?.completed_at != null || existingProgress === 100;
        }
        maybeShowCertificateButton(alreadyCompleted);

        currentCourseData.course_sections = sortedSections;
        sortedSections.forEach(s => {
            s.course_lessons = [...(s.course_lessons || [])].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
        });

        // Resume last accessed lesson, or fall back to first lesson
        const startSIdx = resumeSIdx !== -1 ? resumeSIdx : firstSIdx;
        const startLIdx = resumeLIdx !== -1 ? resumeLIdx : firstLIdx;

        if (startSIdx !== -1) {
            setTimeout(async () => {
                window.playLesson(startSIdx, startLIdx);
                await syncCourseProgress();
            }, 10);
        } else {
            document.getElementById('li-lesson-title').textContent = "No content available.";
        }

    } catch (e) {
        console.error("Error loading learning interface:", e);
        document.getElementById('li-lesson-title').textContent = "Error loading course content.";
    }

    // Tab switching
    const tabButtons = document.querySelectorAll('#li-tabs button');
    const tabContents = document.querySelectorAll('.tab-content');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => {
                b.className = b.className.replace('border-primary text-primary active-tab', 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200');
            });
            btn.className = btn.className.replace('border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200', 'border-primary text-primary active-tab');
            tabContents.forEach(c => c.classList.add('hidden'));
            const targetContent = document.getElementById('tab-content-' + btn.getAttribute('data-tab'));
            if (targetContent) targetContent.classList.remove('hidden');
        });
    });
});
