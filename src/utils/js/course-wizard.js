/**
 * Course Creation Wizard Logic with Supabase Backend
 */
import { CourseService } from '/src/services/courseService.js';
import { AuthService } from '/src/services/authService.js';
import { financeSettingsService } from '/src/services/financeSettingsService.js';
import { getEmbedUrl } from '/src/utils/js/videoEmbed.js';

// Global state
window.sessionUploadedFiles = window.sessionUploadedFiles || [];
window.courseDraft = {
    title: '',
    subtitle: '',
    description: '',
    category_id: '',
    level: 'Beginner',
    thumbnail_url: null,
    intro_video_url: null,
    curriculum: [],
    pricing: {
        type: 'free',
        currency: 'USD',
        price: null,
        coupon: '',
        coupon_percent: null,
        coupon_start: null,
        coupon_expiry: null
    },
    privacy: 'public',
    status: 'draft',
    isLoaded: true // NEW courses are always "loaded" - no DB data to protect
};

window.currentStep = 1;
window.totalSteps = 4;
window.draggedSectionIdx = null;
window.draggedItemInfo = null;
window.categoriesList = [];

/**
 * Per-lesson video upload state registry.
 * IMPORTANT: This is RUNTIME-ONLY state (cleared on page refresh).
 * The DB / courseDraft remain authoritative for already-saved videos.
 *
 * Shape: lessonVideoState[lessonId] = {
 *   phase: 'idle'|'uploading'|'completing'|'pending_save'|'saving'|'saved'|'cancelling'|'error',
 *   progress: 0,          // 0–100
 *   fileName: '',
 *   fileSize: 0,
 *   objectKey: null,      // R2 object key after multipart-complete
 *   uploadId: null,       // multipart uploadId needed for mid-upload abort
 *   abortController: null,
 *   cancelAfterComplete: false, // race-condition flag: Cancel fired during 'completing'
 *   prevSavedVideo: null, // snapshot of item.video before replacement starts
 *   sIdx: -1,             // curriculum indices for card updates
 *   iIdx: -1,
 *   errorMessage: ''
 * }
 */
window.lessonVideoState = {};

/** Return or create an idle state entry for a lesson. */
function getLessonVideoState(lessonId) {
    if (!window.lessonVideoState[lessonId]) {
        window.lessonVideoState[lessonId] = {
            phase: 'idle', progress: 0,
            fileName: '', fileSize: 0,
            objectKey: null, uploadId: null,
            abortController: null,
            cancelAfterComplete: false,
            prevSavedVideo: null,
            sIdx: -1, iIdx: -1,
            errorMessage: ''
        };
    }
    return window.lessonVideoState[lessonId];
}

// Drag & drop + inline edit handlers (used in dynamically rendered HTML)
// Note: Register globals at the end using registerGlobals()


// Saving State & Queue
let isSaving = false;
let pendingSave = false;
let saveTimeout = null;
const SAVE_DEBOUNCE_MS = 1500;

// Helper to get localStorage key for last visited step
function getStepKey(courseId) {
    return courseId ? `wizard_step_${courseId}` : null;
}
// Persist last visited step to localStorage
function persistStep(courseId, step) {
    const key = getStepKey(courseId);
    if (key) localStorage.setItem(key, String(step));
}
// Restore last visited step from localStorage
function restoreStep(courseId) {
    const key = getStepKey(courseId);
    if (!key) return 1;
    return parseInt(localStorage.getItem(key) || '1', 10) || 1;
}

function showSavingIndicator() {
    const el = document.getElementById('save-status');
    if (el) {
        el.classList.remove('hidden');
        el.classList.add('flex');
    }
}

function hideSavingIndicator() {
    const el = document.getElementById('save-status');
    if (el) {
        el.classList.add('hidden');
        el.classList.remove('flex');
    }
}

window.applyVideoUploadGating = function(settings) {
    const isLegacyVideosEnabled = settings.self_hosted_video_uploads_enabled === true;
    
    // Gating for Course Wizard Intro Video
    const introVideoUploader = document.getElementById('intro-video-upload-section');
    const introVideoGuidance = document.getElementById('youtube-unlisted-guidance');
    if (introVideoUploader && introVideoGuidance) {
        if (isLegacyVideosEnabled) {
            introVideoUploader.classList.remove('hidden');
            introVideoGuidance.classList.add('hidden');
        } else {
            introVideoUploader.classList.add('hidden');
            introVideoGuidance.classList.remove('hidden');
        }
    }
    
    // Gating for Modal Lesson Video
    const modalVideoUploader = document.getElementById('modal-file-upload-section');
    const modalVideoUrlSection = document.getElementById('modal-video-url-section');
    const modalVideoGuidance = document.getElementById('modal-youtube-guidance');
    const modalProviderToggle = document.getElementById('modal-video-provider-toggle');
    
    if (modalVideoUploader && modalVideoGuidance && modalProviderToggle) {
        if (isLegacyVideosEnabled) {
            modalProviderToggle.classList.remove('hidden');
            modalVideoGuidance.classList.add('hidden');
            
            // Initial state based on checked radio
            const selectedProvider = document.querySelector('input[name="modal-provider-radio"]:checked')?.value || 'youtube';
            if (selectedProvider === 'r2') {
                modalVideoUploader.classList.remove('hidden');
                modalVideoUrlSection.classList.add('hidden');
            } else {
                modalVideoUploader.classList.add('hidden');
                modalVideoUrlSection.classList.remove('hidden');
            }
            
            // Listen to radio changes
            document.querySelectorAll('input[name="modal-provider-radio"]').forEach(radio => {
                // Ensure we don't bind multiple times
                radio.removeEventListener('change', window._modalRadioHandler);
                window._modalRadioHandler = (e) => {
                    if (e.target.value === 'r2') {
                        modalVideoUploader.classList.remove('hidden');
                        modalVideoUrlSection.classList.add('hidden');
                    } else {
                        modalVideoUploader.classList.add('hidden');
                        modalVideoUrlSection.classList.remove('hidden');
                    }
                };
                radio.addEventListener('change', window._modalRadioHandler);
            });
        } else {
            modalProviderToggle.classList.add('hidden');
            modalVideoUploader.classList.add('hidden');
            modalVideoUrlSection.classList.remove('hidden');
            modalVideoGuidance.classList.remove('hidden');
        }
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Load Categories and Finance Settings
    try {
        const [categories, settings] = await Promise.all([
            CourseService.getCategories(),
            financeSettingsService.getSettings()
        ]);
        window.categoriesList = categories;
        window.financeSettings = settings;
        renderCategories();
        window.applyVideoUploadGating(settings);
    } catch (e) {
        console.error("Failed to load initial data", e);
        window.financeSettings = { is_monetization_enabled: false, instructor_percentage: 100 }; // Fallback
        window.applyVideoUploadGating(window.financeSettings);
    }

    // 2. Check URL for existing course ID
    const urlParams = new URLSearchParams(window.location.search);
    const courseId = urlParams.get('id');
    if (courseId) {
        await loadDraft(courseId);
        // Restore the last visited step from localStorage
        const savedStep = restoreStep(courseId);
        if (savedStep > 1) {
            goToStep(savedStep);
        } else {
            updateUI();
        }
    } else {
        updateUI();
    }

    await setupEventListeners();
    setupInputStability();
});

async function loadDraft(courseId) {
    try {
        const course = await CourseService.getCourseFull(courseId);
        if (!course) return;

        window.courseDraft = {
            id: course.id,
            title: course.title || '',
            subtitle: course.subtitle || '',
            description: course.description || '',
            category_id: course.category_id || '',
            level: course.level || 'Beginner',
            thumbnail_url: course.thumbnail_url || null,
            intro_video_url: course.intro_video_url || null,
            curriculum: [],
            pricing: {
                type: course.price_type || 'free',
                currency: course.currency || 'USD',
                price: course.price != null ? parseFloat(course.price) : null,
                coupons: course.course_coupons || []
            },
            privacy: course.is_public ? 'public' : 'private',
            certificate_enabled: course.certificate_enabled || false,
            status: course.status || 'draft',
            has_rejection_history: (course.course_moderation_logs || []).some(log => log.decision === 'rejected'),
            isLoaded: false // Safety flag to prevent accidental wiping of DB
        };

        // Map sections and lessons
        if (course.course_sections) {
            // getCourseFull already sorts sections/lessons/questions client-side,
            // but we use ?? 0 fallback here just in case.
            window.courseDraft.curriculum = (course.course_sections || [])
                .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
                .map(sec => ({
                    id: sec.id,
                    title: sec.title,
                    items: (sec.course_lessons || [])
                        .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
                        .map(les => {
                            const contentType = les.content_type || 'text';
                            const normalizeToArray = (val) => val ? (Array.isArray(val) ? val : [val]) : [];

                            const lessonQuizzes = normalizeToArray(les.quizzes);

                            return {
                                id: les.id,
                                title: les.title,
                                description: les.description || '',
                                content_type: contentType,
                                is_preview: les.is_preview || false,
                                order_index: les.order_index ?? 0,
                                video_storage_key: les.video_storage_key || null,
                                video_provider: les.video_provider || null,
                                video: (contentType === 'video' || les.video_url || les.video_storage_key)
                                    ? { url: les.video_url || null, title: les.description || 'Video Lecture' }
                                    : null,
                                resources: normalizeToArray(les.lesson_resources).map(r => ({
                                    id: r.id,
                                    title: r.title || 'Resource',
                                    file_url: r.file_url || '',
                                    file_type: r.file_type ?? 'unknown'
                                })),
                                quiz: lessonQuizzes.map(qz => ({
                                    id: qz.id,
                                    title: qz.title || 'Quiz',
                                    description: qz.description || '',
                                    questions: normalizeToArray(qz.questions)
                                        .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
                                        .map((q, qIdx) => ({
                                            id: q.id,
                                            text: q.question_text || q.text || '',
                                            question_text: q.question_text || q.text || '',
                                            order_index: q.order_index ?? qIdx,
                                            options: normalizeToArray(q.options)
                                                .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
                                                .map((o, oIdx) => ({
                                                    id: o.id,
                                                    text: o.option_text || o.text || '',
                                                    option_text: o.option_text || o.text || '',
                                                    correct: o.is_correct ?? o.correct ?? false,
                                                    is_correct: o.is_correct ?? o.correct ?? false,
                                                    order_index: o.order_index ?? oIdx
                                                }))
                                        }))
                                }))
                            };
                        })
                }));
        }

        // Store instructor details for preview if available
        if (course.instructor) {
            window.courseDraft.instructor_name = course.instructor.full_name;
            window.courseDraft.instructor_avatar = course.instructor.avatar_url;
        }

        // Update UI components
        const titleEl = document.getElementById('course-title');
        if (titleEl) titleEl.value = window.courseDraft.title;
        
        const subtitleEl = document.getElementById('course-subtitle');
        if (subtitleEl) subtitleEl.value = window.courseDraft.subtitle;
        
        const descEl = document.getElementById('description') || document.getElementById('course-description');
        if (descEl) descEl.value = window.courseDraft.description;
        
        const levelEl = document.getElementById('course-level');
        if (levelEl) levelEl.value = window.courseDraft.level;
        
        const catEl = document.getElementById('course-category');
        if (catEl) catEl.value = window.courseDraft.category_id;
        
        if (window.courseDraft.thumbnail_url) showThumbnailPreview(window.courseDraft.thumbnail_url);
        if (window.courseDraft.intro_video_url) showVideoPreview(window.courseDraft.intro_video_url, "Introduction Video");
        
        const certToggle = document.getElementById('certificate-enabled-toggle');
        if (certToggle) certToggle.checked = window.courseDraft.certificate_enabled;

        window.courseDraft.isLoaded = true; // Mark as safely loaded
        renderCurriculum();
        renderFinalPreview();
    } catch (e) {
        console.error("Failed to load course draft:", e);
        if (typeof showToast === 'function') {
            showToast("Error loading course draft: " + e.message, true);
        }
    }
}

// --- STATE MANAGEMENT & PERSISTENCE ---

/**
 * Debounced Save Draft - returns a Promise that resolves when save completes.
 */
window.saveDraft = function(silent = false) {
    if (saveTimeout) clearTimeout(saveTimeout);
    
    // If already saving, mark for re-save and return the promise of the current save
    if (isSaving) {
        pendingSave = true;
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        saveTimeout = setTimeout(async () => {
            try {
                await performSave(silent);
                resolve();
            } catch (e) {
                resolve(); // Don't reject - caller should not crash on save error
            }
        }, silent ? SAVE_DEBOUNCE_MS : 50);
    });
};

async function performSave(silent = false) {
    if (isSaving) {
        pendingSave = true;
        return;
    }

    // CRITICAL SAFETY CHECK
    if (window.courseDraft.id && !window.courseDraft.isLoaded) {
        console.warn("Safety Check: Blocking save of partially loaded course.");
        return;
    }

    isSaving = true;
    showSavingIndicator();

    try {
        console.log('=== Starting Atomic Course Sync ===');

        // --- STEP 1: Save Course Basic Info ---
        const payload = {
            id: window.courseDraft.id,
            title: window.courseDraft.title || 'Untitled Course',
            subtitle: window.courseDraft.subtitle || '',
            description: window.courseDraft.description || '',
            category_id: window.courseDraft.category_id || null,
            level: window.courseDraft.level || 'Beginner',
            thumbnail_url: window.courseDraft.thumbnail_url || null,
            intro_video_url: window.courseDraft.intro_video_url || null,
            price_type: window.courseDraft.pricing.type || 'free',
            price: (window.courseDraft.pricing.price != null && !isNaN(parseFloat(window.courseDraft.pricing.price)))
                ? parseFloat(window.courseDraft.pricing.price)
                : null,
            currency: window.courseDraft.pricing.currency || 'USD',
            is_public: window.courseDraft.privacy === 'public',
            certificate_enabled: window.courseDraft.certificate_enabled === true,
            status: window.courseDraft.status || 'draft'
        };

        const savedCourse = await CourseService.saveDraft(payload);
        window.courseDraft.id = savedCourse.id;
        console.log('Basic info saved, ID:', savedCourse.id);

        // --- STEP 2: Patch-only Curriculum Sync (Sections, Lessons) ---
        // Pre-process curriculum to ensure order_index is set and field names are normalized
        window.courseDraft.curriculum = (window.courseDraft.curriculum || []).map((sec, sIdx) => ({
            ...sec,
            order_index: sec.order_index ?? sIdx,
            items: (sec.items || []).map((les, lIdx) => ({
                ...les,
                video_url: les.video?.url || les.video_url, // 🔥 Map frontend shape to DB shape
                order_index: les.order_index ?? lIdx,
                quiz: (les.quiz || []).map(qz => ({
                    ...qz,
                    questions: (qz.questions || []).map((q, qIdx) => ({
                        ...q,
                        order_index: q.order_index ?? qIdx
                    }))
                }))
            }))
        }));


        console.log('Starting granular curriculum sync...');

        await Promise.all(window.courseDraft.curriculum.map(async (section, sIdx) => {
            const savedSection = await CourseService.saveSection(savedCourse.id, {
                ...section,
                order_index: sIdx
            });
            section.id = savedSection.id;

            await Promise.all(section.items.map(async (lesson, lIdx) => {
                const savedLesson = await CourseService.saveLesson(savedSection.id, {
                    ...lesson,
                    order_index: lIdx
                });
                lesson.id = savedLesson.id;
            }));
        }));

        // --- STEP 3: Save Coupons (optional array) ---
        if (window.courseDraft.id) {
            try {
                // Clear existing coupons first
                await CourseService.deleteCoupon(window.courseDraft.id);
                // Insert validated ones
                if (window.courseDraft.pricing.coupons && window.courseDraft.pricing.coupons.length > 0) {
                    for (const cp of window.courseDraft.pricing.coupons) {
                        if (cp.code && cp.percent && getCouponFinalPrice(window.courseDraft.pricing.price, cp.percent) > 0) {
                            await CourseService.saveCoupon(
                                window.courseDraft.id,
                                cp.code,
                                cp.percent,
                                cp.expiry || null,
                                null // No start date required by UI spec
                            );
                        }
                    }
                }
            } catch (e) {
                console.warn("Coupon save warning:", e.message);
            }
        }

        console.log('=== Sync Complete ===');

        if (!silent && typeof showToast === 'function') {
            showToast('Draft saved successfully.');
        }

    } catch (e) {
        console.error("Save failure:", e);
        if (!silent && typeof showToast === 'function') {
            showToast('Failed to save draft. Check connection.', true);
        }
    } finally {
        isSaving = false;
        hideSavingIndicator();
        if (pendingSave) {
            pendingSave = false;
            performSave(true);
        }
    }
}

// Utility to check if an ID is a valid established UUID (not temp)
function isValidUuid(id) {
    if (!id || typeof id !== 'string') return false;
    if (id.startsWith('temp_') || id.startsWith('new_')) return false;
    return id.length === 36;
}

function renderCategories() {
    const select = document.getElementById('course-category');
    if (!select) return;
    select.innerHTML = '<option value="">Select a category</option>';
    window.categoriesList.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.innerText = c.name;
        select.appendChild(opt);
    });
}

// --- NAVIGATION ---

function goToStep(stepNumber) {
    if (stepNumber < 1 || stepNumber > window.totalSteps) return;
    
    // Prevent navigating away if the course is already published/under review (Step 5)
    if (window.currentStep === 5) return;

    saveCurrentStepData();

    document.querySelectorAll('.wizard-step').forEach(el => {
        el.classList.add('hidden');
        el.classList.remove('block');
    });

    const currContainer = document.getElementById(`step-${stepNumber}-container`);
    if (currContainer) {
        currContainer.classList.remove('hidden');
        currContainer.classList.add('block');
    }

    window.currentStep = stepNumber;
    // Persist the step in localStorage so the wizard can restore it on next visit
    persistStep(window.courseDraft.id, stepNumber);
    updateUI();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function wizardNextStep() {
    if (validateStep(window.currentStep)) {
        goToStep(window.currentStep + 1);
    }
}

function prevStep() {
    goToStep(window.currentStep - 1);
}

function updateUI() {
    // 1. Update Progress Bar
    const pb = document.getElementById('progress-bar');
    if (pb) pb.style.width = `${(window.currentStep / window.totalSteps) * 100}%`;

    // 2. Update Step Subtitle
    const subtitles = [
        "Step 1 of 4: Basic Information",
        "Step 2 of 4: Curriculum",
        "Step 3 of 4: Pricing",
        "Step 4 of 4: Publish & Preview"
    ];
    const subEl = document.getElementById('step-subtitle');
    if (subEl) subEl.textContent = subtitles[window.currentStep - 1] || '';

    // 3. Update Visual Indicators
    document.querySelectorAll('.step-ind').forEach(el => {
        const s = parseInt(el.getAttribute('data-step'));
        const iconBg = el.querySelector('.icon-bg');
        const titleText = el.querySelector('.title-text');

        const icons = ['info', 'menu_book', 'payments', 'publish'];

        if (s < window.currentStep) {
            iconBg.className = 'w-10 h-10 rounded-full bg-blue-100 text-primary flex items-center justify-center transition icon-bg';
            iconBg.innerHTML = '<span class="material-icons text-xl">check_circle</span>';
            titleText.className = 'text-xs font-semibold text-slate-400 uppercase tracking-wider title-text transition';
        } else if (s === window.currentStep) {
            iconBg.className = 'w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center ring-4 ring-blue-50 dark:ring-blue-900/30 transition icon-bg';
            iconBg.innerHTML = `<span class="material-icons text-xl">${icons[s - 1]}</span>`;
            titleText.className = 'text-xs font-semibold text-primary uppercase tracking-wider title-text transition';
        } else {
            iconBg.className = 'w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 flex items-center justify-center transition group-hover:bg-slate-300 dark:group-hover:bg-slate-700 icon-bg';
            iconBg.innerHTML = `<span class="material-icons text-xl">${icons[s - 1]}</span>`;
            titleText.className = 'text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider title-text transition';
        }
    });

    // 4. Update Navigation Buttons
    const btnNext = document.getElementById('btn-next');
    const btnPrev = document.getElementById('btn-prev');
    const btnPublish = document.getElementById('btn-publish');

    if (btnPrev) {
        if (window.currentStep === 1) {
            btnPrev.disabled = true;
            btnPrev.classList.add('opacity-50', 'cursor-not-allowed');
        } else {
            btnPrev.disabled = false;
            btnPrev.classList.remove('opacity-50', 'cursor-not-allowed');
            btnPrev.classList.add('hover:bg-slate-100', 'dark:hover:bg-slate-800');
        }
    }

    if (btnNext && btnPublish) {
        if (window.currentStep === window.totalSteps) {
            btnNext.classList.add('hidden');
            btnPublish.classList.remove('hidden');
            
            // 🔥 Update button text if there is rejection history
            if (window.courseDraft.has_rejection_history) {
                btnPublish.innerHTML = `
                    Republish Course
                    <span class="material-icons">check_circle</span>
                `;
                btnPublish.classList.replace('bg-green-600', 'bg-amber-600');
                btnPublish.classList.replace('hover:bg-green-700', 'hover:bg-amber-700');
                btnPublish.classList.replace('shadow-green-500/20', 'shadow-amber-500/20');
            } else {
                btnPublish.innerHTML = `
                    Publish Course
                    <span class="material-icons">check_circle</span>
                `;
                btnPublish.classList.replace('bg-amber-600', 'bg-green-600');
                btnPublish.classList.replace('hover:bg-amber-700', 'hover:bg-green-700');
                btnPublish.classList.replace('shadow-amber-500/20', 'shadow-green-500/20');
            }

            renderFinalPreview();
        } else {
            btnNext.classList.remove('hidden');
            btnPublish.classList.add('hidden');
        }
    }

    populateFields();
}

async function saveCurrentStepData(shouldSaveToDb = false) {
    if (window.currentStep === 1) {
        window.courseDraft.title = document.getElementById('course-title')?.value || '';
        window.courseDraft.subtitle = document.getElementById('course-subtitle')?.value || '';
        window.courseDraft.description = 
            document.getElementById('course-description')?.value || 
            document.getElementById('description')?.value || '';

        let catSelect = document.getElementById('course-category')?.value;
        if (catSelect === 'ADD_NEW') {
            const newName = prompt("Enter new category name:");
            if (newName && newName.trim()) {
                try {
                    const newCat = await CourseService.createCategory(newName.trim());
                    window.categoriesList.push(newCat);
                    renderCategories();
                    document.getElementById('course-category').value = newCat.id;
                    window.courseDraft.category_id = newCat.id;
                } catch (e) {
                    alert('Error adding category. It may already exist.');
                    document.getElementById('course-category').value = '';
                }
            } else {
                document.getElementById('course-category').value = '';
            }
        } else {
            window.courseDraft.category_id = catSelect || '';
        }

        window.courseDraft.level = document.getElementById('course-level')?.value || 'Beginner';
    } else if (window.currentStep === 3) {
        window.courseDraft.pricing.currency = document.getElementById('course-currency')?.value || 'USD';
        
        // 🔥 CRITICAL: Match DB column 'price' instead of just local draft state
        const priceVal = parseFloat(document.getElementById('course-price')?.value);
        window.courseDraft.pricing.price = isNaN(priceVal) ? null : priceVal;
        
        syncCourseCoupons();
    } else if (window.currentStep === 4) {
        const privacyEl = document.querySelector('input[name="privacy"]:checked');
        if (privacyEl) {
            window.courseDraft.is_public = (privacyEl.value === 'public');
            window.courseDraft.privacy = privacyEl.value; // Keep for UI sync
        }
    }

    // Only save to DB if explicitly requested (e.g., Save Draft, Next on Step 4, or Publish)
    if (shouldSaveToDb) {
        await window.saveDraft(false); 
    }
}

function populateFields() {
    // Comprehensive UI restoration from window.courseDraft
    if (window.currentStep === 1) {
        const titleEl = document.getElementById('course-title');
        const subtitleEl = document.getElementById('course-subtitle');
        const descEl = document.getElementById('description') || document.getElementById('course-description');
        const levelEl = document.getElementById('course-level');
        const catEl = document.getElementById('course-category');

        if (titleEl) titleEl.value = window.courseDraft.title || '';
        if (subtitleEl) subtitleEl.value = window.courseDraft.subtitle || '';
        if (descEl) descEl.value = window.courseDraft.description || '';
        if (levelEl) levelEl.value = window.courseDraft.level || 'Beginner';
        if (catEl) catEl.value = window.courseDraft.category_id || '';

        // Restore Asset Previews
        if (window.courseDraft.thumbnail_url) showThumbnailPreview(window.courseDraft.thumbnail_url);
        if (window.courseDraft.intro_video_url) showVideoPreview(window.courseDraft.intro_video_url, "Introduction Video");

    } else if (window.currentStep === 2) {
        renderCurriculum();
    } else if (window.currentStep === 3) {
        // 1. First: set the pricing type toggle (free/paid) and enable/disable the container.
        //    For 'paid' this does NOT clear the price. For 'free' it sets price to null.
        //    We call this BEFORE setting the input so the container is enabled.
        const savedPrice = window.courseDraft.pricing.price;
        setPricingTier(window.courseDraft.pricing.type);

        // 2. Restore price after calling setPricingTier (so 'paid' re-enabling doesn't interfere)
        const priceEl = document.getElementById('course-price');
        if (priceEl && savedPrice != null) {
            priceEl.value = savedPrice;
            window.courseDraft.pricing.price = savedPrice; // re-hydrate in case setPricingTier cleared it
        }

        // 3. Render existing coupons
        renderCourseCoupons();

        // 4. Recalculate payout display
        calculatePayout();
    } else if (window.currentStep === 4) {
        renderFinalPreview();
    }
}

async function setupEventListeners() {
    document.getElementById('certificate-enabled-toggle')?.addEventListener('change', (e) => {
        window.courseDraft.certificate_enabled = e.target.checked;
        window.saveDraft(true);
    });

    // Nav Buttons
    document.getElementById('btn-next')?.addEventListener('click', () => {
        // Trigger a background save
        const saveToDb = (window.currentStep === 3);
        saveCurrentStepData(saveToDb);
        if (validateStep(window.currentStep)) goToStep(window.currentStep + 1);
    });

    // Save draft top nav bar button
    document.getElementById('btn-save-draft-nav')?.addEventListener('click', () => {
        saveDraftManual();
    });

    document.getElementById('btn-prev')?.addEventListener('click', () => goToStep(window.currentStep - 1));
    
    document.getElementById('btn-publish')?.addEventListener('click', async () => {
        // Full save to DB before publishing
        await saveCurrentStepData(true);
        publishCourse();
    });

    // Step Indicators (Clickable)
    document.querySelectorAll('.step-ind').forEach(el => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', async () => {
            const step = parseInt(el.getAttribute('data-step'));
            // Save locally only
            await saveCurrentStepData(false);
            if (step < window.currentStep || (step > window.currentStep && validateStep(window.currentStep))) {
                goToStep(step);
            }
        });
    });

    document.querySelectorAll('.course-input').forEach(input => {
        // Validation listeners
        input.addEventListener('input', (e) => {
            if (e.target.value.trim()) {
                e.target.classList.remove('border-red-500', 'ring-1', 'ring-red-500');
            }
        });
    });

    // Categories specifically 
    document.getElementById('course-category')?.addEventListener('change', (e) => {
        if (e.target.value) {
            e.target.classList.remove('border-red-500', 'ring-1', 'ring-red-500');
        }
        saveCurrentStepData(false);
    });

    // Thumbnail upload logic mapped to DB
    const thumbUpload = document.getElementById('thumbnail-upload');
    if (thumbUpload) {
        thumbUpload.addEventListener('change', async function (e) {
            if (e.target.files && e.target.files[0]) {
                const file = e.target.files[0];
                const btn = document.getElementById('btn-upload-thumbnail');
                if (btn) { btn.setAttribute('data-orig', btn.innerText); btn.innerText = 'Uploading...'; btn.disabled = true; }

                try {
                    // Ensure we have a course ID before uploading
                    if (!window.courseDraft.id) await performSave(true);
                    const url = await CourseService.uploadCourseThumbnail(window.courseDraft.id, file);
                    window.sessionUploadedFiles.push({ provider: 'supabase', bucket: 'course_thumbnails', url: url });
                    window.courseDraft.thumbnail_url = url;
                    showThumbnailPreview(url);
                    window.saveDraft(true);
                } catch (err) {
                    console.error('Thumbnail upload error:', err);
                    alert('Upload failed. Please check your storage bucket configuration.');
                    if (btn) btn.innerText = btn.getAttribute('data-orig') || 'Upload File';
                } finally {
                    if (btn) btn.disabled = false;
                }
            }
        });
    }

// Intro Video upload logic
    const vidUpload = document.getElementById('video-upload');
    if (vidUpload) {
        vidUpload.addEventListener('change', async function (e) {
            if (e.target.files && e.target.files[0]) {
                const file = e.target.files[0];
                const btn = document.getElementById('btn-upload-video');
                const progressContainer = document.getElementById('intro-upload-progress-container');
                const progressBar = document.getElementById('intro-upload-progress-bar');
                const percentText = document.getElementById('intro-upload-percent');

                if (btn) { btn.setAttribute('data-orig', btn.innerText); btn.innerText = 'Initializing...'; btn.disabled = true; }
                if (progressContainer) {
                    progressContainer.classList.remove('hidden');
                    progressBar.style.width = '0%';
                    percentText.innerText = '0%';
                }

                try {
                    // Ensure we have a course ID before uploading
                    if (!window.courseDraft.id) await performSave(true);
                    
                    if (btn) btn.innerText = 'Uploading...';
                    
                    window.introUploadAbortController = new AbortController();
                    
                    const cancelBtn = document.getElementById('modal-upload-cancel');
                    if (cancelBtn) {
                        cancelBtn.onclick = () => {
                            if (window.introUploadAbortController) {
                                window.introUploadAbortController.abort();
                            }
                        };
                    }

                    const uploadResult = await CourseService.uploadToR2(window.courseDraft.id, null, 'intro', file, (percent) => {
                        if (progressBar) progressBar.style.width = `${percent}%`;
                        if (percentText) percentText.innerText = `${Math.round(percent)}%`;
                    }, window.introUploadAbortController.signal);
                    
                    window.sessionUploadedFiles.push({ provider: 'r2', key: uploadResult.objectKey });

                    window.courseDraft.intro_video_provider = 'r2';
                    window.courseDraft.intro_video_storage_key = uploadResult.objectKey;
                    window.courseDraft.intro_video_url = null; // Clear old URL

                    // We can't generate a stable playback URL here without invoking the R2 presigned GET, 
                    // so we just show the filename. The learning interface handles GET URLs.
                    showVideoPreview('', file.name);
                    window.saveDraft(true);
                } catch (err) {
                    console.error('Video upload error:', err);
                    alert('Upload failed: ' + err.message);
                } finally {
                    if (btn) btn.innerText = btn.getAttribute('data-orig') || 'Choose File';
                    if (btn) btn.disabled = false;
                    setTimeout(() => { if (progressContainer) progressContainer.classList.add('hidden'); }, 2000);
                }
            }
        });
    }

    // Intro Video URL Save Logic
    const introUrlInput = document.getElementById('intro-video-embed-url');
    const introUrlSaveBtn = document.getElementById('btn-save-intro-url');
    if (introUrlInput && introUrlSaveBtn) {
        introUrlSaveBtn.addEventListener('click', async function () {
            const url = introUrlInput.value.trim();
            if (!url) return;
            const embedSrc = getEmbedUrl(url);
            if (!embedSrc) {
                const errEl = document.getElementById('intro-video-url-error');
                if (errEl) {
                    errEl.textContent = 'Please enter a valid YouTube or Vimeo URL.';
                    errEl.classList.remove('hidden');
                } else {
                    alert('Please enter a valid YouTube or Vimeo URL.');
                }
                return;
            }
            const errEl = document.getElementById('intro-video-url-error');
            if (errEl) errEl.classList.add('hidden');
            
            if (!window.courseDraft.id) await performSave(true);
            window.courseDraft.intro_video_provider = 'youtube';
            window.courseDraft.intro_video_url = url;
            window.courseDraft.intro_video_storage_key = null; // Clear R2 key

            showVideoPreview(url, "Embedded Video");
            window.saveDraft(true);
            introUrlInput.value = '';
            if (typeof showToast === 'function') showToast("Intro video URL saved.");
        });
    }

    // Modal File Uploads
    const modalVidUpload = document.getElementById('modal-video-upload');
    if (modalVidUpload) {
        modalVidUpload.addEventListener('change', async function (e) {
            if (e.target.files && e.target.files[0]) {
                const file = e.target.files[0];
                
                if (activeModalItemIdx === -1) return;
                const item = window.courseDraft.curriculum[activeModalSectionIdx].items[activeModalItemIdx];
                const st = getLessonVideoState(item.id);

                if (st.phase === 'uploading' || st.phase === 'completing' || st.phase === 'saving') {
                    alert("An upload is already in progress for this lesson. Please wait or cancel it first.");
                    modalVidUpload.value = ''; // clear selection
                    return;
                }

                // If replacing an existing saved video, snapshot it so we can restore on cancel
                if (item.video_storage_key || (item.video && item.video.url)) {
                    st.prevSavedVideo = JSON.parse(JSON.stringify({ 
                        video: item.video, 
                        video_storage_key: item.video_storage_key 
                    }));
                } else {
                    st.prevSavedVideo = null;
                }

                const display = document.getElementById('modal-video-name-display');
                if (display) display.innerText = file.name;

                const progressContainer = document.getElementById('modal-upload-progress-container');
                const progressBar = document.getElementById('modal-upload-progress-bar');
                const percentText = document.getElementById('modal-upload-percent');

                if (progressContainer) {
                    progressContainer.classList.remove('hidden');
                    progressBar.style.width = '0%';
                    percentText.innerText = '0%';
                }

                st.phase = 'uploading';
                st.progress = 0;
                st.fileName = file.name;
                st.fileSize = file.size;
                st.sIdx = activeModalSectionIdx;
                st.iIdx = activeModalItemIdx;
                st.abortController = new AbortController();
                st.cancelAfterComplete = false;
                st.errorMessage = '';

                updateLessonVideoCardUI(st.sIdx, st.iIdx);

                try {
                    const uploadResult = await CourseService.uploadToR2(
                        window.courseDraft.id, item.id, 'lesson', file, (percent) => {
                            st.progress = percent;
                            // Only update modal DOM if this modal is currently open and showing the active lesson
                            if (activeModalItemIdx === st.iIdx && activeModalSectionIdx === st.sIdx) {
                                if (progressBar) progressBar.style.width = `${percent}%`;
                                if (percentText) percentText.innerText = `${Math.round(percent)}%`;
                            }
                            updateLessonVideoCardUI(st.sIdx, st.iIdx);
                        }, st.abortController.signal
                    );
                    
                    window.sessionUploadedFiles.push({ provider: 'r2', key: uploadResult.objectKey });

                    // Race condition: if cancel clicked just as completion returns
                    if (st.cancelAfterComplete) {
                        st.phase = 'cancelling';
                        await CourseService.discardStagedUpload(window.courseDraft.id, uploadResult.objectKey);
                        throw new Error('Upload cancelled');
                    }

                    st.objectKey = uploadResult.objectKey;
                    st.phase = 'pending_save';
                    
                    if (activeModalItemIdx === st.iIdx && activeModalSectionIdx === st.sIdx) {
                        if (percentText) percentText.innerText = 'Upload complete! Click Save Video';
                        if (progressBar) progressBar.style.width = '100%';
                        const errEl = document.getElementById('modal-video-url-error');
                        if (errEl) errEl.classList.add('hidden');
                    }
                    updateLessonVideoCardUI(st.sIdx, st.iIdx);

                } catch (err) {
                    if (err.message !== 'Upload cancelled' && st.phase !== 'cancelling') {
                        console.error('Modal upload failed:', err);
                        st.phase = 'error';
                        st.errorMessage = 'Upload failed: ' + err.message;
                    } else {
                        // User cancelled
                        st.phase = 'idle';
                    }
                    
                    if (activeModalItemIdx === st.iIdx && activeModalSectionIdx === st.sIdx) {
                        const errEl = document.getElementById('modal-video-url-error');
                        if (errEl) {
                            errEl.textContent = st.errorMessage || 'Upload cancelled.';
                            errEl.classList.remove('hidden');
                        }
                        if (progressContainer) progressContainer.classList.add('hidden');
                    }
                    updateLessonVideoCardUI(st.sIdx, st.iIdx);
                }
            }
        });
    }

    const modalResUpload = document.getElementById('modal-resource-upload');
    if (modalResUpload) {
        modalResUpload.addEventListener('change', function (e) {
            if (e.target.files && e.target.files[0]) {
                const display = document.getElementById('modal-resource-name-display');
                if (display) display.innerText = e.target.files[0].name;
            }
        });
    }

    // Privacy Radio Buttons Styling
    document.querySelectorAll('input[name="privacy"]').forEach(radio => {
        radio.addEventListener('change', function () {
            document.querySelectorAll('input[name="privacy"]').forEach(r => {
                const label = r.closest('label');
                if (!label) return;
                if (r.checked) {
                    label.classList.add('border-primary', 'bg-primary/5');
                    label.classList.remove('border-slate-200', 'hover:border-slate-300');
                } else {
                    label.classList.remove('border-primary', 'bg-primary/5');
                    label.classList.add('border-slate-200', 'hover:border-slate-300');
                }
            });
            window.saveDraft(true);
        });
    });

    // Header & User Data - Consolidated
    if (typeof loadUserProfile === 'undefined') {
        window.loadUserProfile = async function() {
            try {
                const profile = await AuthService.getCurrentProfile();
                if (profile) {
                    window.courseDraft.instructor_name = profile.full_name;
                    window.courseDraft.instructor_avatar = profile.avatar_url;
                    
                    // Update header if applicable
                    const headName = document.getElementById('user-name');
                    if (headName) headName.innerText = profile.full_name;
                    
                    const avatarContainer = document.getElementById('user-avatar-container');
                    if (avatarContainer && profile.avatar_url) {
                        avatarContainer.innerHTML = `<img src="${profile.avatar_url}" class="w-full h-full object-cover rounded-full" alt="User Avatar">`;
                    }
                    
                    // Trigger preview update if we are on step 4
                    if (window.currentStep === 4) renderFinalPreview();
                }
            } catch (e) {
                console.error("Error loading user profile:", e);
            }
        };
    }
    await window.loadUserProfile();

    document.getElementById('course-price')?.addEventListener('input', () => {
        calculatePayout();
        syncCourseCoupons();
        validatePricingCoupons(true);
    });
    document.getElementById('course-coupons-container')?.addEventListener('input', () => {
        syncCourseCoupons();
        validatePricingCoupons(true);
    });

    // Theme Toggle
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const html = document.documentElement;
            if (html.classList.contains('dark')) {
                html.classList.remove('dark');
                localStorage.theme = 'light';
            } else {
                html.classList.add('dark');
                localStorage.theme = 'dark';
            }
        });
    }
}

// --- LESSON VIDEO STATE HELPERS ---

/**
 * Lightweight badge updater.
 * Targets only the video-badge span for a single lesson — no full curriculum re-render.
 */
function updateLessonVideoCardUI(sIdx, iIdx) {
    const item = window.courseDraft.curriculum[sIdx]?.items[iIdx];
    if (!item) return;

    const badge = document.getElementById(`lesson-video-badge-${item.id}`);
    if (!badge) return; // Modal is open or card not rendered yet — fine, renderCurriculum handles it

    const st = window.lessonVideoState[item.id];
    const hasSavedVideo = !!(item.video_storage_key || (item.video && item.video.url));

    let html = '';

    if (st && st.phase === 'uploading') {
        const pct = Math.round(st.progress);
        html = `
            <div class="flex flex-col items-start gap-1">
                <span class="text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider">
                    Uploading ${pct}%
                </span>
                <div class="w-full h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div class="h-full bg-blue-500 rounded-full transition-all" style="width:${pct}%"></div>
                </div>
            </div>`;
    } else if (st && st.phase === 'completing') {
        html = `<span class="text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider">
                    Completing...
                </span>`;
    } else if (st && st.phase === 'pending_save') {
        html = `<span class="flex items-center gap-1 text-amber-500 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider">
                    <span class="material-symbols-outlined text-[12px]">check_circle</span>Ready — Save Video
                </span>`;
    } else if (st && st.phase === 'saving') {
        html = `<span class="text-slate-400 bg-slate-50 dark:bg-slate-800 px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider">
                    Saving...
                </span>`;
    } else if ((st && st.phase === 'saved') || hasSavedVideo) {
        html = `<button onclick="previewLessonVideo('${item.id}', ${sIdx}, ${iIdx})"
                    class="flex items-center gap-1 text-primary hover:text-blue-700 transition text-[11px] font-bold uppercase tracking-wider"
                    title="Preview video">
                    <span class="material-symbols-outlined text-[14px]">play_circle</span>
                    Video
                </button>`;
    } else if (st && st.phase === 'error') {
        html = `<span class="flex items-center gap-1 text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider">
                    <span class="material-symbols-outlined text-[12px]">error</span>Upload failed
                    <button onclick="retryLessonVideoUpload(${sIdx},${iIdx})" class="ml-1 underline hover:no-underline">Retry</button>
                </span>`;
    } else {
        html = `<span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">No video</span>`;
    }

    badge.innerHTML = html;
}

/**
 * Secure video preview for a saved lesson video.
 * Calls the r2-video-playback Edge Function and opens the URL in a lightweight player modal.
 */
async function previewLessonVideo(lessonId, sIdx, iIdx) {
    const item = window.courseDraft.curriculum[sIdx]?.items[iIdx];
    if (!item) return;

    // YouTube/Vimeo embed path
    if (item.video?.url && !item.video_storage_key) {
        const embedSrc = getEmbedUrl(item.video.url);
        if (embedSrc) {
            openVideoPlayerModal(embedSrc, item.video.title || 'Lesson Video', true);
            return;
        }
    }

    // R2 secure path
    try {
        const btn = document.getElementById(`lesson-video-badge-${lessonId}`)?.querySelector('button');
        if (btn) { btn.disabled = true; btn.innerHTML += ' <span class="material-symbols-outlined text-[10px] align-middle animate-spin" style="animation-duration:1s">progress_activity</span>'; }
        const playbackUrl = await CourseService.getR2PlaybackUrl(window.courseDraft.id, lessonId, 'lesson');
        if (btn) { btn.disabled = false; updateLessonVideoCardUI(sIdx, iIdx); }
        openVideoPlayerModal(playbackUrl, item.video?.title || 'Lesson Video', false);
    } catch (err) {
        console.error('Playback URL fetch failed:', err);
        if (typeof showToast === 'function') showToast('Could not load video preview: ' + err.message, true);
        updateLessonVideoCardUI(sIdx, iIdx);
    }
}

/** Opens a simple video player modal overlay. */
function openVideoPlayerModal(src, title, isEmbed) {
    let modal = document.getElementById('lesson-video-player-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'lesson-video-player-modal';
        modal.className = 'fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4';
        modal.onclick = (e) => { if (e.target === modal) closeVideoPlayerModal(); };
        document.body.appendChild(modal);
    }
    const mediaHtml = isEmbed
        ? `<iframe src="${src}" class="w-full aspect-video rounded-lg" frameborder="0" allow="autoplay; fullscreen" allowfullscreen></iframe>`
        : `<video src="${src}#t=1" class="w-full aspect-video rounded-lg bg-black" controls autoplay preload="metadata"></video>`;

    modal.innerHTML = `
        <div class="bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden">
            <div class="flex items-center justify-between px-4 py-3 border-b border-slate-700">
                <span class="text-sm font-bold text-white truncate">${title}</span>
                <button onclick="closeVideoPlayerModal()" class="text-slate-400 hover:text-white transition">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
            <div class="p-4">${mediaHtml}</div>
        </div>`;
    modal.classList.remove('hidden');
}

window.closeVideoPlayerModal = function() {
    const modal = document.getElementById('lesson-video-player-modal');
    if (modal) {
        // Stop video/audio before closing
        modal.querySelectorAll('video').forEach(v => { v.pause(); v.src = ''; });
        modal.classList.add('hidden');
        modal.innerHTML = '';
    }
};

/**
 * Retry entry point — reopens the video modal for the failed lesson.
 */
function retryLessonVideoUpload(sIdx, iIdx) {
    const item = window.courseDraft.curriculum[sIdx]?.items[iIdx];
    if (!item) return;
    const st = window.lessonVideoState[item.id];
    if (st) {
        st.phase = 'idle';
        st.progress = 0;
        st.errorMessage = '';
        st.objectKey = null;
        st.uploadId = null;
    }
    wizardOpenModal('modal-add-video', sIdx, iIdx);
}

// --- CURRICULUM LOGIC ---


function addSection() {
    window.courseDraft.curriculum.push({
        id: crypto.randomUUID(), // Production-grade client generated ID
        title: `Section ${window.courseDraft.curriculum.length + 1}: New Section`,
        items: []
    });
    window.saveDraft(true);
    renderCurriculum();
}

function renderCurriculum() {
    const container = document.getElementById('curriculum-container');
    if (!container) return;

    if (window.courseDraft.curriculum.length === 0) {
        container.innerHTML = `<div class="w-full text-center py-6 text-slate-500 italic text-sm">Use the button below to add your first section.</div>`;
        return;
    }

    let html = '';
    window.courseDraft.curriculum.forEach((sec, sIdx) => {
        let itemsHtml = '';

        if (sec.items && sec.items.length > 0) {
            sec.items.forEach((item, iIdx) => {

                const hasContent = item.video || (item.quiz && item.quiz.length > 0) || (item.resources && item.resources.length > 0);
                const borderClass = hasContent ? 'border-slate-200 dark:border-slate-700' : 'border-red-400 ring-1 ring-red-400 bg-red-50/30 dark:bg-red-900/10';

                let icon = 'play_circle';
                if (item.content_type === 'quiz') icon = 'quiz';
                if (item.content_type === 'resource') icon = 'description';

                itemsHtml += `
                    <div class="group border ${borderClass} rounded-lg bg-white dark:bg-slate-900 hover:border-primary/30 transition-colors mb-3"
                         draggable="true" ondragstart="dragStartItem(event, ${sIdx}, ${iIdx})" ondragover="dragOverItem(event)" ondrop="dropItem(event, ${sIdx}, ${iIdx})">
                        <div class="p-3 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                            <div class="flex items-start sm:items-center gap-2 sm:gap-4 w-full flex-1 min-w-0">
                                <span class="material-symbols-outlined text-slate-300 cursor-move group-hover:text-slate-400 mt-1 sm:mt-0">drag_handle</span>
                                <div class="flex items-start sm:items-center gap-2 sm:gap-3 w-full flex-1 min-w-0">
                                    ${(function() {
                                        if (item.content_type === 'video' && (item.video_storage_key || (item.video && item.video.url))) {
                                            return `<div class="w-10 h-7 bg-slate-800 dark:bg-slate-950 rounded flex items-center justify-center flex-shrink-0 mt-0.5 sm:mt-0 relative overflow-hidden ring-1 ring-slate-700">
                                                        <span class="material-symbols-outlined text-[16px] text-white">play_arrow</span>
                                                    </div>`;
                                        } else {
                                            return `<span class="material-symbols-outlined text-slate-400 mt-0.5 sm:mt-0">${icon}</span>`;
                                        }
                                    })()}
                                    <div class="flex flex-col flex-1 min-w-0 text-left w-full">
                                        <input class="text-sm font-medium text-slate-900 dark:text-white leading-none bg-transparent border-none focus:ring-0 p-0 transition w-full mb-1 truncate" 
                                           value="${item.title}" onblur="updateItemTitle(${sIdx}, ${iIdx}, this.value)" />
                                        
                                        <!-- Scrollable container for Lesson Details -->
                                        <div class="flex flex-wrap items-center gap-2 mt-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                                            <span id="lesson-video-badge-${item.id}">
                                                ${(function() {
                                                    const st = window.lessonVideoState ? window.lessonVideoState[item.id] : null;
                                                    const hasSavedVideo = !!(item.video_storage_key || (item.video && item.video.url));
                                                    if (st && st.phase === 'uploading') {
                                                        const pct = Math.round(st.progress);
                                                        return `<div class="flex flex-col items-start gap-1">
                                                                    <span class="text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider">Uploading ${pct}%</span>
                                                                    <div class="w-full h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden"><div class="h-full bg-blue-500 rounded-full transition-all" style="width:${pct}%"></div></div>
                                                                </div>`;
                                                    } else if (st && st.phase === 'completing') {
                                                        return `<span class="text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider">Completing...</span>`;
                                                    } else if (st && st.phase === 'pending_save') {
                                                        return `<span class="flex items-center gap-1 text-amber-500 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider"><span class="material-symbols-outlined text-[12px]">check_circle</span>Ready — Save Video</span>`;
                                                    } else if (st && st.phase === 'saving') {
                                                        return `<span class="text-slate-400 bg-slate-50 dark:bg-slate-800 px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider">Saving...</span>`;
                                                    } else if ((st && st.phase === 'saved') || hasSavedVideo) {
                                                        return `<button onclick="previewLessonVideo('${item.id}', ${sIdx}, ${iIdx})" class="flex items-center gap-1 text-primary hover:text-blue-700 transition text-[11px] font-bold uppercase tracking-wider" title="Preview video"><span class="material-symbols-outlined text-[14px]">play_circle</span>Video</button>`;
                                                    } else if (st && st.phase === 'error') {
                                                        return `<span class="flex items-center gap-1 text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider"><span class="material-symbols-outlined text-[12px]">error</span>Failed <button onclick="retryLessonVideoUpload(${sIdx},${iIdx})" class="ml-1 underline hover:no-underline">Retry</button></span>`;
                                                    }
                                                    return `<span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">No video</span>`;
                                                })()}
                                            </span>

                                            ${(item.quiz && item.quiz.length > 0) ? `
                                                <button onclick="wizardOpenModal('modal-add-quiz', ${sIdx}, ${iIdx})" class="flex items-center gap-1 text-amber-500 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40 transition">
                                                    <span class="material-symbols-outlined text-[12px]">quiz</span> 
                                                    ${item.quiz.length} Quiz${item.quiz.length !== 1 ? 'zes' : ''}
                                                </button>
                                            ` : ''}

                                            ${(item.resources && item.resources.length > 0) ? `
                                                <button onclick="wizardOpenModal('modal-add-resource', ${sIdx}, ${iIdx})" class="flex items-center justify-center gap-1 text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition flex-shrink-0 w-auto mt-0">
                                                    <span class="material-symbols-outlined text-[12px]">attachment</span> 
                                                    ${item.resources.length} Resource${item.resources.length !== 1 ? 's' : ''}
                                                </button>
                                            ` : ''}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="flex items-center sm:ml-4 self-end sm:self-auto shrink-0">
                                <!-- Delete button moved to bottom actions -->
                            </div>
                        </div>
                        <div class="px-3 sm:px-4 pb-3 sm:pb-4 flex flex-col sm:flex-row sm:items-center justify-between border-t border-slate-50 dark:border-slate-800/50 pt-3 sm:pt-0 sm:border-t-0 gap-3">
                            <div class="flex items-center gap-2 self-start sm:self-center">
                                <label class="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" ${item.is_preview ? 'checked' : ''} onchange="toggleLessonPreview(${sIdx}, ${iIdx})" class="sr-only peer">
                                    <div class="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-accent"></div>
                                </label>
                                <span class="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Preview</span>
                            </div>
                            <div class="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-2 w-full sm:w-auto ml-auto">
                                <button onclick="wizardOpenModal('modal-add-quiz', ${sIdx}, ${iIdx})" class="flex items-center justify-center w-full sm:w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-900/10 sm:bg-slate-100 sm:dark:bg-slate-800 text-amber-500 sm:text-slate-500 hover:text-accent transition border border-amber-200 dark:border-amber-900/30 sm:border-transparent" title="Add Quiz"><span class="material-symbols-outlined text-[16px] sm:text-lg">quiz</span></button>
                                <button onclick="wizardOpenModal('modal-add-video', ${sIdx}, ${iIdx})" class="flex items-center justify-center w-full sm:w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/10 sm:bg-slate-100 sm:dark:bg-slate-800 text-blue-500 sm:text-slate-500 hover:text-accent transition border border-blue-200 dark:border-blue-900/30 sm:border-transparent" title="Add Video"><span class="material-symbols-outlined text-[16px] sm:text-lg">videocam</span></button>
                                <button onclick="wizardOpenModal('modal-add-resource', ${sIdx}, ${iIdx})" class="col-span-2 flex items-center justify-center w-full sm:w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/10 sm:bg-slate-100 sm:dark:bg-slate-800 text-emerald-500 sm:text-slate-500 hover:text-accent transition border border-emerald-200 dark:border-emerald-900/30 sm:border-transparent" title="Add Resource"><span class="material-symbols-outlined text-[16px] sm:text-lg">attachment</span></button>
                                <button onclick="deleteItem(${sIdx}, ${iIdx})" class="col-span-2 sm:col-span-1 mt-1 sm:mt-0 flex items-center justify-center w-full sm:w-8 h-8 rounded-lg bg-red-50 dark:bg-red-900/10 sm:bg-transparent sm:dark:bg-transparent text-red-500 hover:text-red-700 sm:text-slate-400 sm:hover:text-red-500 transition border border-red-200 dark:border-red-900/30 sm:border-transparent" title="Delete Lesson"><span class="material-symbols-outlined text-[16px] sm:text-lg">delete</span></button>
                            </div>
                        </div>
                    </div>`;
            });
        }

        html += `
        <div draggable="true" ondragstart="dragStartSection(event, ${sIdx})" ondragover="dragOverSection(event)" ondrop="dropSection(event, ${sIdx})" class="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-visible relative mb-8 cursor-grab active:cursor-grabbing">
            <div class="p-4 sm:p-6 border-b border-slate-100 dark:border-slate-800 flex flex-nowrap items-center justify-between gap-3 bg-slate-50/50 dark:bg-slate-800/50 pointer-events-none">
                <div class="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
                    <span class="material-symbols-outlined text-slate-400 cursor-move shrink-0">drag_indicator</span>
                    <div class="flex flex-col sm:flex-row sm:items-center sm:gap-2 relative pointer-events-auto flex-1 min-w-0">
                        <span class="text-[11px] sm:text-sm font-bold text-slate-400 uppercase tracking-widest shrink-0">Section ${sIdx + 1}:</span>
                        <input type="text" value="${sec.title}" onchange="updateSectionTitle(${sIdx}, this.value)" class="text-base sm:text-lg font-semibold text-slate-900 dark:text-white bg-transparent border-none outline-none focus:ring-0 p-0 rounded w-full truncate" placeholder="Section Title..." />
                    </div>
                </div>
                <div class="flex items-center gap-2 pointer-events-auto shrink-0 self-start sm:self-center">
                    <button onclick="deleteSection(${sIdx})" class="text-slate-400 hover:text-red-500 transition p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded">
                        <span class="material-symbols-outlined">delete</span>
                    </button>
                </div>
            </div>
            <div class="p-6 space-y-4" ondragover="dragOverItem(event)" ondrop="dropItemEmpty(event, ${sIdx})">
                ${itemsHtml}
                <button onclick="addLesson(${sIdx})" class="w-full py-4 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-lg flex items-center justify-center gap-2 text-slate-400 hover:text-primary hover:bg-slate-50 transition group">
                    <span class="material-symbols-outlined">add_circle</span>
                    <span class="text-sm font-semibold">Add Content</span>
                </button>
            </div>
        </div>`;
    });

    container.innerHTML = html;
}

function addLesson(sIdx) {
    if (!window.courseDraft.curriculum[sIdx].items) window.courseDraft.curriculum[sIdx].items = [];
    window.courseDraft.curriculum[sIdx].items.push({
        id: crypto.randomUUID(), // Production-grade client generated ID
        type: 'lesson',
        content_type: 'video', // default
        title: `Lesson ${window.courseDraft.curriculum[sIdx].items.length + 1}: New Content`,
        video: null,
        quiz: [],
        resources: []
    });
    window.saveDraft(true);
    renderCurriculum();
}

function deleteSection(idx) {
    if (confirm('Delete this entire section?')) {
        window.courseDraft.curriculum.splice(idx, 1);
        window.saveDraft(true);
        renderCurriculum();
    }
}

function updateSectionTitle(idx, newTitle) {
    if (newTitle && newTitle.trim() !== '') {
        window.courseDraft.curriculum[idx].title = newTitle.trim();
        window.saveDraft(true);
    }
}

function updateItemTitle(sIdx, iIdx, newTitle) {
    if (newTitle && newTitle.trim() !== '') {
        window.courseDraft.curriculum[sIdx].items[iIdx].title = newTitle.trim();
        window.saveDraft(true);
    }
}

function deleteItem(sIdx, iIdx) {
    window.courseDraft.curriculum[sIdx].items.splice(iIdx, 1);
    window.saveDraft(true);
    renderCurriculum();
}

function toggleLessonPreview(sIdx, iIdx) {
    const lesson = window.courseDraft.curriculum[sIdx].items[iIdx];
    lesson.is_preview = !lesson.is_preview;
    window.saveDraft(true);
    // No need to rerender full curriculum, just visual feedback if wanted
}

// DRAG AND DROP - Simplistic local representation
function dragStartSection(e, idx) { window.draggedSectionIdx = idx; e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); }
function dragOverSection(e) { e.preventDefault(); }
function dropSection(e, dropIdx) {
    e.preventDefault(); e.stopPropagation();
    if (window.draggedSectionIdx !== null && window.draggedSectionIdx !== dropIdx) {
        const draggedSec = window.courseDraft.curriculum.splice(window.draggedSectionIdx, 1)[0];
        window.courseDraft.curriculum.splice(dropIdx, 0, draggedSec);
        window.saveDraft(true);
        renderCurriculum();
    }
    window.draggedSectionIdx = null;
}
function dragStartItem(e, sIdx, iIdx) { window.draggedItemInfo = { sIdx, iIdx }; e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); }
function dragOverItem(e) { e.preventDefault(); }
function dropItem(e, targetSIdx, targetIIdx) {
    e.preventDefault(); e.stopPropagation();
    if (window.draggedItemInfo) {
        const { sIdx, iIdx } = window.draggedItemInfo;
        const item = window.courseDraft.curriculum[sIdx].items.splice(iIdx, 1)[0];
        window.courseDraft.curriculum[targetSIdx].items.splice(targetIIdx, 0, item);
        window.saveDraft(true);
        renderCurriculum();
    }
    window.draggedItemInfo = null;
}
function dropItemEmpty(e, targetSIdx) {
    e.preventDefault();
    if (window.draggedItemInfo && e.target.closest('.p-4')) {
        const { sIdx, iIdx } = window.draggedItemInfo;
        if (sIdx === targetSIdx && iIdx === window.courseDraft.curriculum[targetSIdx].items.length - 1) return;
        const item = window.courseDraft.curriculum[sIdx].items.splice(iIdx, 1)[0];
        window.courseDraft.curriculum[targetSIdx].items.push(item);
        window.saveDraft(true);
        renderCurriculum();
        window.draggedItemInfo = null;
    }
}


// --- MODALS ---
let activeModalSectionIdx = -1;
let activeModalItemIdx = -1;
let currentQuizzes = []; // Now managing an array of quizzes in the modal

function wizardOpenModal(modalId, sIdx, iIdx) {
    activeModalSectionIdx = sIdx;
    activeModalItemIdx = iIdx;

    const modal = document.getElementById(modalId);
    if (!modal) return;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => { modal.querySelector('div')?.classList.remove('scale-95', 'opacity-0'); }, 10);

    const lesson = window.courseDraft.curriculum[sIdx].items[iIdx];

    if (modalId === 'modal-add-video') {
        const titleEl = document.getElementById('modal-video-title');
        const nameEl = document.getElementById('modal-video-name-display');
        const embedUrlEl = document.getElementById('modal-video-embed-url');
        const fileEl = document.getElementById('modal-video-upload');
        const errEl = document.getElementById('modal-video-url-error');
        const progressContainer = document.getElementById('modal-upload-progress-container');
        const progressBar = document.getElementById('modal-upload-progress-bar');
        const percentText = document.getElementById('modal-upload-percent');

        // Always resync every field
        if (embedUrlEl) embedUrlEl.value = (lesson.video && lesson.video.url && !lesson.video_storage_key) ? lesson.video.url : '';
        if (fileEl) fileEl.value = ''; // clear any leftover selected File
        if (errEl) errEl.classList.add('hidden');
        if (progressContainer) progressContainer.classList.add('hidden');

        const st = getLessonVideoState(lesson.id);

        if (st.phase === 'uploading' || st.phase === 'completing' || st.phase === 'saving') {
            if (titleEl) titleEl.value = lesson.video?.title || '';
            if (nameEl) nameEl.innerText = st.fileName || 'Uploading...';
            if (progressContainer) {
                progressContainer.classList.remove('hidden');
                progressBar.style.width = (st.phase === 'completing' || st.phase === 'saving') ? '100%' : `${st.progress}%`;
                
                if (st.phase === 'completing') percentText.innerText = 'Completing...';
                else if (st.phase === 'saving') percentText.innerText = 'Saving...';
                else percentText.innerText = `${Math.round(st.progress)}%`;
            }
        } else if (st.phase === 'pending_save') {
            if (titleEl) titleEl.value = lesson.video?.title || '';
            if (nameEl) nameEl.innerText = st.fileName || 'Video Staged';
            if (progressContainer) {
                progressContainer.classList.remove('hidden');
                progressBar.style.width = '100%';
                percentText.innerText = 'Upload complete! Click Save Video';
            }
        } else if (st.phase === 'error') {
            if (titleEl) titleEl.value = lesson.video?.title || '';
            if (nameEl) nameEl.innerText = 'Upload failed';
            if (errEl) {
                errEl.textContent = st.errorMessage || 'Upload failed.';
                errEl.classList.remove('hidden');
            }
        } else {
            // idle or saved
            if (titleEl) titleEl.value = lesson.video?.title || '';
            const hasSavedVideo = (lesson.video_storage_key || (lesson.video && lesson.video.url));
            if (nameEl) nameEl.innerText = hasSavedVideo ? 'Video attached (upload new to replace)' : 'Click or drag video to upload';
        }
    } else if (modalId === 'modal-add-resource') {
        renderResourceList(sIdx, iIdx);
        toggleResourceForm(lesson.resources.length === 0);
    } else if (modalId === 'modal-add-quiz') {
        // Multi-quiz management
        if (lesson.quiz && lesson.quiz.length > 0) {
            currentQuizzes = JSON.parse(JSON.stringify(lesson.quiz));
        } else {
            // Start with one empty quiz package
            currentQuizzes = [{
                title: 'Quiz 1',
                description: '',
                questions: []
            }];
        }
        renderQuizPackages();
    }
}

function renderResourceList(sIdx, iIdx) {
    const container = document.getElementById('resource-list-container');
    const toggleBtn = document.getElementById('add-resource-toggle-btn');
    const formContainer = document.getElementById('resource-add-form');
    
    if (!container) return;

    const lesson = window.courseDraft.curriculum[sIdx].items[iIdx];
    const resources = lesson.resources || [];

    if (resources.length === 0) {
        container.innerHTML = `<p class="text-xs text-slate-400 italic">No resources attached yet.</p>`;
        if (toggleBtn) toggleBtn.classList.add('hidden');
        if (formContainer) formContainer.classList.remove('hidden');
        return;
    }

    container.innerHTML = resources.map((r, rIdx) => `
        <div class="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 hover:border-accent/30 transition-colors">
            <div class="flex items-center gap-3 overflow-hidden">
                <div class="w-8 h-8 rounded-lg bg-white dark:bg-slate-700 flex items-center justify-center shadow-sm">
                    <span class="material-symbols-outlined text-accent text-lg">description</span>
                </div>
                <div class="flex flex-col overflow-hidden">
                    <span class="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">${r.title}</span>
                    <span class="text-[10px] text-slate-400 font-medium uppercase tracking-wider">${r.id ? 'Saved' : 'New'}</span>
                </div>
            </div>
            <button onclick="deleteResource(${sIdx}, ${iIdx}, ${rIdx})" class="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition" title="Remove Resource">
                <span class="material-symbols-outlined text-lg">delete</span>
            </button>
        </div>
    `).join('');

    // Show "Add Another" if there are resources
    if (toggleBtn) toggleBtn.classList.remove('hidden');
}

function toggleResourceForm(show) {
    const form = document.getElementById('resource-add-form');
    const toggleBtn = document.getElementById('add-resource-toggle-btn');
    const cancelBtn = document.getElementById('cancel-resource-add-btn');
    
    if (form) {
        if (show) {
            form.classList.remove('hidden');
            if (toggleBtn) toggleBtn.classList.add('hidden');
            // If they are toggle adding another, they should be able to cancel if they have resources already
            const lesson = window.courseDraft.curriculum[activeModalSectionIdx].items[activeModalItemIdx];
            if (cancelBtn && lesson.resources.length > 0) cancelBtn.classList.remove('hidden');
        } else {
            form.classList.add('hidden');
            if (toggleBtn) toggleBtn.classList.remove('hidden');
        }
    }
}

function deleteResource(sIdx, iIdx, rIdx) {
    window.courseDraft.curriculum[sIdx].items[iIdx].resources.splice(rIdx, 1);
    renderResourceList(sIdx, iIdx);
    renderCurriculum();
    window.saveDraft(true);
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.querySelector('div')?.classList.add('scale-95', 'opacity-0');
        setTimeout(() => { modal.classList.remove('flex'); modal.classList.add('hidden'); }, 300);
    }
}

async function wizardSaveModalVideo() {
    const provider = document.querySelector('input[name="modal-provider-radio"]:checked')?.value || 'youtube';
    const embedUrl = document.getElementById('modal-video-embed-url')?.value;
    const title = document.getElementById('modal-video-title')?.value || 'Video Lecture';
    
    if (activeModalItemIdx === -1) return;
    const item = window.courseDraft.curriculum[activeModalSectionIdx].items[activeModalItemIdx];
    const st = getLessonVideoState(item.id);
    
    // Disable save button to prevent double-clicks
    const saveBtn = document.querySelector('#modal-add-video-content button:last-child');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerText = 'Saving...';
    }

    try {
        if (provider === 'r2') {
            if (st.phase === 'uploading' || st.phase === 'completing') {
                alert("Upload is still in progress. Please wait or cancel.");
                return;
            }

            if (st.phase !== 'pending_save' || !st.objectKey) {
                const errEl = document.getElementById('modal-video-url-error');
                if (errEl) {
                    errEl.textContent = 'Please select a video file and wait for it to upload.';
                    errEl.classList.remove('hidden');
                }
                return;
            }

            st.phase = 'saving';
            updateLessonVideoCardUI(st.sIdx, st.iIdx);

            // Commit the uploaded object to generate DB asset records
            await CourseService.commitR2Upload(
                window.courseDraft.id,
                item.id,
                'lesson',
                st.objectKey,
                st.fileSize
            );

            // Delete the OLD R2 object if this was a replacement, to avoid storage bloat.
            // st.prevSavedVideo is snapshotted at upload-start time (line ~937).
            if (st.prevSavedVideo?.video_storage_key) {
                CourseService.discardStagedUpload(
                    window.courseDraft.id,
                    st.prevSavedVideo.video_storage_key
                ).catch(err => console.warn('Old R2 cleanup failed (non-critical):', err));
                st.prevSavedVideo = null;
            }

            item.content_type = 'video';
            item.video_provider = 'r2';
            item.video_storage_key = st.objectKey;
            item.video = { title: title, url: null };
            item.description = title;

            // Clear state
            st.phase = 'saved';
            updateLessonVideoCardUI(st.sIdx, st.iIdx);

        } else { // youtube
            if (embedUrl) {
                const embedSrc = getEmbedUrl(embedUrl);
                if (!embedSrc) {
                    const errEl = document.getElementById('modal-video-url-error');
                    if (errEl) {
                        errEl.textContent = 'Please enter a valid YouTube or Vimeo URL.';
                        errEl.classList.remove('hidden');
                    }
                    return;
                }
                const errEl = document.getElementById('modal-video-url-error');
                if (errEl) errEl.classList.add('hidden');
                
                item.content_type = 'video';
                item.video_provider = 'youtube';
                item.video_storage_key = null;
                item.video = { title: title, url: embedUrl };
                item.description = title;
                
                st.phase = 'saved';
            } else {
                const errEl = document.getElementById('modal-video-url-error');
                if (errEl) {
                    errEl.textContent = 'Please enter a valid URL.';
                    errEl.classList.remove('hidden');
                }
                return;
            }
        }

        window.saveDraft(true);
        renderCurriculum();
        closeModalVideoClean();
    } catch (e) {
        console.error('Save error', e);
        alert("Error saving video: " + e.message);
        st.phase = st.objectKey ? 'pending_save' : 'idle';
        updateLessonVideoCardUI(st.sIdx, st.iIdx);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerText = 'Save Video';
        }
    }
}

function closeModalVideoClean() {
    // This is the "Close via X / Click Outside" handler.
    // It NO LONGER ABORTS uploads. It just hides the UI.
    const progressContainer = document.getElementById('modal-upload-progress-container');
    if (progressContainer) progressContainer.classList.add('hidden');
    
    // Clear the file input
    const fileEl = document.getElementById('modal-video-upload');
    if (fileEl) fileEl.value = '';
    const display = document.getElementById('modal-video-name-display');
    if (display) display.innerText = 'Click or drag video to upload';

    closeModal('modal-add-video');
}

async function discardAndCloseModalVideo() {
    // This is the EXPLICIT CANCEL hit.
    if (activeModalItemIdx === -1) {
        closeModalVideoClean();
        return;
    }
    const item = window.courseDraft.curriculum[activeModalSectionIdx].items[activeModalItemIdx];
    const st = getLessonVideoState(item.id);

    if (st.phase === 'saving') {
        // We are currently saving. Discard is ignored to avoid race conditions.
        return;
    }

    if (st.phase === 'uploading' && st.abortController) {
        st.abortController.abort();
    } else if (st.phase === 'completing') {
        // Special race-condition flag
        st.cancelAfterComplete = true;
    } else if (st.phase === 'pending_save' && st.objectKey) {
        try {
            st.phase = 'cancelling';
            updateLessonVideoCardUI(st.sIdx, st.iIdx);
            await CourseService.discardStagedUpload(
                window.courseDraft.id, 
                st.objectKey,
                null // uploadId not needed for completed staged upload
            );
        } catch (e) {
            console.error('Error discarding upload:', e);
        }
    }

    if (st.phase !== 'completing') {
        st.phase = 'idle';
        st.objectKey = null;
        st.progress = 0;
        st.fileName = '';
        st.errorMessage = '';
        updateLessonVideoCardUI(st.sIdx, st.iIdx);
    }

    closeModalVideoClean();
}

async function saveModalResource() {
    // Clear any lingering validation errors first
    const clearError = (id) => {
        const el = document.getElementById(id);
        if (el) { el.classList.remove('border-red-500', 'ring-1', 'ring-red-400'); }
    };
    const showError = (id, msg) => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('border-red-500', 'ring-1', 'ring-red-400');
            el.focus?.();
        }
        // Show an inline error message below the field
        const errId = `${id}-error`;
        let errEl = document.getElementById(errId);
        if (!errEl) {
            errEl = document.createElement('p');
            errEl.id = errId;
            errEl.className = 'text-xs text-red-500 font-medium mt-1';
            el?.parentElement?.appendChild(errEl);
        }
        errEl.textContent = msg;
        setTimeout(() => { errEl.remove(); clearError(id); }, 3500);
    };

    let title = document.getElementById('modal-resource-title-input')?.value || `New Resource`;
    const fileEl = document.getElementById('modal-resource-upload');
    const externalUrl = document.getElementById('external-link')?.value?.trim();

    let uploadedUrl = null;
    if (fileEl && fileEl.files && fileEl.files[0]) {
        try {
            uploadedUrl = await CourseService.uploadLessonResource(window.courseDraft.id, fileEl.files[0]);
            window.sessionUploadedFiles.push({ provider: 'supabase', bucket: 'course_resources', url: uploadedUrl });
        } catch (e) { 
            console.error("Resource upload failed:", e);
            showError('modal-resource-upload', 'Upload failed: ' + e.message);
            return; 
        }
    } else if (externalUrl) {
        uploadedUrl = externalUrl;
    } else {
        // Highlight both the upload area and the external link input in red
        const uploadArea = document.getElementById('video-upload-area-modal') || document.getElementById('modal-resource-upload')?.closest('.border-dashed');
        if (uploadArea) {
            uploadArea.classList.add('border-red-500');
            setTimeout(() => uploadArea.classList.remove('border-red-500'), 3500);
        }
        showError('external-link', 'Please upload a file or paste an external link.');
        return;
    }

    if (activeModalItemIdx !== -1) {
        const item = window.courseDraft.curriculum[activeModalSectionIdx].items[activeModalItemIdx];
        // Only change content_type if it was previously something else or it's new
        if (item.content_type === 'video' && !item.video && (!item.resources || item.resources.length === 0)) {
            item.content_type = 'resource';
        }
        
        if (!item.resources) item.resources = [];
        
        // Determine file type from extension if possible
        let fileType = 'unknown';
        if (fileEl && fileEl.files && fileEl.files[0]) {
            const ext = fileEl.files[0].name.split('.').pop().toLowerCase();
            if (['pdf', 'doc', 'docx', 'txt'].includes(ext)) fileType = 'document';
            else if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) fileType = 'image';
            else if (['zip', 'rar', '7z'].includes(ext)) fileType = 'archive';
        }

        item.resources.push({ 
            title: title, 
            file_url: uploadedUrl,
            file_type: fileType
        });
        
        // Clear inputs for the next one
        if (document.getElementById('modal-resource-title-input')) document.getElementById('modal-resource-title-input').value = '';
        if (document.getElementById('modal-resource-upload')) document.getElementById('modal-resource-upload').value = '';
        if (document.getElementById('modal-resource-name-display')) document.getElementById('modal-resource-name-display').innerText = 'Click to upload or drag and drop';
        if (document.getElementById('external-link')) document.getElementById('external-link').value = '';
        
        renderResourceList(activeModalSectionIdx, activeModalItemIdx);
        // Hide form after multi-add
        toggleResourceForm(false);
        renderCurriculum();
        window.saveDraft(true);
    }
}




function setPricingTier(tier) {
    window.courseDraft.pricing.type = tier;
    const detailsContainer = document.getElementById('pricing-details-container');
    const btnFree = document.getElementById('btn-tier-free');
    const btnPaid = document.getElementById('btn-tier-paid');

    if (tier === 'free') {
        detailsContainer.style.opacity = '0.5';
        detailsContainer.style.pointerEvents = 'none';
        document.getElementById('course-price').value = '';
        window.courseDraft.pricing.price = null;
        // Highlight Free button
        if (btnFree) { btnFree.classList.add('bg-white', 'dark:bg-slate-600', 'shadow-sm', 'text-slate-900', 'dark:text-white'); btnFree.classList.remove('text-slate-500', 'dark:text-slate-400', 'hover:text-slate-700', 'dark:hover:text-white'); }
        if (btnPaid) { btnPaid.classList.remove('bg-white', 'dark:bg-slate-600', 'shadow-sm', 'text-slate-900', 'dark:text-white'); btnPaid.classList.add('text-slate-500', 'dark:text-slate-400', 'hover:text-slate-700', 'dark:hover:text-white'); }
    } else {
        detailsContainer.style.opacity = '1';
        detailsContainer.style.pointerEvents = 'auto';
        // Highlight Paid button
        if (btnPaid) { btnPaid.classList.add('bg-white', 'dark:bg-slate-600', 'shadow-sm', 'text-slate-900', 'dark:text-white'); btnPaid.classList.remove('text-slate-500', 'dark:text-slate-400', 'hover:text-slate-700', 'dark:hover:text-white'); }
        if (btnFree) { btnFree.classList.remove('bg-white', 'dark:bg-slate-600', 'shadow-sm', 'text-slate-900', 'dark:text-white'); btnFree.classList.add('text-slate-500', 'dark:text-slate-400', 'hover:text-slate-700', 'dark:hover:text-white'); }
    }
    calculatePayout();
}

// Replaced by consolidated version below

function showToast(msg, isError = false) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-message');
    if (toast && toastMsg) {
        toastMsg.innerText = msg;
        if (isError) toast.querySelector('span').innerText = 'error';
        toast.classList.remove('translate-y-20', 'opacity-0');
        setTimeout(() => toast.classList.add('translate-y-20', 'opacity-0'), 3000);
    }
}

function showThumbnailPreview(url) {
    const container = document.getElementById('thumbnail-preview-container');
    const icon = document.getElementById('thumbnail-placeholder-icon');
    const btn = document.getElementById('btn-upload-thumbnail');
    const tick = document.getElementById('thumbnail-tick');

    if (container) {
        // Use an img element for reliable display instead of CSS background-image
        // (Tailwind bg-cover class can conflict with inline style)
        let img = container.querySelector('img.thumb-preview-img');
        if (!img) {
            img = document.createElement('img');
            img.className = 'thumb-preview-img absolute inset-0 w-full h-full object-cover z-20';
            container.appendChild(img);
        }
        img.src = url;
        
        if (icon) icon.classList.add('hidden');
        if (btn) btn.innerText = "Update Thumbnail";
        if (tick) tick.classList.remove('hidden');
    }
}

function showVideoPreview(url, filename) {
    const container = document.getElementById('video-preview-container');
    const tick = document.getElementById('video-tick');
    const icon = document.getElementById('video-placeholder-icon');
    const nameDisplay = document.getElementById('video-filename-display');
    const btn = document.getElementById('btn-upload-video');

    if (container) {
        // Create actual video preview
        let video = container.querySelector('video.intro-preview-vid');
        if (!video) {
            video = document.createElement('video');
            video.className = 'intro-preview-vid absolute inset-0 w-full h-full object-cover z-20';
            video.controls = true;
            video.muted = true;
            video.preload = "metadata";
            container.appendChild(video);
        }
        
        // Append #t=1 if it doesn't already have a hash, to force thumbnail frame
        video.src = url.includes('#') ? url : url + '#t=1';
        
        if (icon) icon.classList.add('hidden');
        if (tick) {
            tick.classList.remove('hidden');
            tick.style.display = 'flex';
            tick.classList.add('z-30'); // Keep tick on top or visible
        }
        if (nameDisplay) nameDisplay.innerText = filename || "Video Attached";
        if (btn) btn.innerText = "Update Intro Video";
    }
}

function markFieldError(el) {
    if (!el) return;
    el.classList.add('border-red-500', 'ring-2', 'ring-red-400', 'bg-red-50', 'dark:bg-red-900/10');
    
    // Remove error on user input/change
    const handler = () => {
        el.classList.remove('border-red-500', 'ring-2', 'ring-red-400', 'bg-red-50', 'dark:bg-red-900/10');
        el.removeEventListener('input', handler);
        el.removeEventListener('change', handler);
    };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
}

function validateStep(step) {
    let isValid = true;
    
    // Clear all previous error states
    document.querySelectorAll('.border-red-500').forEach(el => {
        el.classList.remove('border-red-500', 'ring-2', 'ring-red-400', 'ring-1', 'bg-red-50', 'dark:bg-red-900/10');
    });

    if (step === 1) {
        const title = document.getElementById('course-title');
        const category = document.getElementById('course-category');
        // Ensure description is also handled if it exists
        const description = document.getElementById('description') || document.getElementById('course-description');

        if (!title?.value.trim()) {
            console.warn("Validation failed: Title is missing.");
            markFieldError(title);
            isValid = false;
        }
        
        // Category is required and must be a valid selection (not the default prompt)
        if (!category?.value || category.value === "") {
            console.warn("Validation failed: Category is missing.");
            markFieldError(category);
            isValid = false;
        }

        if (!isValid) {
            console.log("Step 1 Validation Summary: Failed required fields.");
        }
    } else if (step === 2) {
        // Step 2: Curriculum Validation
        // Every lesson must have at least one piece of content (video, quiz, or resource)
        let emptyLessons = [];
        window.courseDraft.curriculum.forEach((sec, sIdx) => {
            (sec.items || []).forEach((item, iIdx) => {
                const hasContent = item.video || (item.quiz && item.quiz.length > 0) || (item.resources && item.resources.length > 0);
                if (!hasContent) {
                    emptyLessons.push(`"${item.title}" in ${sec.title}`);
                    isValid = false;
                }
            });
        });

        if (!isValid) {
            console.warn("Validation failed: Empty lessons found.", emptyLessons);
            showToast(`The following lessons are missing content: ${emptyLessons.join(', ')}. Please add a video, quiz, or resource.`, true);
        }
    } else if (step === 3) {
        const type = window.courseDraft.pricing.type;
        const price = document.getElementById('course-price');
        const priceValue = Number(price?.value);
        const hasValidPrice = price?.value.trim() !== '' && Number.isFinite(priceValue) && priceValue > 0;

        if (type === 'paid' && !hasValidPrice) {
            markFieldError(price);
            setPricingValidationMessage('Enter a course price greater than $0.00 before adding coupons.');
            isValid = false;
        } else if (type === 'paid') {
            syncCourseCoupons();
            const invalidCoupon = (window.courseDraft.pricing.coupons || []).find(cp =>
                cp.code && cp.percent && getCouponFinalPrice(priceValue, cp.percent) <= 0
            );
            if (invalidCoupon) {
                setPricingValidationMessage(`Coupon "${invalidCoupon.code}" would make this course free ($0.00). Reduce its discount or increase the course price.`);
                isValid = false;
            } else {
                setPricingValidationMessage('');
            }
        }
    }

    if (!isValid) {
        showToast("Please fill in all required fields marked in red.", true);
        
        // Scroll first error into view
        const firstError = document.querySelector('.border-red-500');
        if (firstError) {
            firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
    
    return isValid;
}

async function renderFinalPreview() {
    // Simply fetch current draft state and put it into the summary pane.
    const titlePreview = document.getElementById('final-title-preview');
    if (titlePreview) {
        titlePreview.innerText = window.courseDraft.title || 'Untitled';
        titlePreview.classList.remove('text-slate-400', 'italic');
        titlePreview.classList.add('text-slate-900', 'dark:text-white');
    }

    if (document.getElementById('final-subtitle-preview')) document.getElementById('final-subtitle-preview').innerText = window.courseDraft.subtitle || '';
    if (document.getElementById('summary-description-preview-main')) document.getElementById('summary-description-preview-main').innerText = window.courseDraft.description || '';
    
    // Update Intro Video Status
    const introVideoStatus = document.getElementById('summary-video-preview');
    if (introVideoStatus) {
        // Search all lessons for a video or check course-level intro video
        const hasIntroVideo = window.courseDraft.intro_video_url;
        
        if (hasIntroVideo) {
            introVideoStatus.innerText = 'Uploaded';
            introVideoStatus.classList.remove('text-slate-700', 'dark:text-slate-300');
            introVideoStatus.classList.add('text-emerald-600', 'font-bold');
        } else {
            introVideoStatus.innerText = 'Not Uploaded';
            introVideoStatus.classList.remove('text-emerald-600', 'font-bold');
            introVideoStatus.classList.add('text-slate-700', 'dark:text-slate-300');
        }
    }

    // Update Thumbnail Status
    const thumbStatus = document.getElementById('summary-thumbnail-status');
    if (thumbStatus) {
        if (window.courseDraft.thumbnail_url) {
            thumbStatus.innerText = 'Uploaded';
            thumbStatus.classList.remove('text-slate-700', 'dark:text-slate-300');
            thumbStatus.classList.add('text-emerald-600', 'font-bold');
        } else {
            thumbStatus.innerText = 'Not Uploaded';
            thumbStatus.classList.remove('text-emerald-600', 'font-bold');
            thumbStatus.classList.add('text-slate-700', 'dark:text-slate-300');
        }
    }
    
    if (window.courseDraft.thumbnail_url) {
        const thumbPreview = document.getElementById('final-thumbnail-preview');
        if (thumbPreview) {
            let img = thumbPreview.querySelector('img.final-thumb-img');
            if (!img) {
                img = document.createElement('img');
                img.className = 'final-thumb-img absolute inset-0 w-full h-full object-cover z-10';
                thumbPreview.appendChild(img);
            }
            img.src = window.courseDraft.thumbnail_url;
            document.getElementById('final-thumbnail-icon')?.classList.add('hidden');
        }
    }

    document.getElementById('final-sections-count').innerText = window.courseDraft.curriculum.length;
    document.getElementById('final-level-preview').innerText = window.courseDraft.level;
    
    const summarySectionsCount = document.getElementById('summary-sections-count');
    if (summarySectionsCount) summarySectionsCount.innerText = window.courseDraft.curriculum.length;

    const summaryPricingType = document.getElementById('summary-pricing-type');
    const finalPricePreview = document.getElementById('final-price-preview');
    
    if (summaryPricingType) {
        if (window.courseDraft.pricing.type === 'free') {
            summaryPricingType.innerText = 'Free';
            if (finalPricePreview) finalPricePreview.innerText = 'FREE';
        } else {
            const rawPrice = window.courseDraft.pricing.price;
            const priceNum = parseFloat(rawPrice || 0);
            const priceStr = `$${priceNum.toFixed(2)}`;
            
            summaryPricingType.innerText = `Paid (${priceStr})`;
            if (finalPricePreview) finalPricePreview.innerText = priceStr;
        }
    }

    // Update Step 4 Privacy Radios to match state
    const privacyRadios = document.querySelectorAll('input[name="privacy"]');
    privacyRadios.forEach(radio => {
        if (radio.value === window.courseDraft.privacy) {
            radio.checked = true;
            // Trigger visual update for the radio labels
            const label = radio.closest('label');
            if (label) {
                label.classList.add('border-primary', 'bg-primary/5');
                label.classList.remove('border-slate-200', 'hover:border-slate-300');
            }
        } else {
            const label = radio.closest('label');
            if (label) {
                label.classList.remove('border-primary', 'bg-primary/5');
                label.classList.add('border-slate-200', 'hover:border-slate-300');
            }
        }
    });

    // --- Detailed Curriculum Summary Injection ---
    const currSummaryContainer = document.getElementById('final-curriculum-summary');
    if (currSummaryContainer) {
        const curriculum = window.courseDraft.curriculum || [];
        if (curriculum.length === 0) {
            currSummaryContainer.innerHTML = `<p class="text-sm text-slate-400 italic">No curriculum configured yet.</p>`;
        } else {
            let html = '';
            curriculum.forEach((sec, sIdx) => {
                let lessonsHtml = '';
                (sec.items || []).forEach((les, lIdx) => {
                    let icon = 'description';
                    const quizCount = (les.quiz && les.quiz.length > 0) ? les.quiz.length : 0;
                    const resourceCount = les.resources ? les.resources.length : 0;
                    
                    if (les.video) icon = 'play_circle';
                    else if (quizCount > 0) icon = 'quiz';
                    
                    let badgesHtml = '';
                    if (les.video || les.content_type === 'video') {
                        badgesHtml += `<span class="bg-blue-50 dark:bg-blue-900/30 text-blue-600 px-2 py-0.5 rounded text-[10px] font-bold shrink-0">VIDEO</span>`;
                    }
                    if (quizCount > 0) {
                        badgesHtml += `<span class="bg-amber-50 dark:bg-amber-900/30 text-amber-600 px-2 py-0.5 rounded text-[10px] font-bold shrink-0">${quizCount} QUIZ${quizCount !== 1 ? 'ZES' : ''}</span>`;
                    }
                    if (resourceCount > 0) {
                        badgesHtml += `<span class="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 px-2 py-0.5 rounded text-[10px] font-bold shrink-0">${resourceCount} RES</span>`;
                    }

                    lessonsHtml += `
                    <div class="flex items-center justify-between py-2 border-b border-slate-50 dark:border-slate-800 last:border-0 pl-4 w-max min-w-full gap-8">
                        <div class="flex items-center gap-3 shrink-0">
                            <span class="material-symbols-outlined text-slate-400 text-lg">${icon}</span>
                            <span class="text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">${les.title}</span>
                        </div>
                        <div class="flex items-center gap-1 shrink-0 pr-2">
                            ${badgesHtml}
                        </div>
                    </div>`;
                });

                html += `
                <div class="border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
                    <div class="bg-slate-50/50 dark:bg-slate-800/50 p-3 flex items-center justify-between border-b border-slate-100 dark:border-slate-800">
                        <span class="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Section ${sIdx + 1}: ${sec.title}</span>
                        <span class="text-xs text-slate-400 font-medium">${sec.items ? sec.items.length : 0} Lessons</span>
                    </div>
                    <div class="p-2 space-y-1 overflow-x-auto overflow-y-hidden custom-scrollbar">
                        ${lessonsHtml || '<p class="text-xs text-slate-400 italic pl-4 py-2">No lessons in this section.</p>'}
                    </div>
                </div>`;
            });
            currSummaryContainer.innerHTML = html;
        }
    }

    calculatePayout(); 

    // Use already loaded profile if possible, else fetch
    const finalInstructorName = window.courseDraft.instructor_name || (window.userProfile ? window.userProfile.full_name : 'Instructor');
    const nameEl = document.getElementById('final-instructor-name');
    if (nameEl) nameEl.innerText = finalInstructorName;
    
    if (window.courseDraft.instructor_avatar || (window.userProfile && window.userProfile.avatar_url)) {
        const avatarEl = document.getElementById('final-instructor-avatar');
        const avatarUrl = window.courseDraft.instructor_avatar || window.userProfile.avatar_url;
        if (avatarEl) avatarEl.innerHTML = `<img src="${avatarUrl}" class="w-full h-full object-cover rounded-full" />`;
    }
}

function wizardCalculatePayout() {
    const priceInput = document.getElementById('course-price');
    const priceDisplay = document.getElementById('final-price-preview');
    const payoutEl = document.querySelector('.bg-purple-50 p');
    
    // Determine the source of the price
    let price;
    if (priceInput) {
        // If the input exists, use its live value and sync to draft
        price = parseFloat(priceInput.value) || 0;
        window.courseDraft.pricing.price = price; 
    } else {
        // Otherwise use the draft state (reliable for Step 4)
        price = parseFloat(window.courseDraft.pricing.price || 0);
    }
    
    const isFree = window.courseDraft.pricing.type === 'free';
    const priceStr = isFree ? 'FREE' : `$${price.toFixed(2)}`;
    
    // Dynamic Commission Logic
    const settings = window.financeSettings || { commission_enabled: false, instructor_percentage: 100 };
    const instructorShare = settings.commission_enabled ? settings.instructor_percentage : 100;
    const earnings = (price * (instructorShare / 100)).toFixed(2);

    // 1. Update Final Price Preview (Step 4 Card)
    if (priceDisplay) priceDisplay.innerText = priceStr;
    
    // 2. Update Payout Estimation (Step 3 Info Box)
    if (payoutEl) {
        if (isFree) {
            payoutEl.innerHTML = `This course is currently <span class="font-bold text-accent">Free</span>. Switch to Paid to enable earnings estimation.`;
        } else {
            payoutEl.innerHTML = `
                You receive <span class="font-bold text-accent">${instructorShare}%</span> of each sale. 
                For a price of $${price.toFixed(2)}, your estimated earnings per sale will be 
                <span class="font-bold text-slate-900 dark:text-white">$${earnings}</span>.
            `;
        }
    }
}

// Consolidated version above

async function publishCourse() {
    const btnPublish = document.getElementById('btn-publish');
    if (btnPublish) { btnPublish.disabled = true; btnPublish.textContent = 'Submitting...'; }

    try {
        // 1. Flush all draft data to DB first
        await window.saveDraft(true);
        if (!window.courseDraft.id) throw new Error("Could not save the course draft. Please check your data.");

        // 2. Set status to pending_review so admin sees it
        await CourseService.submitForReview(window.courseDraft.id);

        // 3. Update local draft status
        window.courseDraft.status = 'pending_review';

        // 4. Show the Step 5 confirmation screen
        document.querySelectorAll('.wizard-step').forEach(el => {
            el.classList.add('hidden'); el.classList.remove('block');
        });
        document.getElementById('step-5-container')?.classList.remove('hidden');
        document.getElementById('step-5-container')?.classList.add('flex');
        document.getElementById('bottom-nav')?.classList.add('hidden');
    } catch (e) {
        alert("Failed to submit for review: " + e.message);
        if (btnPublish) { btnPublish.disabled = false; btnPublish.textContent = window.courseDraft.has_rejection_history ? 'Republish Course' : 'Publish Course'; }
    }
}

// Multi-Quiz UI Builders
function renderQuizPackages() {
    const container = document.getElementById('quiz-packages-container');
    const subtitleEl = document.getElementById('quiz-modal-subtitle');
    if (!container) return;

    if (subtitleEl) {
        subtitleEl.innerText = `${currentQuizzes.length} Quiz${currentQuizzes.length !== 1 ? 'zes' : ''} in this Lesson`;
    }

    let html = '';
    currentQuizzes.forEach((quiz, quizIdx) => {
        let questionsHtml = '';
        quiz.questions.forEach((q, qIdx) => {
            let optionsHtml = '';
            q.options.forEach((opt, oIdx) => {
                const checked = opt.correct ? 'checked' : '';
                optionsHtml += `
                <div class="flex items-center gap-3 mb-2">
                    <div class="flex items-center gap-2 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900 px-2 py-1.5 cursor-pointer hover:border-green-400 transition" onclick="setQuizCorrectAnswer(${quizIdx}, ${qIdx}, ${oIdx})">
                        <input type="radio" name="correct-opt-${quizIdx}-${qIdx}" ${checked} class="text-green-500 focus:ring-green-500 cursor-pointer pointer-events-none" />
                        <span class="text-[10px] font-black uppercase tracking-widest ${opt.correct ? 'text-green-600' : 'text-slate-300'}">Correct</span>
                    </div>
                    <input id="quiz-opt-${quizIdx}-${qIdx}-${oIdx}" class="w-full text-sm rounded border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" value="${opt.text}" placeholder="Option text" />
                    <button onclick="removeQuizOption(${quizIdx}, ${qIdx}, ${oIdx})" class="text-slate-400 hover:text-red-500"><span class="material-symbols-outlined text-sm">close</span></button>
                </div>`;
            });

            questionsHtml += `
            <div class="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 relative group">
                <button onclick="removeQuizQuestion(${quizIdx}, ${qIdx})" class="absolute top-2 right-2 text-slate-400 hover:text-red-500 hidden group-hover:block"><span class="material-symbols-outlined text-sm">delete</span></button>
                <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Question ${qIdx + 1}</label>
                <input id="quiz-q-${quizIdx}-${qIdx}" class="w-full text-sm font-semibold rounded-lg border-slate-300 dark:border-slate-600 mb-4 bg-white dark:bg-slate-900" value="${q.text}" placeholder="Enter question..." />
                
                <div class="pl-4 border-l-2 border-slate-200 dark:border-slate-700">
                    ${optionsHtml}
                    <button onclick="addQuizOption(${quizIdx}, ${qIdx})" class="text-xs font-bold text-accent hover:underline flex items-center gap-1 mt-2">
                        <span class="material-symbols-outlined text-sm">add</span> Add Option
                    </button>
                </div>
            </div>`;
        });

        // Validation Warning for empty quiz
        const hasNoQuestions = quiz.questions.length === 0;
        const warningHtml = hasNoQuestions 
            ? `<div class="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 rounded-lg mb-4">
                 <span class="material-symbols-outlined text-amber-500 text-sm">warning</span>
                 <p class="text-[10px] font-bold text-amber-600 uppercase tracking-widest">This quiz has no questions. Please add some before saving.</p>
               </div>` 
            : '';

        html += `
        <div class="bg-slate-50 dark:bg-slate-800/50 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-4 relative">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <span class="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-500">${quizIdx + 1}</span>
                    <h3 class="font-bold text-slate-700 dark:text-slate-300">Quiz Package Details</h3>
                </div>
                <button onclick="removeQuizPackage(${quizIdx})" class="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition" title="Delete Quiz Package">
                    <span class="material-symbols-outlined">delete</span>
                </button>
            </div>
            
            <div class="grid grid-cols-1 gap-4">
                <div>
                    <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Quiz Title</label>
                    <input id="quiz-title-${quizIdx}" class="w-full text-sm font-bold rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" value="${quiz.title}" placeholder="e.g. Assessment Phase 1" />
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Description</label>
                    <textarea id="quiz-desc-${quizIdx}" class="w-full text-sm rounded-lg border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" rows="2" placeholder="Purpose of this quiz...">${quiz.description}</textarea>
                </div>
            </div>

            ${warningHtml}

            <div class="space-y-4 pt-2">
                ${questionsHtml}
                <button onclick="addQuizQuestion(${quizIdx})" class="w-full py-2 border border-dashed border-slate-300 dark:border-slate-600 rounded-xl flex items-center justify-center gap-2 text-slate-400 hover:text-accent hover:border-accent transition text-xs font-bold">
                    <span class="material-symbols-outlined text-sm">add_circle</span> Add a Question to Quiz ${quizIdx + 1}
                </button>
            </div>
        </div>`;
    });

    container.innerHTML = html;
}

function syncQuizState() {
    currentQuizzes.forEach((quiz, quizIdx) => {
        const titleInput = document.getElementById(`quiz-title-${quizIdx}`);
        const descInput = document.getElementById(`quiz-desc-${quizIdx}`);
        if (titleInput) quiz.title = titleInput.value;
        if (descInput) quiz.description = descInput.value;

        quiz.questions.forEach((q, qIdx) => {
            const qInput = document.getElementById(`quiz-q-${quizIdx}-${qIdx}`);
            if (qInput) q.text = qInput.value;
            q.options.forEach((o, oIdx) => {
                const oInput = document.getElementById(`quiz-opt-${quizIdx}-${qIdx}-${oIdx}`);
                if (oInput) o.text = oInput.value;
            });
        });
    });
}

function addAnotherQuizPackage() {
    syncQuizState();
    currentQuizzes.push({
        title: `Quiz ${currentQuizzes.length + 1}`,
        description: '',
        questions: []
    });
    renderQuizPackages();
    // Scroll to bottom
    const container = document.getElementById('quiz-packages-container');
    if (container) setTimeout(() => { container.scrollTop = container.scrollHeight; }, 100);
}

function removeQuizPackage(quizIdx) {
    if (confirm('Are you sure you want to delete this Entire Quiz Package including its questions?')) {
        syncQuizState();
        currentQuizzes.splice(quizIdx, 1);
        if (currentQuizzes.length === 0) {
            currentQuizzes = [{ title: 'Quiz 1', description: '', questions: [] }];
        }
        renderQuizPackages();
    }
}

function addQuizQuestion(quizIdx) {
    syncQuizState();
    currentQuizzes[quizIdx].questions.push({ 
        text: '', 
        options: [
            { text: '', correct: true }, 
            { text: '', correct: false }
        ] 
    });
    renderQuizPackages();
}

function removeQuizQuestion(quizIdx, qIdx) {
    syncQuizState();
    currentQuizzes[quizIdx].questions.splice(qIdx, 1);
    renderQuizPackages();
}

function addQuizOption(quizIdx, qIdx) {
    syncQuizState();
    currentQuizzes[quizIdx].questions[qIdx].options.push({ text: '', correct: false });
    renderQuizPackages();
}

function removeQuizOption(quizIdx, qIdx, oIdx) {
    syncQuizState();
    if (currentQuizzes[quizIdx].questions[qIdx].options.length <= 2) { alert('Minimum 2 options required'); return; }
    currentQuizzes[quizIdx].questions[qIdx].options.splice(oIdx, 1);
    // Ensure at least one correct
    if (!currentQuizzes[quizIdx].questions[qIdx].options.some(o => o.correct)) {
        currentQuizzes[quizIdx].questions[qIdx].options[0].correct = true;
    }
    renderQuizPackages();
}

function setQuizCorrectAnswer(quizIdx, qIdx, oIdx) {
    syncQuizState();
    currentQuizzes[quizIdx].questions[qIdx].options.forEach((o, i) => { o.correct = (i === oIdx); });
    renderQuizPackages();
}

function saveModalQuiz() {
    syncQuizState();
    
    // Check if any quiz is empty (optional but good for UX)
    const hasEmptyQuizzes = currentQuizzes.some(q => q.questions.length === 0);
    if (hasEmptyQuizzes) {
        if (!confirm('Some of your quiz packages have no questions. Are you sure you want to save? Empty quizzes may not appear to students.')) {
            return;
        }
    }

    if (activeModalItemIdx !== -1) {
        const item = window.courseDraft.curriculum[activeModalSectionIdx].items[activeModalItemIdx];
        item.quiz = JSON.parse(JSON.stringify(currentQuizzes));
        item.content_type = 'quiz';
    }

    renderCurriculum(); 
    window.saveDraft(true); 
    closeModal('modal-add-quiz');
}
async function saveDraftManual() {
    const btn = document.getElementById('btn-save-draft-nav');
    const origText = btn ? btn.innerHTML : null;
    
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">sync</span> Saving...';
    }

    try {
        await saveCurrentStepData(true);
        console.log("Draft saved perfectly:", window.courseDraft);
        showToast("Draft safely saved in Supabase.");
        // Clear session tracking since these files are now permanently part of the saved draft
        window.sessionUploadedFiles = [];
    } catch (e) {
        console.error("Manual save failed:", e);
        showToast("Failed to save draft.", true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origText;
        }
    }
}

async function exitWizard() {
    const btn = document.getElementById('btn-wizard-exit');
    if (btn) {
        btn.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">sync</span> Exiting...';
        btn.disabled = true;
    }

    // Discard any staged or newly uploaded files for this session that weren't saved to draft
    if (window.sessionUploadedFiles && window.sessionUploadedFiles.length > 0) {
        console.log("Cleaning up unsaved session files...", window.sessionUploadedFiles);
        for (const file of window.sessionUploadedFiles) {
            try {
                if (file.provider === 'r2' && file.key) {
                    await CourseService.discardStagedUpload(window.courseDraft.id, file.key);
                } else if (file.provider === 'supabase' && file.url) {
                    const pathParts = file.url.split('public/' + file.bucket + '/');
                    if (pathParts.length > 1) {
                        const path = decodeURIComponent(pathParts[1]);
                        await supabase.storage.from(file.bucket).remove([path]);
                    }
                }
            } catch (e) {
                console.error("Cleanup failed for unsaved file", file, e);
            }
        }
    }
    
    window.location.href = '/src/pages/instructor/instructor-courses/index.html';
}

function setupInputStability() {
    // Prevent mouse wheel from changing values on number inputs
    document.addEventListener('wheel', function(e) {
        if (document.activeElement.type === 'number') {
            document.activeElement.blur();
        }
    });

    // Also specifically target the pricing and coupon percent inputs for extra safety
    const numberInputs = ['course-price', 'course-coupon-percent'];
    numberInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
        }
    });
}

// === Global Function Registration ===
// Required because this is a module script and inline onclick handlers need global scope
function registerGlobals() {
    const globals = {
        addAnotherQuizPackage,
        removeQuizPackage,
        removeQuizQuestion,
        addQuizOption,
        removeQuizOption,
        setQuizCorrectAnswer,
        saveModalQuiz,
        exitWizard,
        saveDraftManual,
        addQuizQuestion,
        openModal: wizardOpenModal,
        wizardOpenModal, // 🔥 Also register by original name for curriculum buttons
        closeModal,      // 🔥 Missing registration used in wizard.html
        goToStep,
        setPricingTier,
        nextStep: wizardNextStep,
        prevStep,
        publishCourse,
        deleteSection,           // Replaces removeCurriculumSection
        deleteItem,              // Replaces removeCurriculumItem
        addLesson,               // Replaces addCurriculumItem
        addSection,              // Replaces addCurriculumSection
        dropSection,             // Replaces moveCurriculumSection
        dropItem,                // Replaces moveCurriculumItem
        toggleLessonPreview,
        updateSectionTitle,
        updateItemTitle,
        saveModalVideo: wizardSaveModalVideo,
        discardAndCloseModalVideo,
        toggleResourceForm,
        saveModalResource,
        deleteResource,
        calculatePayout: wizardCalculatePayout,
        previewLessonVideo,
        retryLessonVideoUpload,
        closeModalVideoClean
    };

    for (const [key, val] of Object.entries(globals)) {
        window[key] = val;
    }
}

registerGlobals();

// --- COUPON MANAGEMENT ---

function getCouponFinalPrice(price, percent) {
    const value = Number(price);
    const discount = Number(percent);
    if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(discount)) return NaN;
    // Checkout displays two decimal places, so validate the rounded payable amount.
    return Math.round((value * (1 - discount / 100) + Number.EPSILON) * 100) / 100;
}

function setPricingValidationMessage(message) {
    const el = document.getElementById('pricing-validation-error');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('hidden', !message);
}

function validatePricingCoupons(showMessages = true) {
    const type = window.courseDraft.pricing.type;
    const priceInput = document.getElementById('course-price');
    const price = Number(priceInput?.value);
    const hasValidPrice = !!priceInput?.value.trim() && Number.isFinite(price) && price > 0;
    const addButton = document.getElementById('add-course-coupon-btn');
    if (addButton) addButton.disabled = type !== 'paid' || !hasValidPrice;
    if (addButton) addButton.classList.toggle('opacity-50', addButton.disabled);
    if (addButton) addButton.classList.toggle('cursor-not-allowed', addButton.disabled);

    const container = document.getElementById('course-coupons-container');
    const coupons = window.courseDraft.pricing.coupons || [];
    let firstError = '';
    coupons.forEach((cp, idx) => {
        const percentInput = document.getElementById(`cp-pct-${idx}`);
        const priceAfterDiscount = hasValidPrice ? getCouponFinalPrice(price, cp.percent) : NaN;
        const percent = Number(cp.percent);
        const hasInvalidPercent = cp.code && cp.percent != null && (!Number.isFinite(percent) || percent < 1 || percent > 99);
        const error = hasInvalidPercent
            ? 'Coupon discounts must be between 1% and 99%.'
            : (cp.code && cp.percent && hasValidPrice && priceAfterDiscount <= 0
                ? `This discount would make the course $0.00. Reduce the percentage or increase the course price.`
                : '');
        if (error && !firstError) firstError = hasInvalidPercent
            ? `Coupon "${cp.code}" has an invalid discount. Use a value from 1% to 99%.`
            : `Coupon "${cp.code}" would make this course free ($0.00). Reduce its discount or increase the course price.`;
        if (percentInput) {
            percentInput.classList.toggle('border-red-500', !!error);
            percentInput.setAttribute('aria-invalid', error ? 'true' : 'false');
        }
        const errorEl = document.getElementById(`cp-error-${idx}`);
        if (errorEl) {
            errorEl.textContent = error;
            errorEl.classList.toggle('hidden', !error);
        }
    });
    if (showMessages) {
        if (type === 'paid' && !hasValidPrice) setPricingValidationMessage('Enter a course price greater than $0.00 before adding coupons.');
        else setPricingValidationMessage(firstError);
    }
    return type !== 'paid' || (hasValidPrice && !firstError);
}

function renderCourseCoupons() {
    const container = document.getElementById('course-coupons-container');
    if (!container) return;
    container.innerHTML = '';
    
    if (!window.courseDraft.pricing.coupons || window.courseDraft.pricing.coupons.length === 0) {
        return;
    }

    let html = '';
    window.courseDraft.pricing.coupons.forEach((cp, idx) => {
        html += `
        <div class="flex items-start sm:items-center p-3 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800/50 relative">
            <div class="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-3 pr-8 sm:pr-0">
                <div class="col-span-1">
                    <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Coupon Code</label>
                    <input id="cp-code-${idx}" class="w-full text-sm uppercase rounded bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 focus:ring-accent focus:border-accent" value="${cp.code || cp.coupon_code || ''}" placeholder="SUMMER20" maxlength="50" autocomplete="off" spellcheck="false" oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9\-_]/g,'').slice(0,50)" />
                </div>
                <div class="col-span-1">
                    <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Discount (%)</label>
                    <input id="cp-pct-${idx}" type="number" min="1" max="99" class="w-full text-sm rounded bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 focus:ring-accent focus:border-accent" value="${cp.percent || cp.discount_percent || ''}" placeholder="20" />
                    <p id="cp-error-${idx}" class="hidden text-xs font-semibold text-red-600 mt-1" role="alert"></p>
                </div>
                <div class="col-span-2 sm:col-span-1">
                    <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Expiration</label>
                    <input id="cp-exp-${idx}" type="date" class="w-full text-sm rounded bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 focus:ring-accent focus:border-accent" value="${(cp.expiry || cp.expires_at || '').split('T')[0]}" />
                </div>
            </div>
            <button onclick="removeCourseCoupon(${idx})" class="absolute top-2 right-2 sm:static sm:p-2 sm:ml-4 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition shrink-0">
                <span class="material-symbols-outlined text-[20px]">delete</span>
            </button>
        </div>`;
    });
    container.innerHTML = html;
    validatePricingCoupons(false);
}

function syncCourseCoupons() {
    if (!window.courseDraft.pricing.coupons) return;
    const synced = [];
    window.courseDraft.pricing.coupons.forEach((cp, idx) => {
        const codeInput = document.getElementById(`cp-code-${idx}`);
        const pctInput = document.getElementById(`cp-pct-${idx}`);
        const expInput = document.getElementById(`cp-exp-${idx}`);
        
        if (codeInput && pctInput) {
            // SECURITY: strip anything that isn't A-Z, 0-9, hyphen, or underscore.
            // Prevents HTML injection and keeps codes to valid coupon format.
            const rawCode = (codeInput.value || '').toUpperCase().replace(/[^A-Z0-9\-_]/g, '').slice(0, 50).trim();
            synced.push({
                code: rawCode,
                percent: parseInt(pctInput.value) || null,
                expiry: expInput.value || null
            });
        }
    });
    window.courseDraft.pricing.coupons = synced;
}

window.addCourseCoupon = function() {
    if (!validatePricingCoupons(true)) {
        const priceInput = document.getElementById('course-price');
        if (!priceInput?.value.trim() || Number(priceInput.value) <= 0) {
            priceInput?.classList.add('border-red-500', 'ring-2', 'ring-red-400');
            priceInput?.focus();
        }
        return;
    }
    syncCourseCoupons();
    window.courseDraft.pricing.coupons = window.courseDraft.pricing.coupons || [];
    window.courseDraft.pricing.coupons.push({ code: '', percent: null, expiry: null });
    renderCourseCoupons();
    validatePricingCoupons(false);
};

window.removeCourseCoupon = function(idx) {
    syncCourseCoupons();
    window.courseDraft.pricing.coupons.splice(idx, 1);
    renderCourseCoupons();
};

// Expose module-scoped functions to window so HTML onclick attributes can reach them
window.saveDraftManual = saveDraftManual;
window.exitWizard = exitWizard;
