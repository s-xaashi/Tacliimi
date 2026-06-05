import { MentorService } from '../../../services/mentorService.js';
import { supabase } from '../../../services/supabaseClient.js';

async function initMentorProfile() {
    const urlParams = new URLSearchParams(window.location.search);
    const mentorId = urlParams.get('id');
    console.log("Profile page initialized with mentor ID:", mentorId);

    if (!mentorId) {
        console.warn("No mentor ID found in URL, redirecting to marketplace...");
        window.location.href = '/src/pages/mentorship/mentor-marketplace/index.html';
        return;
    }

    try {
        console.log("Loading profile for mentor ID:", mentorId);
        // Fetch mentor details using the consolidated service method
        const mentor = await MentorService.getMentorById(mentorId);

        if (!mentor) {
            console.error("Mentor not found for ID:", mentorId);
            alert("Mentor profile not found.");
            return;
        }

        console.log("Successfully fetched mentor:", mentor.full_name, "with instructor_id:", mentor.instructor_id);
        renderProfile(mentor);
    } catch (err) {
        console.error("Error loading profile:", err);
        alert("Error loading profile: " + err.message);
    }
}

function renderProfile(mentor) {
    // 1. Booking Button - Do this FIRST so it works even if other rendering fails
    const bookBtn = document.getElementById('book-session-btn');
    if (bookBtn) {
        const bookingUrl = `/src/pages/mentorship/mentor-booking/index.html?id=${mentor.instructor_id}`;
        bookBtn.setAttribute('href', bookingUrl);
        // Add a click handler as fallback
        bookBtn.onclick = (e) => {
            e.preventDefault();
            console.log("Booking button clicked, navigating to:", bookingUrl);
            window.location.href = bookingUrl;
        };
    }

    // 2. Basic Info
    document.querySelector('h1').textContent = mentor.full_name;
    const headlineEl = document.querySelector('.text-primary.font-semibold.text-sm.mt-1');
    if (headlineEl) headlineEl.textContent = mentor.headline || 'Professional Mentor';

    const avatarContainer = document.querySelector('.w-24.h-24.rounded-full');
    if (avatarContainer) {
        avatarContainer.innerHTML = `<img src="${mentor.avatar_url || '../../../assets/images/default-avatar.png'}" class="w-full h-full rounded-full object-cover" alt="${mentor.full_name}">`;
    }

    const ratingEl = document.querySelector('.font-bold.text-slate-700.dark\\:text-slate-300');
    if (ratingEl) ratingEl.textContent = mentor.rating || '0.0';

    const reviewsCountEl = document.querySelector('.text-slate-400.text-sm');
    if (reviewsCountEl) reviewsCountEl.textContent = `(${mentor.review_count || 0} reviews)`;

    const priceEl = document.getElementById('mentor-price');
    if (priceEl) priceEl.textContent = `$${mentor.hourly_rate || 0}`;

    // About / Bio
    const bioContainer = document.getElementById('mentor-bio');
    if (bioContainer) {
        bioContainer.textContent = mentor.short_bio || mentor.bio || 'Expert mentor ready to guide you.';
    }

    // Education
    const educationSection = document.getElementById('education-section');
    const educationList = document.getElementById('education-list');
    if (educationSection && educationList) {
        const eduData = mentor.education_list || [];
        if (eduData.length > 0) {
            educationSection.classList.remove('hidden');
            educationList.innerHTML = eduData.map(edu => `
                <div class="flex gap-4">
                    <div class="mt-1">
                        <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                            <span class="material-symbols-outlined text-sm">school</span>
                        </div>
                    </div>
                    <div>
                        <h4 class="text-sm font-bold text-slate-900 dark:text-white">${edu.degree || 'Degree'}</h4>
                        <p class="text-xs text-slate-500">${edu.university || edu.institution || 'Institution'}</p>
                    </div>
                </div>
            `).join('');
        } else {
            educationSection.classList.add('hidden');
        }
    }

    // Video
    const videoWrapper = document.querySelector('.aspect-video');
    if (videoWrapper) {
        if (mentor.introduction_video) {
            const videoId = getYouTubeId(mentor.introduction_video);
            if (videoId) {
                videoWrapper.innerHTML = `
                    <iframe class="w-full h-full rounded-2xl" 
                        src="https://www.youtube.com/embed/${videoId}?autoplay=0&rel=0" 
                        frameborder="0" 
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                        allowfullscreen>
                    </iframe>
                `;
            } else {
                videoWrapper.innerHTML = `
                    <video class="w-full h-full rounded-2xl" controls>
                        <source src="${mentor.introduction_video}" type="video/mp4">
                        Your browser does not support the video tag.
                    </video>
                `;
            }
        } else {
            videoWrapper.innerHTML = `
                <div class="w-full h-full flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-800 rounded-2xl">
                    <span class="material-symbols-outlined text-4xl text-slate-400 mb-2">videocam_off</span>
                    <p class="text-sm text-slate-500 font-medium">Introduction video not available</p>
                </div>
            `;
        }
    }

    // Expertise Tags - Look for the expertise section by finding the section with "psychology" text
    const expertiseSection = Array.from(document.querySelectorAll('section')).find(section => 
        section.textContent.includes('Expertise')
    );
    if (expertiseSection) {
        const expertiseContainer = expertiseSection.querySelector('.flex.flex-wrap.gap-2');
        if (expertiseContainer) {
            const tags = mentor.expertise || [];
            if (tags.length > 0) {
                expertiseContainer.innerHTML = tags.map(tag => `
                    <span class="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm font-medium transition-colors hover:bg-primary/10 hover:text-primary cursor-default">${tag}</span>
                `).join('');
            } else {
                expertiseContainer.innerHTML = '<p class="text-sm text-slate-400">No expertise areas listed.</p>';
            }
        }
    }

    // Stats
    const statsValues = document.querySelectorAll('aside .font-bold');
    if (statsValues.length >= 3) {
        statsValues[0].textContent = `${mentor.total_sessions || 0}+`;
        statsValues[1].textContent = `${mentor.avg_response_time || 0} hours`;
        statsValues[2].textContent = mentor.teaching_experience || mentor.experience || '0+ Years';
    }

    // Mentorship Style (Meeting Types)
    const allCards = document.querySelectorAll('div.p-4');
    const onlineCard = Array.from(allCards).find(card => 
        card.querySelector('.material-symbols-outlined')?.textContent.includes('videocam') ||
        card.textContent.includes('Online')
    );
    const inPersonCard = Array.from(allCards).find(card => 
        card.querySelector('.material-symbols-outlined')?.textContent.includes('location_on') ||
        card.textContent.includes('In-Person')
    );
    
    if (onlineCard && inPersonCard) {
        const types = mentor.meeting_types || { online: true, inPerson: false };
        onlineCard.style.display = types.online ? 'block' : 'none';
        inPersonCard.style.display = types.inPerson ? 'block' : 'none';
    }

    // Reviews Rendering
    const reviewsSection = document.getElementById('reviews-section');
    const reviewsContainer = document.getElementById('reviews-container');
    if (reviewsSection && reviewsContainer) {
        reviewsSection.classList.remove('hidden');
        const reviews = mentor.reviews || [];
        if (reviews.length > 0) {
            reviewsContainer.innerHTML = reviews.map(rev => `
                <div class="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
                    <div class="flex items-center gap-3 mb-4">
                        <img src="${rev.student?.avatar_url || '../../../assets/images/default-avatar.png'}" class="w-10 h-10 rounded-full object-cover">
                        <div>
                            <h4 class="text-sm font-bold text-slate-900 dark:text-white">${rev.student?.full_name || 'Anonymous Student'}</h4>
                            <div class="flex text-orange-400">
                                ${Array(5).fill(0).map((_, i) => `<span class="material-symbols-outlined text-xs ${i < rev.rating ? 'fill-1' : ''}">star</span>`).join('')}
                            </div>
                        </div>
                    </div>
                    <p class="text-sm text-slate-500 italic">"${rev.comment}"</p>
                </div>
            `).join('');
        } else {
            reviewsContainer.innerHTML = `
                <div class="col-span-full py-12 text-center bg-slate-50 dark:bg-slate-800/50 rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-700">
                    <span class="material-symbols-outlined text-4xl text-slate-300 dark:text-slate-600 mb-2">rate_review</span>
                    <p class="text-slate-500 dark:text-slate-400">No reviews yet. Be the first to share your experience!</p>
                </div>
            `;
        }
    }

    // Review Button & Modal Logic
    const addReviewBtn = document.getElementById('add-review-btn');
    const modal = document.getElementById('review-modal');
    const modalContent = document.getElementById('review-modal-content');
    const closeModalBtn = document.getElementById('close-review-modal');
    const submitReviewBtn = document.getElementById('submit-review-btn');
    const starBtns = document.querySelectorAll('.star-btn');
    const starText = document.getElementById('star-rating-text');
    let currentRating = 0;

    if (addReviewBtn && modal) {
        addReviewBtn.onclick = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                alert("Please log in to leave a review.");
                // Optional: redirect to login
                return;
            }
            
            // Don't allow mentors to review themselves
            if (user.id === mentor.instructor_id) {
                alert("You cannot review your own profile.");
                return;
            }

            document.getElementById('review-mentor-name').textContent = mentor.full_name;
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            setTimeout(() => {
                modalContent.classList.remove('scale-95', 'opacity-0');
                modalContent.classList.add('scale-100', 'opacity-100');
            }, 10);
        };
    }

    const closeReviewModal = () => {
        modalContent.classList.remove('scale-100', 'opacity-100');
        modalContent.classList.add('scale-95', 'opacity-0');
        setTimeout(() => {
            modal.classList.remove('flex');
            modal.classList.add('hidden');
        }, 300);
    };

    if (closeModalBtn) closeModalBtn.onclick = closeReviewModal;

    starBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            currentRating = parseInt(btn.dataset.value);
            updateStarUI(currentRating);
        });
        btn.addEventListener('mouseenter', () => updateStarUI(parseInt(btn.dataset.value), true));
        btn.addEventListener('mouseleave', () => updateStarUI(currentRating));
    });

    function updateStarUI(rating, isHover = false) {
        starBtns.forEach((btn, i) => {
            const star = btn.querySelector('span');
            if (i < rating) {
                star.classList.add('fill-1');
                star.classList.remove('text-slate-300');
                star.classList.add('text-orange-400');
            } else {
                star.classList.remove('fill-1');
                star.classList.add('text-slate-300');
                star.classList.remove('text-orange-400');
            }
        });
        if (!isHover) {
            const texts = ["Select a rating", "Poor", "Fair", "Good", "Very Good", "Excellent"];
            starText.textContent = texts[rating] || "Select a rating";
        }
    }

    if (submitReviewBtn) {
        submitReviewBtn.onclick = async () => {
            const comment = document.getElementById('review-comment').value.trim();
            if (currentRating === 0) return alert("Please select a rating.");
            if (!comment) return alert("Please leave a comment.");

            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return alert("You must be logged in.");

            try {
                submitReviewBtn.disabled = true;
                submitReviewBtn.innerHTML = '<span class="material-symbols-outlined animate-spin text-lg">sync</span> Submitting...';

                await MentorService.submitReview(mentor.instructor_id, user.id, currentRating, comment);
                
                alert("Review submitted successfully!");
                closeReviewModal();
                
                // Refresh data to show new review and update average
                const updatedMentor = await MentorService.getMentorById(mentor.instructor_id);
                renderProfile(updatedMentor);
            } catch (err) {
                console.error(err);
                alert("Failed to submit review: " + err.message);
            } finally {
                submitReviewBtn.disabled = false;
                submitReviewBtn.innerHTML = '<span>Submit Review</span><span class="material-symbols-outlined">send</span>';
            }
        };
    }
}

function getYouTubeId(url) {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

document.addEventListener('DOMContentLoaded', initMentorProfile);
