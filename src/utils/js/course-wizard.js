/**
 * Course Creation Wizard Logic with Supabase Backend
 */
import { CourseService } from '/src/services/courseService.js';
import { AuthService } from '/src/services/authService.js';

// Global state
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

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Load Categories
    try {
        window.categoriesList = await CourseService.getCategories();
        renderCategories();
    } catch (e) {
        console.error("Failed to load categories", e);
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
                                video: (contentType === 'video' || les.video_url)
                                    ? { url: les.video_url, title: les.description || 'Video Lecture' }
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
        const existingSectionIds = window.courseDraft.curriculum.map(s => s.id).filter(Boolean);

        for (const [sIdx, section] of window.courseDraft.curriculum.entries()) {
            const savedSection = await CourseService.saveSection(savedCourse.id, {
                ...section,
                order_index: sIdx
            });
            section.id = savedSection.id;

            const existingLessonIds = section.items.map(l => l.id).filter(Boolean);

            for (const [lIdx, lesson] of section.items.entries()) {
                const savedLesson = await CourseService.saveLesson(savedSection.id, {
                    ...lesson,
                    order_index: lIdx
                });
                lesson.id = savedLesson.id;
            }

            // Delete removed lessons only if they exist in DB
            // (Note: Currently deleteLesson would need to be called here if we tracked what was removed)
            // For now, let's at least ensure we're not doing a full rebuild.
        }

        // --- STEP 3: Save Coupons (optional array) ---
        if (window.courseDraft.id) {
            try {
                // Clear existing coupons first
                await CourseService.deleteCoupon(window.courseDraft.id);
                // Insert validated ones
                if (window.courseDraft.pricing.coupons && window.courseDraft.pricing.coupons.length > 0) {
                    for (const cp of window.courseDraft.pricing.coupons) {
                        if (cp.code && cp.percent) {
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
    // Nav Buttons
    document.getElementById('btn-next')?.addEventListener('click', async () => {
        // On the pricing step, always do a full DB save to persist price + coupons
        const saveToDb = (window.currentStep === 3);
        await saveCurrentStepData(saveToDb);
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
                if (btn) { btn.setAttribute('data-orig', btn.innerText); btn.innerText = 'Uploading...'; btn.disabled = true; }

                try {
                    // Ensure we have a course ID before uploading
                    if (!window.courseDraft.id) await performSave(true);
                    const url = await CourseService.uploadCourseVideo(window.courseDraft.id, file);
                    window.courseDraft.intro_video_url = url;
                    showVideoPreview(url, file.name);
                    window.saveDraft(true);
                } catch (err) {
                    console.error('Video upload error:', err);
                    alert('Upload failed: ' + err.message);
                    if (btn) btn.innerText = btn.getAttribute('data-orig') || 'Upload Video';
                } finally {
                    if (btn) btn.disabled = false;
                }
            }
        });
    }

    // Modal File Uploads
    const modalVidUpload = document.getElementById('modal-video-upload');
    if (modalVidUpload) {
        modalVidUpload.addEventListener('change', function (e) {
            if (e.target.files && e.target.files[0]) {
                const display = document.getElementById('modal-video-name-display');
                if (display) display.innerText = e.target.files[0].name;
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

    document.getElementById('course-price')?.addEventListener('input', calculatePayout);

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
                        <div class="p-4 flex items-center justify-between">
                            <div class="flex items-center gap-4 w-full">
                                <span class="material-symbols-outlined text-slate-300 cursor-move group-hover:text-slate-400">drag_handle</span>
                                <div class="flex items-center gap-3 w-full">
                                    <span class="material-symbols-outlined text-slate-400">${icon}</span>
                                    <div class="flex flex-col w-full text-left">
                                        <input class="text-sm font-medium text-slate-900 dark:text-white leading-none bg-transparent border-none focus:ring-0 p-0 transition w-full mb-1" 
                                           value="${item.title}" onblur="updateItemTitle(${sIdx}, ${iIdx}, this.value)" />
                                        
                                        <!-- Scrollable container for Lesson Details -->
                                        <div class="overflow-x-auto scrollbar-hide py-1">
                                            <div class="flex items-center gap-3 mt-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">
                                                <span>${item.content_type.toUpperCase()}</span>
                                                ${item.video ? `
                                                    <span class="flex items-center gap-1 text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded">
                                                        <span class="material-symbols-outlined text-[12px]">videocam</span> 
                                                        ${item.video.title || 'Video'}
                                                    </span>
                                                ` : ''}
                                                ${(item.quiz && item.quiz.length > 0) ? `
                                                    <button onclick="wizardOpenModal('modal-add-quiz', ${sIdx}, ${iIdx})" class="flex items-center gap-1 text-amber-500 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40 transition">
                                                        <span class="material-symbols-outlined text-[12px]">quiz</span> 
                                                        ${item.quiz.length} Quiz${item.quiz.length !== 1 ? 'zes' : ''}
                                                    </button>
                                                ` : ''}

                                                ${(item.resources || []).map(r => `<span class="flex items-center gap-1 text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded"><span class="material-symbols-outlined text-[12px]">attachment</span> ${r.title}</span>`).join('')}
                                            </div>
                                        </div>
                                        
                                        <!-- Video Preview for Lesson -->
                                        ${item.video?.url ? `
                                            <div class="mt-2 w-full max-w-sm rounded-lg overflow-hidden border border-slate-100 dark:border-slate-800 bg-black/5 flex items-center gap-3 p-2">
                                                <div class="w-16 h-10 bg-black rounded flex items-center justify-center relative group-preview">
                                                    <video class="w-full h-full object-cover">
                                                        <source src="${item.video.url}#t=0.5" type="video/mp4">
                                                    </video>
                                                    <div class="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition">
                                                        <span class="material-symbols-outlined text-white text-xs">play_arrow</span>
                                                    </div>
                                                </div>
                                                <div class="flex flex-col min-w-0">
                                                    <span class="text-[10px] text-slate-400 font-bold uppercase truncate">${item.video.title || 'Lesson Video'}</span>
                                                    <a href="${item.video.url}" target="_blank" class="text-[9px] text-primary hover:underline truncate">View Original</a>
                                                </div>
                                            </div>
                                        ` : ''}
                                    </div>
                                </div>
                            </div>
                            <div class="flex items-center gap-1 shrink-0 ml-4">
                                <button onclick="deleteItem(${sIdx}, ${iIdx})" class="p-2 text-slate-400 hover:text-red-500 transition"><span class="material-symbols-outlined text-xl">delete</span></button>
                            </div>
                        </div>
                        <div class="px-4 pb-4 flex gap-2">
                            <div class="flex items-center gap-4">
                                <div class="flex items-center gap-2">
                                    <label class="relative inline-flex items-center cursor-pointer">
                                        <input type="checkbox" ${item.is_preview ? 'checked' : ''} onchange="toggleLessonPreview(${sIdx}, ${iIdx})" class="sr-only peer">
                                        <div class="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-accent"></div>
                                    </label>
                                    <span class="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Preview</span>
                                </div>
                                <div class="flex items-center gap-2">
                                    <button onclick="wizardOpenModal('modal-add-video', ${sIdx}, ${iIdx})" class="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-accent transition flex items-center justify-center" title="Add Video"><span class="material-symbols-outlined text-lg">videocam</span></button>
                                    <button onclick="wizardOpenModal('modal-add-resource', ${sIdx}, ${iIdx})" class="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-accent transition flex items-center justify-center" title="Add Resource"><span class="material-symbols-outlined text-lg">attachment</span></button>
                                    <button onclick="wizardOpenModal('modal-add-quiz', ${sIdx}, ${iIdx})" class="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-accent transition flex items-center justify-center" title="Add Quiz"><span class="material-symbols-outlined text-lg">quiz</span></button>
                                </div>
                            </div>
                        </div>
                    </div>`;
            });
        }

        html += `
        <div draggable="true" ondragstart="dragStartSection(event, ${sIdx})" ondragover="dragOverSection(event)" ondrop="dropSection(event, ${sIdx})" class="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-visible relative mb-8 cursor-grab active:cursor-grabbing">
            <div class="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50 pointer-events-none">
                <div class="flex items-center gap-4">
                    <span class="material-symbols-outlined text-slate-400 cursor-move">drag_indicator</span>
                    <div class="flex items-center gap-2 relative pointer-events-auto">
                        <span class="text-sm font-bold text-slate-400 uppercase">Section ${sIdx + 1}:</span>
                        <input type="text" value="${sec.title}" onchange="updateSectionTitle(${sIdx}, this.value)" class="text-lg font-semibold text-slate-900 dark:text-white bg-transparent border-none outline-none focus:ring-0 p-0 rounded px-1 w-64" placeholder="Section Title..." />
                    </div>
                </div>
                <div class="flex items-center gap-2 pointer-events-auto">
                    <button onclick="deleteSection(${sIdx})" class="text-slate-400 hover:text-red-500 transition p-1 rounded">
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
        
        if (lesson.video) {
            if (titleEl) titleEl.value = lesson.video.title || '';
            if (nameEl) nameEl.innerText = lesson.video.url ? 'Video attached' : 'Click or drag video to upload';
        } else {
            if (titleEl) titleEl.value = '';
            if (nameEl) nameEl.innerText = 'Click or drag video to upload';
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
    if (confirm('Remove this resource?')) {
        window.courseDraft.curriculum[sIdx].items[iIdx].resources.splice(rIdx, 1);
        renderResourceList(sIdx, iIdx);
        renderCurriculum();
        window.saveDraft(true);
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.querySelector('div')?.classList.add('scale-95', 'opacity-0');
        setTimeout(() => { modal.classList.remove('flex'); modal.classList.add('hidden'); }, 300);
    }
}

async function wizardSaveModalVideo() {
    const fileEl = document.getElementById('modal-video-upload');
    const embedUrl = document.getElementById('modal-video-embed-url')?.value;
    const title = document.getElementById('modal-video-title')?.value || 'Video Lecture';

    let uploadedUrl = null;
    if (fileEl && fileEl.files && fileEl.files[0]) {
        try {
            const lessonId = window.courseDraft.curriculum[activeModalSectionIdx].items[activeModalItemIdx].id;
            uploadedUrl = await CourseService.uploadLessonVideo(lessonId, fileEl.files[0]);
        } catch (e) { alert('Upload failed: ' + e.message); return; }
    } else if (embedUrl) {
        uploadedUrl = embedUrl;
    }

    if (activeModalItemIdx !== -1) {
        const item = window.courseDraft.curriculum[activeModalSectionIdx].items[activeModalItemIdx];
        item.content_type = 'video';
        item.video = { title: title, url: uploadedUrl };
        // Sync the video title to the lesson description for DB persistence
        item.description = title;
    }
    window.saveDraft(true);
    renderCurriculum();
    closeModal('modal-add-video');
}

async function saveModalResource() {
    let title = document.getElementById('modal-resource-title-input')?.value || `New Resource`;
    const fileEl = document.getElementById('modal-resource-upload');
    const externalUrl = document.getElementById('external-link')?.value;

    let uploadedUrl = null;
    if (fileEl && fileEl.files && fileEl.files[0]) {
        try {
            uploadedUrl = await CourseService.uploadLessonResource(window.courseDraft.id, fileEl.files[0]);
        } catch (e) { 
            console.error("Resource upload failed:", e);
            alert('Resource upload failed: ' + e.message); 
            return; 
        }
    } else if (externalUrl) {
        uploadedUrl = externalUrl;
    } else {
        alert('Please select a file to upload or provide an external link.');
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
            container.appendChild(video);
        }
        video.src = url;
        
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
        
        if (type === 'paid' && (!price?.value || parseFloat(price.value) <= 0)) {
            markFieldError(price);
            isValid = false;
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
                    let badge = '';
                    let icon = 'description';
                    
                    const quizCount = (les.quiz && les.quiz.length > 0) ? les.quiz.length : 0;
                    const resourceCount = les.resources ? les.resources.length : 0;

                    if (les.content_type === 'video' || les.video) {
                        badge = `<span class="bg-blue-50 dark:bg-blue-900/30 text-blue-600 px-2 py-0.5 rounded text-[10px] font-bold">VIDEO</span>`;
                        icon = 'play_circle';
                    } else if (les.content_type === 'quiz' || quizCount > 0) {
                        badge = `<span class="bg-amber-50 dark:bg-amber-900/30 text-amber-600 px-2 py-0.5 rounded text-[10px] font-bold">${quizCount} QUIZ${quizCount !== 1 ? 'ZES' : ''}</span>`;
                        icon = 'quiz';
                    }
                    
                    const resBadge = resourceCount > 0 ? `<span class="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 px-2 py-0.5 rounded text-[10px] font-bold">${resourceCount} RES</span>` : '';

                    lessonsHtml += `
                    <div class="flex items-center justify-between py-2 border-b border-slate-50 dark:border-slate-800 last:border-0 pl-4 overflow-x-auto flex-nowrap lesson-summary-row">
                        <div class="flex items-center gap-3 shrink-0 mr-4">
                            <span class="material-symbols-outlined text-slate-400 text-lg">${icon}</span>
                            <span class="text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">${les.title}</span>
                        </div>
                        <div class="flex items-center gap-1">
                            ${badge}
                            ${resBadge}
                        </div>
                    </div>`;
                });

                html += `
                <div class="border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
                    <div class="bg-slate-50/50 dark:bg-slate-800/50 p-3 flex items-center justify-between border-b border-slate-100 dark:border-slate-800">
                        <span class="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Section ${sIdx + 1}: ${sec.title}</span>
                        <span class="text-xs text-slate-400 font-medium">${sec.items ? sec.items.length : 0} Lessons</span>
                    </div>
                    <div class="p-2 space-y-1">
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
    const earnings = (price * 0.70).toFixed(2);

    // 1. Update Final Price Preview (Step 4 Card)
    if (priceDisplay) priceDisplay.innerText = priceStr;
    
    // 2. Update Payout Estimation (Step 3 Info Box)
    if (payoutEl) {
        if (isFree) {
            payoutEl.innerHTML = `This course is currently <span class="font-bold text-accent">Free</span>. Switch to Paid to enable earnings estimation.`;
        } else {
            payoutEl.innerHTML = `
                You receive <span class="font-bold text-accent">70%</span> of each sale. 
                For a price of $${price.toFixed(2)}, your estimated earnings per sale will be 
                <span class="font-bold text-slate-900 dark:text-white">$${earnings}</span>.
            `;
        }
    }
}

// Consolidated version above

async function publishCourse() {
    try {
        await window.saveDraft(true); // Always save before publish
        if (!window.courseDraft.id) throw new Error("Could not save the course draft. Please check your data.");

        await CourseService.publishCourse(window.courseDraft.id);

        document.querySelectorAll('.wizard-step').forEach(el => {
            el.classList.add('hidden'); el.classList.remove('block');
        });
        document.getElementById('step-5-container')?.classList.remove('hidden');
        document.getElementById('step-5-container')?.classList.add('flex');
        document.getElementById('bottom-nav')?.classList.add('hidden');
    } catch (e) {
        alert("Failed to publish: " + e.message);
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
        await saveCurrentStepData();
        showToast("Draft safely saved in Supabase.");
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
    if (confirm('Are you sure you want to exit?\n\nYour current progress has been auto-saved as a draft. You can continue from where you left off!')) {
        // Save current step data before exit so draft is complete
        await saveCurrentStepData();
        // Persist the current step so resume works
        persistStep(window.courseDraft.id, window.currentStep);
        window.location.href = '/src/pages/instructor/instructor-courses/index.html';
    }
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
        toggleResourceForm,
        saveModalResource,
        deleteResource,
        calculatePayout: wizardCalculatePayout
    };

    for (const [key, val] of Object.entries(globals)) {
        window[key] = val;
    }
}

registerGlobals();

// --- COUPON MANAGEMENT ---

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
        <div class="flex items-center gap-3 p-3 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800/50">
            <div class="flex-1 grid grid-cols-3 gap-3">
                <div>
                    <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Coupon Code</label>
                    <input id="cp-code-${idx}" class="w-full text-sm uppercase rounded bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 focus:ring-accent focus:border-accent" value="${cp.code || cp.coupon_code || ''}" placeholder="SUMMER20" />
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Discount (%)</label>
                    <input id="cp-pct-${idx}" type="number" min="1" max="100" class="w-full text-sm rounded bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 focus:ring-accent focus:border-accent" value="${cp.percent || cp.discount_percent || ''}" placeholder="20" />
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Expiration</label>
                    <input id="cp-exp-${idx}" type="date" class="w-full text-sm rounded bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 focus:ring-accent focus:border-accent" value="${(cp.expiry || cp.expires_at || '').split('T')[0]}" />
                </div>
            </div>
            <button onclick="removeCourseCoupon(${idx})" class="p-2 mt-4 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition shrink-0">
                <span class="material-symbols-outlined text-[20px]">delete</span>
            </button>
        </div>`;
    });
    container.innerHTML = html;
}

function syncCourseCoupons() {
    if (!window.courseDraft.pricing.coupons) return;
    const synced = [];
    window.courseDraft.pricing.coupons.forEach((cp, idx) => {
        const codeInput = document.getElementById(`cp-code-${idx}`);
        const pctInput = document.getElementById(`cp-pct-${idx}`);
        const expInput = document.getElementById(`cp-exp-${idx}`);
        
        if (codeInput && pctInput) {
            synced.push({
                code: codeInput.value.toUpperCase().trim(),
                percent: parseInt(pctInput.value) || null,
                expiry: expInput.value || null
            });
        }
    });
    window.courseDraft.pricing.coupons = synced;
}

window.addCourseCoupon = function() {
    syncCourseCoupons();
    window.courseDraft.pricing.coupons = window.courseDraft.pricing.coupons || [];
    window.courseDraft.pricing.coupons.push({ code: '', percent: null, expiry: null });
    renderCourseCoupons();
};

window.removeCourseCoupon = function(idx) {
    syncCourseCoupons();
    window.courseDraft.pricing.coupons.splice(idx, 1);
    renderCourseCoupons();
};
