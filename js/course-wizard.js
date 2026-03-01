/**
 * Course Creation Wizard Logic
 */

// Global state
let courseDraft = {
    title: '',
    subtitle: '',
    description: '',
    category: '',
    level: 'Beginner',
    thumbnail: null,
    video: null,
    curriculum: [],
    pricing: {
        type: 'free', // 'free' or 'paid'
        currency: 'USD',
        price: null,
        coupon: ''
    },
    privacy: 'public',
    published: false
};

let currentStep = 1;
const totalSteps = 4;

let draggedSectionIdx = null;
let draggedItemInfo = null;

document.addEventListener('DOMContentLoaded', () => {
    loadDraft();
    updateUI();
    setupEventListeners();
});

// --- STATE MANAGEMENT & PERSISTENCE ---

function saveDraft() {
    localStorage.setItem('tacliimi_course_draft', JSON.stringify(courseDraft));
    showToast('Draft saved automatically.');
}

function loadDraft() {
    const saved = localStorage.getItem('tacliimi_course_draft');
    if (saved) {
        try {
            courseDraft = JSON.parse(saved);
        } catch (e) {
            console.error("Could not parse draft:", e);
        }
    }
}

// --- NAVIGATION ---

function goToStep(stepNumber) {
    if (stepNumber < 1 || stepNumber > totalSteps) return;

    // Save previous step data
    saveCurrentStepData();

    // Hide all steps
    document.querySelectorAll('.wizard-step').forEach(el => {
        el.classList.add('hidden');
        el.classList.remove('block');
    });

    // Show current step
    const currContainer = document.getElementById(`step-${stepNumber}-container`);
    if (currContainer) {
        currContainer.classList.remove('hidden');
        currContainer.classList.add('block');
    }

    currentStep = stepNumber;
    updateUI();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateUI() {
    // 1. Update Progress Bar
    const pb = document.getElementById('progress-bar');
    if (pb) pb.style.width = `${(currentStep / totalSteps) * 100}%`;

    // 2. Update Step Subtitle
    const subtitles = [
        "Step 1 of 4: Basic Information",
        "Step 2 of 4: Curriculum",
        "Step 3 of 4: Pricing",
        "Step 4 of 4: Publish & Preview"
    ];
    const subEl = document.getElementById('step-subtitle');
    if (subEl) subEl.textContent = subtitles[currentStep - 1] || '';

    // 3. Update Visual Indicators
    document.querySelectorAll('.step-ind').forEach(el => {
        const s = parseInt(el.getAttribute('data-step'));
        const iconBg = el.querySelector('.icon-bg');
        const titleText = el.querySelector('.title-text');

        if (s < currentStep) {
            // Completed
            iconBg.className = 'w-10 h-10 rounded-full bg-blue-100 text-primary flex items-center justify-center transition icon-bg';
            iconBg.innerHTML = '<span class="material-icons text-xl">check_circle</span>';
            titleText.className = 'text-xs font-semibold text-slate-400 uppercase tracking-wider title-text transition';
        } else if (s === currentStep) {
            // Active
            iconBg.className = 'w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center ring-4 ring-blue-50 dark:ring-blue-900/30 transition icon-bg';

            const icons = ['info', 'menu_book', 'payments', 'publish'];
            iconBg.innerHTML = `<span class="material-icons text-xl">${icons[s - 1]}</span>`;
            titleText.className = 'text-xs font-semibold text-primary uppercase tracking-wider title-text transition';
        } else {
            // Future
            iconBg.className = 'w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 flex items-center justify-center transition group-hover:bg-slate-300 dark:group-hover:bg-slate-700 icon-bg';
            const icons = ['info', 'menu_book', 'payments', 'publish'];
            iconBg.innerHTML = `<span class="material-icons text-xl">${icons[s - 1]}</span>`;
            titleText.className = 'text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider title-text transition';
        }
    });

    // 4. Update Navigation Buttons
    const btnNext = document.getElementById('btn-next');
    const btnPrev = document.getElementById('btn-prev');
    const btnPublish = document.getElementById('btn-publish');

    if (btnPrev) {
        if (currentStep === 1) {
            btnPrev.disabled = true;
            btnPrev.classList.add('opacity-50', 'cursor-not-allowed');
        } else {
            btnPrev.disabled = false;
            btnPrev.classList.remove('opacity-50', 'cursor-not-allowed');
            btnPrev.classList.add('hover:bg-slate-100', 'dark:hover:bg-slate-800');
        }
    }

    if (btnNext && btnPublish) {
        if (currentStep === totalSteps) {
            btnNext.classList.add('hidden');
            btnPublish.classList.remove('hidden');
            renderFinalPreview();
        } else {
            btnNext.classList.remove('hidden');
            btnPublish.classList.add('hidden');
        }
    }

    // Load data into fields
    populateFields();
}

function saveCurrentStepData() {
    if (currentStep === 1) {
        courseDraft.title = document.getElementById('course-title')?.value || '';
        courseDraft.subtitle = document.getElementById('course-subtitle')?.value || '';
        courseDraft.description = document.getElementById('description')?.value || '';
        courseDraft.category = document.getElementById('course-category')?.value || '';
        courseDraft.level = document.getElementById('course-level')?.value || 'Beginner';
    } else if (currentStep === 3) {
        courseDraft.pricing.currency = document.getElementById('course-currency')?.value || 'USD';
        courseDraft.pricing.price = document.getElementById('course-price')?.value || null;
        courseDraft.pricing.coupon = document.getElementById('course-coupon')?.value || '';
    } else if (currentStep === 4) {
        const privacyEl = document.querySelector('input[name="privacy"]:checked');
        if (privacyEl) courseDraft.privacy = privacyEl.value;
    }
    saveDraft();
}

function populateFields() {
    if (currentStep === 1) {
        if (document.getElementById('course-title')) document.getElementById('course-title').value = courseDraft.title;
        if (document.getElementById('course-subtitle')) document.getElementById('course-subtitle').value = courseDraft.subtitle;
        if (document.getElementById('description')) document.getElementById('description').value = courseDraft.description;
        if (document.getElementById('course-category')) document.getElementById('course-category').value = courseDraft.category;
        if (document.getElementById('course-level')) document.getElementById('course-level').value = courseDraft.level;

        if (courseDraft.thumbnail) showThumbnailPreview(courseDraft.thumbnail);
        if (courseDraft.video) {
            document.getElementById('video-upload-success')?.classList.remove('hidden');
            document.getElementById('video-upload-success')?.classList.add('flex');
            const fileNameEl = document.getElementById('video-filename');
            if (fileNameEl) fileNameEl.innerText = courseDraft.video.name;
        }
    } else if (currentStep === 2) {
        renderCurriculum();
    } else if (currentStep === 3) {
        setPricingTier(courseDraft.pricing.type);
        if (document.getElementById('course-currency')) document.getElementById('course-currency').value = courseDraft.pricing.currency;
        if (document.getElementById('course-price')) document.getElementById('course-price').value = courseDraft.pricing.price || '';
        if (document.getElementById('course-coupon')) document.getElementById('course-coupon').value = courseDraft.pricing.coupon || '';
        calculatePayout();
    } else if (currentStep === 4) {
        const privacyEl = document.querySelector(`input[name="privacy"][value="${courseDraft.privacy || 'public'}"]`);
        if (privacyEl) privacyEl.checked = true;
    }
}

function setupEventListeners() {
    // Nav Buttons
    document.getElementById('btn-next')?.addEventListener('click', () => {
        if (validateStep(currentStep)) goToStep(currentStep + 1);
    });
    document.getElementById('btn-prev')?.addEventListener('click', () => goToStep(currentStep - 1));
    document.getElementById('btn-publish')?.addEventListener('click', publishCourse);

    // Step Indicators (Clickable)
    document.querySelectorAll('.step-ind').forEach(el => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => {
            const step = parseInt(el.getAttribute('data-step'));
            // Allow going backward anytime, or forward if current step is validated
            if (step < currentStep || (step > currentStep && validateStep(currentStep))) {
                goToStep(step);
            }
        });
    });

    // Auto-save on blur
    document.querySelectorAll('.course-input').forEach(input => {
        input.addEventListener('blur', saveCurrentStepData);
    });

    // Thumbnail upload logic
    const thumbUpload = document.getElementById('thumbnail-upload');
    if (thumbUpload) {
        thumbUpload.addEventListener('change', function (e) {
            if (e.target.files && e.target.files[0]) {
                const reader = new FileReader();
                reader.onload = function (e) {
                    courseDraft.thumbnail = e.target.result;
                    showThumbnailPreview(e.target.result);
                    saveDraft();
                }
                reader.readAsDataURL(e.target.files[0]);
            }
        });
    }

    // Video upload logic
    const vidUpload = document.getElementById('video-upload');
    if (vidUpload) {
        vidUpload.addEventListener('change', function (e) {
            if (e.target.files && e.target.files[0]) {
                const file = e.target.files[0];
                courseDraft.video = { name: file.name, size: file.size }; // Simulating upload
                document.getElementById('video-upload-success')?.classList.remove('hidden');
                document.getElementById('video-upload-success')?.classList.add('flex');

                const fileNameEl = document.getElementById('video-filename');
                if (fileNameEl) fileNameEl.innerText = file.name;
                saveDraft();
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
                if (r.checked) {
                    label.classList.add('border-primary', 'bg-primary/5');
                    label.classList.remove('border-slate-200', 'dark:border-slate-700', 'hover:border-slate-300', 'dark:hover:border-slate-600');
                } else {
                    label.classList.remove('border-primary', 'bg-primary/5');
                    label.classList.add('border-slate-200', 'dark:border-slate-700', 'hover:border-slate-300', 'dark:hover:border-slate-600');
                }
            });
            saveCurrentStepData();
        });
    });

    // Pricing Calculation
    document.getElementById('course-price')?.addEventListener('input', calculatePayout);
}

function validateStep(step) {
    if (step === 1) {
        const title = document.getElementById('course-title').value;
        if (!title.trim()) {
            alert('Course Title is required.');
            return false;
        }
    }
    return true;
}

// --- CURRICULUM LOGIC ---

function addSection() {
    const sectionIndex = courseDraft.curriculum.length;
    courseDraft.curriculum.push({
        title: `Section ${sectionIndex + 1}`,
        items: []
    });
    saveDraft();
    renderCurriculum();
}

function addItemToSection(sectionIndex, type) {
    // Current valid types: video, resource, quiz
    // We will simulate opening the modal for video/resource
    if (type === 'quiz') {
        openModal('modal-add-quiz', sectionIndex);
    } else {
        openModal('modal-add-resource', sectionIndex, type);
    }
}

function renderCurriculum() {
    const container = document.getElementById('curriculum-container');
    if (!container) return;

    if (courseDraft.curriculum.length === 0) {
        container.innerHTML = `<div class="w-full text-center py-6 text-slate-500 italic text-sm">Use the button below to add your first section.</div>`;
        return;
    }

    let html = '';
    courseDraft.curriculum.forEach((sec, sIdx) => {
        let itemsHtml = '';

        if (sec.items && sec.items.length > 0) {
            sec.items.forEach((item, iIdx) => {
                let metaParts = [];
                if (item.video) metaParts.push('1 Video');
                if (item.quizzes && item.quizzes.length > 0) metaParts.push(`${item.quizzes.length} Quiz${item.quizzes.length > 1 ? 'zes' : ''}`);
                if (item.resources && item.resources.length > 0) metaParts.push(`${item.resources.length} Resource${item.resources.length > 1 ? 's' : ''}`);

                let displayMeta = metaParts.length > 0 ? metaParts.join(' • ') : 'No content added yet';

                itemsHtml += `
                    <div class="group border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 hover:border-primary/30 transition-colors mb-3"
                         draggable="true" ondragstart="dragStartItem(event, ${sIdx}, ${iIdx})" ondragover="dragOverItem(event)" ondrop="dropItem(event, ${sIdx}, ${iIdx})">
                        <div class="p-4 flex items-center justify-between">
                            <div class="flex items-center gap-4 w-full">
                                <span class="material-symbols-outlined text-slate-300 cursor-move group-hover:text-slate-400">drag_handle</span>
                                <div class="flex items-center gap-3 w-full">
                                    <span class="material-symbols-outlined text-slate-400">play_circle</span>
                                    <div class="flex flex-col w-full text-left">
                                        <input class="text-sm font-medium text-slate-900 dark:text-white leading-none bg-transparent border-none focus:ring-0 p-0 hover:bg-slate-50 dark:hover:bg-slate-800 transition w-full mb-1" 
                                           value="${item.title}" onblur="updateItemTitle(${sIdx}, ${iIdx}, this.value)" />
                                        <p class="text-[11px] font-bold text-slate-400 mt-0.5 uppercase tracking-wider">${displayMeta}</p>
                                    </div>
                                </div>
                            </div>
                            <div class="flex items-center gap-1 shrink-0 ml-4">
                                <button onclick="deleteItem(${sIdx}, ${iIdx})" class="p-2 text-slate-400 hover:text-red-500 transition"><span class="material-symbols-outlined text-xl">delete</span></button>
                            </div>
                        </div>
                        <div class="px-4 pb-4 flex gap-2">
                            <button onclick="openModal('modal-add-video', ${sIdx}, ${iIdx})" class="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-xs font-semibold hover:bg-blue-100 transition">
                                <span class="material-symbols-outlined text-sm">videocam</span> Add Video
                            </button>
                            <button onclick="openModal('modal-add-quiz', ${sIdx}, ${iIdx})" class="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 text-xs font-semibold hover:bg-amber-100 transition">
                                <span class="material-symbols-outlined text-sm">quiz</span> Add Quiz
                            </button>
                            <button onclick="openModal('modal-add-resource', ${sIdx}, ${iIdx})" class="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold hover:bg-emerald-100 transition">
                                <span class="material-symbols-outlined text-sm">attachment</span> Add Resource
                            </button>
                        </div>
                    </div>`;
            });
        } else {
            itemsHtml += `<div class="p-8 text-center text-slate-400 dark:text-slate-500 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl" ondragover="dragOverItem(event)" ondrop="dropItemEmpty(event, ${sIdx})">No content added yet. Drag items here or add new.</div>`;
        }

        html += `
        <div draggable="true" ondragstart="dragStartSection(event, ${sIdx})" ondragover="dragOverSection(event)" ondrop="dropSection(event, ${sIdx})" class="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-visible relative mb-8 cursor-grab active:cursor-grabbing">
            <div class="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50 pointer-events-none">
                <div class="flex items-center gap-4">
                    <span class="material-symbols-outlined text-slate-400 cursor-move">drag_indicator</span>
                    <div class="flex items-center gap-2 relative pointer-events-auto">
                        <span class="text-sm font-bold text-slate-400 uppercase">Section ${sIdx + 1}:</span>
                        <input type="text" value="${sec.title}" onchange="updateSectionTitle(${sIdx}, this.value)" class="text-lg font-semibold text-slate-900 dark:text-white bg-transparent border-none outline-none focus:ring-0 p-0 hover:ring-2 hover:ring-accent hover:ring-offset-4 hover:ring-offset-slate-50 dark:hover:ring-offset-slate-800 rounded px-1 w-64" placeholder="Section Title..." />
                        <button onclick="$(this).prev('input').focus()" class="text-slate-400 hover:text-primary transition p-1 rounded">
                            <span class="material-symbols-outlined text-lg">edit</span>
                        </button>
                    </div>
                </div>
                <div class="flex items-center gap-2 pointer-events-auto">
                    <button onclick="deleteSection(${sIdx})" class="text-slate-400 hover:text-red-500 transition p-1 rounded">
                        <span class="material-symbols-outlined">delete</span>
                    </button>
                    <button class="text-slate-400 hover:text-slate-600 transition p-1">
                        <span class="material-symbols-outlined">expand_less</span>
                    </button>
                </div>
            </div>
            <div class="p-6 space-y-4" ondragover="dragOverItem(event)" ondrop="dropItemEmpty(event, ${sIdx})">
                ${itemsHtml}
                <button onclick="addLesson(${sIdx})" class="w-full py-4 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-lg flex items-center justify-center gap-2 text-slate-400 hover:text-primary hover:border-primary/50 hover:bg-slate-50 transition group">
                    <span class="material-symbols-outlined">add_circle</span>
                    <span class="text-sm font-semibold">Add Content</span>
                </button>
            </div>
        </div>`;
    });

    container.innerHTML = html;
}

function addLesson(sIdx) {
    if (!courseDraft.curriculum[sIdx].items) courseDraft.curriculum[sIdx].items = [];
    courseDraft.curriculum[sIdx].items.push({
        type: 'lesson',
        title: `Lesson ${courseDraft.curriculum[sIdx].items.length + 1}: New Content`,
        video: null,
        quizzes: [],
        resources: []
    });
    saveDraft();
    renderCurriculum();
}

function deleteSection(idx) {
    if (confirm('Delete this entire section?')) {
        courseDraft.curriculum.splice(idx, 1);
        saveDraft();
        renderCurriculum();
    }
}

function updateSectionTitle(idx, newTitle) {
    if (newTitle && newTitle.trim() !== '') {
        courseDraft.curriculum[idx].title = newTitle.trim();
        saveDraft();
    }
}

function updateItemTitle(sIdx, iIdx, newTitle) {
    if (newTitle && newTitle.trim() !== '') {
        courseDraft.curriculum[sIdx].items[iIdx].title = newTitle.trim();
        saveDraft();
    }
}

function deleteItem(sIdx, iIdx) {
    courseDraft.curriculum[sIdx].items.splice(iIdx, 1);
    saveDraft();
    renderCurriculum();
}

// --- DRAG AND DROP ---

function dragStartSection(e, idx) {
    draggedSectionIdx = idx;
    e.dataTransfer.effectAllowed = 'move';
    e.stopPropagation(); // don't drag parent
}

function dragOverSection(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function dropSection(e, dropIdx) {
    e.preventDefault();
    e.stopPropagation();
    if (draggedSectionIdx !== null && draggedSectionIdx !== dropIdx) {
        // Swap sections
        const draggedSec = courseDraft.curriculum.splice(draggedSectionIdx, 1)[0];
        courseDraft.curriculum.splice(dropIdx, 0, draggedSec);
        saveDraft();
        renderCurriculum();
    }
    draggedSectionIdx = null;
}

function dragStartItem(e, sIdx, iIdx) {
    draggedItemInfo = { sIdx, iIdx };
    e.dataTransfer.effectAllowed = 'move';
    e.stopPropagation();
}

function dragOverItem(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function dropItem(e, targetSIdx, targetIIdx) {
    e.preventDefault();
    e.stopPropagation();
    if (draggedItemInfo) {
        const { sIdx, iIdx } = draggedItemInfo;
        const item = courseDraft.curriculum[sIdx].items.splice(iIdx, 1)[0];
        courseDraft.curriculum[targetSIdx].items.splice(targetIIdx, 0, item);
        saveDraft();
        renderCurriculum();
    }
    draggedItemInfo = null;
}

function dropItemEmpty(e, targetSIdx) {
    e.preventDefault();
    if (draggedItemInfo && e.target.closest('.p-4')) {
        // Drop into empty section or end of section
        const { sIdx, iIdx } = draggedItemInfo;
        // avoid duplicating action if dropItem handled it
        if (sIdx === targetSIdx && iIdx === courseDraft.curriculum[targetSIdx].items.length - 1) return;

        const item = courseDraft.curriculum[sIdx].items.splice(iIdx, 1)[0];
        courseDraft.curriculum[targetSIdx].items.push(item);
        saveDraft();
        renderCurriculum();
        draggedItemInfo = null;
    }
}

// --- MODALS ---

let activeModalSectionIdx = -1;
let activeModalItemIdx = -1;
let activeModalType = '';
let currentQuizQuestions = [];

function openModal(modalId, sIdx, iIdx) {
    activeModalSectionIdx = sIdx;
    activeModalItemIdx = iIdx;

    if (modalId === 'modal-add-video') activeModalType = 'video';
    else if (modalId === 'modal-add-quiz') activeModalType = 'quiz';
    else if (modalId === 'modal-add-resource') activeModalType = 'resource';

    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        // Stagger animation
        setTimeout(() => {
            const content = modal.querySelector('div');
            if (content) {
                content.classList.remove('scale-95', 'opacity-0');
                content.classList.add('scale-100', 'opacity-100');
            }
        }, 10);

        if (modalId === 'modal-add-video') {
            if (document.getElementById('modal-video-title')) document.getElementById('modal-video-title').value = '';
        } else if (modalId === 'modal-add-resource') {
            if (document.getElementById('modal-resource-title-input')) document.getElementById('modal-resource-title-input').value = '';
        } else if (modalId === 'modal-add-quiz') {
            if (document.getElementById('quiz-modal-title')) document.getElementById('quiz-modal-title').value = '';
            if (document.getElementById('quiz-modal-desc')) document.getElementById('quiz-modal-desc').value = '';
            // Init with one question
            currentQuizQuestions = [{ text: '', options: [{ text: '', correct: true }, { text: '', correct: false }] }];
            renderQuizQuestions();
        }
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        const content = modal.querySelector('div');
        if (content) {
            content.classList.remove('scale-100', 'opacity-100');
            content.classList.add('scale-95', 'opacity-0');
        }

        setTimeout(() => {
            modal.classList.remove('flex');
            modal.classList.add('hidden');
        }, 300);
    }
}

function saveModalVideo() {
    let title = document.getElementById('modal-video-title')?.value || `New Video Lecture`;
    let duration = document.querySelector('input[placeholder="00:00"]')?.value || '10:00';

    if (activeModalItemIdx !== -1 && courseDraft.curriculum[activeModalSectionIdx].items[activeModalItemIdx]) {
        courseDraft.curriculum[activeModalSectionIdx].items[activeModalItemIdx].video = {
            title: title,
            duration: duration
        };
    }

    saveDraft();
    renderCurriculum();
    closeModal('modal-add-video');
}

function saveModalResource() {
    let title = document.getElementById('modal-resource-title-input')?.value || `New Resource`;

    if (activeModalItemIdx !== -1 && courseDraft.curriculum[activeModalSectionIdx].items[activeModalItemIdx]) {
        if (!courseDraft.curriculum[activeModalSectionIdx].items[activeModalItemIdx].resources) {
            courseDraft.curriculum[activeModalSectionIdx].items[activeModalItemIdx].resources = [];
        }
        courseDraft.curriculum[activeModalSectionIdx].items[activeModalItemIdx].resources.push({
            title: title
        });
    }

    saveDraft();
    renderCurriculum();
    closeModal('modal-add-resource');
}

function saveModalQuiz() {
    syncQuizInputs();

    const title = document.getElementById('quiz-modal-title')?.value || 'New Quiz';

    if (activeModalItemIdx !== -1 && courseDraft.curriculum[activeModalSectionIdx].items[activeModalItemIdx]) {
        if (!courseDraft.curriculum[activeModalSectionIdx].items[activeModalItemIdx].quizzes) {
            courseDraft.curriculum[activeModalSectionIdx].items[activeModalItemIdx].quizzes = [];
        }
        courseDraft.curriculum[activeModalSectionIdx].items[activeModalItemIdx].quizzes.push({
            title: title,
            questions: currentQuizQuestions
        });
    }

    saveDraft();
    renderCurriculum();
    closeModal('modal-add-quiz');
}

// --- QUIZ DYNAMIC LOGIC ---

function renderQuizQuestions() {
    const container = document.getElementById('quiz-questions-dynamic-container');
    if (!container) return;

    let html = '';
    currentQuizQuestions.forEach((q, qIdx) => {
        let optionsHtml = '';
        q.options.forEach((opt, oIdx) => {
            optionsHtml += `
                <div class="flex items-center gap-3 group">
                <input class="text-accent focus:ring-accent w-5 h-5 border-slate-300"
                    name="correct-answer-${qIdx}" type="radio" onchange="setQuizCorrectAnswer(${qIdx}, ${oIdx})" ${opt.correct ? 'checked' : ''} />
                <input
                    class="flex-1 rounded-lg border-slate-200 dark:border-slate-700 dark:bg-slate-800 text-sm py-2 quiz-opt-input"
                    type="text" placeholder="Option text..." value="${opt.text}" data-qidx="${qIdx}" data-oidx="${oIdx}" />
                <button onclick="removeQuizOption(${qIdx}, ${oIdx})" class="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"><span class="material-symbols-outlined text-sm">close</span></button>
            </div>`;
        });

        html += `
                <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div class="flex items-center justify-between mb-4">
                <h3 class="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <span class="w-6 h-6 rounded-full bg-accent text-white text-xs flex items-center justify-center">${qIdx + 1}</span>
                    Question ${qIdx + 1}
                </h3>
                <button onclick="removeQuizQuestion(${qIdx})" class="text-slate-400 hover:text-red-500 text-sm flex items-center gap-1"><span class="material-symbols-outlined text-sm">delete</span> Remove</button>
            </div>
            <div class="space-y-4">
                <input class="w-full rounded-lg border-slate-300 dark:border-slate-700 dark:bg-slate-800 font-medium quiz-q-input"
                    placeholder="Type your question here..." type="text" value="${q.text}" data-qidx="${qIdx}" />
                <div class="space-y-3">
                    ${optionsHtml}
                    <button onclick="addQuizOption(${qIdx})" class="text-sm text-primary font-semibold hover:underline flex items-center gap-1 mt-2">
                        <span class="material-symbols-outlined text-sm">add</span> Add Option
                    </button>
                </div>
            </div>
        </div>`;
    });

    container.innerHTML = html;
}

function syncQuizInputs() {
    // Copy input values back to currentQuizQuestions state
    document.querySelectorAll('.quiz-q-input').forEach(input => {
        const qIdx = parseInt(input.getAttribute('data-qidx'));
        currentQuizQuestions[qIdx].text = input.value;
    });
    document.querySelectorAll('.quiz-opt-input').forEach(input => {
        const qIdx = parseInt(input.getAttribute('data-qidx'));
        const oIdx = parseInt(input.getAttribute('data-oidx'));
        currentQuizQuestions[qIdx].options[oIdx].text = input.value;
    });
}

function addQuizQuestion() {
    syncQuizInputs();
    currentQuizQuestions.push({ text: '', options: [{ text: '', correct: true }, { text: '', correct: false }] });
    renderQuizQuestions();
}

function removeQuizQuestion(qIdx) {
    syncQuizInputs();
    currentQuizQuestions.splice(qIdx, 1);
    renderQuizQuestions();
}

function addQuizOption(qIdx) {
    syncQuizInputs();
    currentQuizQuestions[qIdx].options.push({ text: '', correct: false });
    renderQuizQuestions();
}

function removeQuizOption(qIdx, oIdx) {
    syncQuizInputs();
    currentQuizQuestions[qIdx].options.splice(oIdx, 1);
    // Ensure at least one is correct
    if (!currentQuizQuestions[qIdx].options.some(o => o.correct) && currentQuizQuestions[qIdx].options.length > 0) {
        currentQuizQuestions[qIdx].options[0].correct = true;
    }
    renderQuizQuestions();
}

function setQuizCorrectAnswer(qIdx, correctOIdx) {
    syncQuizInputs();
    currentQuizQuestions[qIdx].options.forEach((opt, idx) => {
        opt.correct = (idx === correctOIdx);
    });
    renderQuizQuestions();
}

// --- PRICING ---

function setPricingTier(tier) {
    courseDraft.pricing.type = tier;

    const btnFree = document.getElementById('btn-tier-free');
    const btnPaid = document.getElementById('btn-tier-paid');
    const detailsContainer = document.getElementById('pricing-details-container');

    if (tier === 'free') {
        btnFree.className = 'px-6 py-2 rounded-md text-sm font-bold bg-white dark:bg-slate-600 shadow-sm text-slate-900 dark:text-white transition';
        btnPaid.className = 'px-6 py-2 rounded-md text-sm font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white transition';

        detailsContainer.style.opacity = '0.5';
        detailsContainer.style.pointerEvents = 'none';

        document.getElementById('course-price').value = '';
        courseDraft.pricing.price = null;
    } else {
        btnPaid.className = 'px-6 py-2 rounded-md text-sm font-bold bg-white dark:bg-slate-600 shadow-sm text-slate-900 dark:text-white transition';
        btnFree.className = 'px-6 py-2 rounded-md text-sm font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white transition';

        detailsContainer.style.opacity = '1';
        detailsContainer.style.pointerEvents = 'auto';
    }

    saveDraft();
    calculatePayout();
}

function calculatePayout() {
    const priceInput = document.getElementById('course-price');
    const priceDisplay = document.getElementById('payout-price-display');
    const earningDisplay = document.getElementById('payout-earning-display');

    if (!priceInput || courseDraft.pricing.type === 'free') {
        if (priceDisplay) priceDisplay.innerText = "0.00";
        if (earningDisplay) earningDisplay.innerText = "0.00";
        return;
    }

    let price = parseFloat(priceInput.value) || 0;
    let earning = price * 0.70;

    if (priceDisplay) priceDisplay.innerText = price.toFixed(2);
    if (earningDisplay) earningDisplay.innerText = earning.toFixed(2);
}

// --- UTILS ---

function showToast(msg) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-message');
    if (toast && toastMsg) {
        toastMsg.innerText = msg;
        toast.classList.remove('translate-y-20', 'opacity-0');

        setTimeout(() => {
            toast.classList.add('translate-y-20', 'opacity-0');
        }, 3000);
    }
}

function showThumbnailPreview(dataUrl) {
    const container = document.getElementById('thumbnail-preview-container');
    const icon = document.getElementById('thumbnail-placeholder-icon');

    if (container) {
        container.style.backgroundImage = `url(${dataUrl})`;
        if (icon) icon.style.display = 'none';
    }
}

// --- PUBLISH ---

function renderFinalPreview() {
    const titleEl = document.getElementById('final-title-preview');
    const subEl = document.getElementById('final-subtitle-preview');
    const thumbEl = document.getElementById('final-thumbnail-preview');
    const thumbIcon = document.getElementById('final-thumbnail-icon');
    const sectsCountEl = document.getElementById('final-sections-count');
    const levelEl = document.getElementById('final-level-preview');
    const priceEl = document.getElementById('final-price-preview');

    const sumSecsEl = document.getElementById('summary-sections-count');
    const sumPriceEl = document.getElementById('summary-pricing-type');
    const sumDescEl = document.getElementById('summary-description-preview');
    const sumVidEl = document.getElementById('summary-video-preview');

    if (titleEl) titleEl.innerText = courseDraft.title || 'Untitled Course';
    if (subEl) subEl.innerText = courseDraft.subtitle || '';
    if (thumbEl && courseDraft.thumbnail) {
        thumbEl.style.backgroundImage = `url(${courseDraft.thumbnail})`;
        if (thumbIcon) thumbIcon.style.display = 'none';
    }

    const numSections = courseDraft.curriculum.length;
    if (sectsCountEl) sectsCountEl.innerText = numSections;
    if (sumSecsEl) sumSecsEl.innerText = numSections;

    if (levelEl) levelEl.innerText = courseDraft.level || 'Beginner';

    // Update basic info summary
    if (sumDescEl) sumDescEl.innerText = courseDraft.description || 'No description provided.';
    if (sumVidEl) sumVidEl.innerHTML = courseDraft.video ? `< span class="text-emerald-600 dark:text-emerald-400 font-bold" > Uploaded(${courseDraft.video.name})</span > ` : 'Not Uploaded';

    if (courseDraft.pricing.type === 'free' || !courseDraft.pricing.price) {
        if (priceEl) priceEl.innerText = 'Free';
        if (sumPriceEl) sumPriceEl.innerText = 'Free';
    } else {
        const symbol = courseDraft.pricing.currency === 'USD' ? '$' : (courseDraft.pricing.currency === 'EUR' ? '€' : '£');
        if (priceEl) priceEl.innerText = `${symbol}${parseFloat(courseDraft.pricing.price).toFixed(2)} `;
        if (sumPriceEl) sumPriceEl.innerText = `Paid(${symbol}${parseFloat(courseDraft.pricing.price).toFixed(2)
            })`;
    }
}

function publishCourse() {
    // Validate final checks
    if (!courseDraft.title) {
        alert("Course needs a title!");
        goToStep(1);
        return;
    }

    // Save step 4 data (Privacy)
    saveCurrentStepData();

    courseDraft.published = true;
    saveDraft();

    // Push to mock DB
    try {
        const newId = 'course-' + Math.random().toString(36).substr(2, 9);
        const newCourse = {
            id: newId,
            title: (courseDraft.title || '').trim() || 'Untitled New Course',
            description: courseDraft.description || 'No description provided.',
            category: courseDraft.category || 'Development',
            instructor: 'Your Name (Instructor)',
            instructorRole: 'Course Creator',
            thumbnailUrl: courseDraft.thumbnail || 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?ixlib=rb-4.0.3&auto=format&fit=crop&w=1740&q=80',
            price: courseDraft.pricing.price && courseDraft.pricing.price !== "0" ? parseFloat(courseDraft.pricing.price) : "Free",
            originalPrice: null,
            rating: 0,
            reviews: 0,
            duration: '0h',
            isBestseller: false,
            previewVideo: courseDraft.video?.previewUrl || courseDraft.video?.name || '',
            curriculum: courseDraft.curriculum || []
        };
        if (typeof TacliimiDB !== 'undefined') {
            TacliimiDB.addCourse(newCourse);
        } else {
            console.error("TacliimiDB not imported.");
        }
    } catch (e) {
        console.error("Could not save to mock DB:", e);
    }

    // Show step 5 (Congratulations)
    document.querySelectorAll('.wizard-step').forEach(el => {
        el.classList.add('hidden');
        el.classList.remove('block');
    });

    const successStep = document.getElementById('step-5-container');
    if (successStep) {
        successStep.classList.remove('hidden');
        successStep.classList.add('flex'); // Uses flex layout
    }

    // Hide bottom nav and update progress
    const nav = document.getElementById('bottom-nav');
    if (nav) nav.classList.add('hidden');

    const pb = document.getElementById('progress-bar');
    if (pb) pb.style.width = `100 % `;
}
