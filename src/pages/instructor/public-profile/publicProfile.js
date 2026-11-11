import { supabase } from '/src/services/supabaseClient.js';
import { MentorService } from '/src/services/mentorService.js';
import { resolveProfileAvatar, resolveCourseThumbnail } from '/src/services/r2ImageUpload.js';

let instructorId = null;

async function initPage() {
    const urlParams = new URLSearchParams(window.location.search);
    instructorId = urlParams.get('id');

    if (!instructorId) {
        document.body.innerHTML = `<div class="min-h-screen flex items-center justify-center">
            <div class="text-center">
                <h1 class="text-2xl font-bold mb-2">Instructor Not Found</h1>
                <p class="text-slate-500">Please provide a valid instructor ID.</p>
                <a href="/" class="text-primary font-bold mt-4 inline-block">Back to Home</a>
            </div>
        </div>`;
        return;
    }

    try {
        await Promise.all([
            loadInstructorProfile(),
            loadInstructorCourses(),
            loadStudentEnrollments()
        ]);
    } catch (err) {
        console.error("Error loading public profile:", err);
    }
}

async function loadInstructorProfile() {
    try {
        const mentorData = await MentorService.getMentorById(instructorId);
        if (!mentorData) return;

        // Check if Mentor is boosted
        try {
            const { BoostService } = await import('../../services/boostService.js');
            const [mentorBoostIds, mentorBanners] = await Promise.all([
                BoostService.getBoostedEntityIds('mentor'),
                BoostService.getActivePromoBanners('mentor')
            ]);
            
            const isMentorBoosted = mentorBoostIds.includes(instructorId);
            const mentorBannerText = mentorBanners.find(b => b.entity_id === instructorId)?.banner_text;
            
            const headerActions = document.querySelector('#instructor-name').parentElement;
            if (isMentorBoosted) {
                const badge = document.createElement('div');
                badge.className = "flex items-center gap-1 px-3 py-1 bg-gradient-to-r from-amber-200 to-amber-100 text-amber-800 text-[10px] font-black uppercase tracking-wider rounded-full shadow-sm border border-amber-300 backdrop-blur-md";
                badge.innerHTML = `<span class="material-symbols-outlined text-[12px]" style="font-variation-settings: 'FILL' 1">rocket_launch</span> Sponsored Profile`;
                headerActions.appendChild(badge);
            }
            if (mentorBannerText) {
                const bannerDiv = document.createElement('div');
                bannerDiv.className = "w-full md:w-fit mt-3 px-4 py-2 bg-gradient-to-r from-purple-500/20 to-indigo-500/20 text-white rounded-xl border border-white/20 backdrop-blur-sm flex items-start gap-2 shadow-sm animate-pulse-slow";
                bannerDiv.innerHTML = `<span class="material-symbols-outlined text-purple-300 text-sm mt-0.5 shrink-0 animate-bounce-slow">campaign</span><p class="text-sm font-bold text-white leading-snug">${mentorBannerText}</p>`;
                headerActions.parentElement.insertBefore(bannerDiv, headerActions.nextSibling);
            }
        } catch (e) {
            console.warn("Failed to fetch mentor boost data:", e);
        }

        // Header Info
        document.getElementById('instructor-name').textContent = mentorData.full_name;
        if (mentorData.serial_id) {
            const mtrRef = document.createElement('span');
            mtrRef.className = "text-slate-400 dark:text-slate-300 text-[11px] font-black uppercase tracking-[0.1em] font-mono block md:inline-block md:ml-3 mt-2 md:mt-0";
            mtrRef.textContent = `MTR-${mentorData.serial_id}`;
            document.getElementById('instructor-name').appendChild(mtrRef);
        }
        document.getElementById('instructor-headline').textContent = mentorData.headline || '';
        document.getElementById('instructor-rating').textContent = mentorData.rating || '0.0';
        document.getElementById('instructor-reviews').textContent = `(${mentorData.review_count} reviews)`;
        document.getElementById('instructor-location').textContent = mentorData.country ? `${mentorData.city ? mentorData.city + ', ' : ''}${mentorData.country}` : 'Global';
        document.getElementById('instructor-experience').textContent = `${mentorData.experience || 0}+ Years Experience`;
        
        const avatarUrl = await resolveProfileAvatar(mentorData);
        if (avatarUrl) document.getElementById('instructor-avatar').src = avatarUrl;

        // Bio
        document.getElementById('instructor-bio').innerHTML = mentorData.short_bio ? `<p>${mentorData.short_bio.replace(/\n/g, '</p><p>')}</p>` : 'No bio available.';

        // Expertise Tags
        const expertiseContainer = document.getElementById('expertise-container');
        expertiseContainer.innerHTML = '';
        if (mentorData.expertise && mentorData.expertise.length > 0) {
            mentorData.expertise.forEach(skill => {
                const span = document.createElement('span');
                span.className = "px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-300 transition-colors";
                span.textContent = skill;
                expertiseContainer.appendChild(span);
            });
        } else {
            expertiseContainer.innerHTML = '<p class="text-slate-400 text-sm italic">No specific expertise listed.</p>';
        }

        // Social Links
        // We need to fetch the raw profile for social_links as getMentorById might not include it (it's in profiles)
        const { data: profile } = await supabase.from('profiles').select('social_links').eq('id', instructorId).single();
        renderSocialLinks(profile?.social_links);

        // Sidebar Booking Info
        document.getElementById('sidebar-price').textContent = `$${mentorData.hourly_rate?.toFixed(2)} /hr`;
        
        // Simple availability summary
        if (mentorData.availability && mentorData.availability.length > 0) {
            const count = mentorData.availability.filter(s => s.is_enabled).length;
            document.getElementById('sidebar-availability').textContent = `${count} slots available this week`;
        } else {
            document.getElementById('sidebar-availability').textContent = 'Check booking for slots';
        }

        // Video (Hero Trigger)
        if (mentorData.introduction_video) {
            document.getElementById('hero-video-trigger').classList.remove('hidden');
            window.instructorIntroVideo = mentorData.introduction_video;
        }

        // Book Now Button
        document.getElementById('book-now-btn').onclick = () => {
            window.location.href = `/src/pages/mentorship/mentor-profile/index.html?id=${instructorId}`;
        };

    } catch (err) {
        console.error("Error loading profile data:", err);
    }
}

function renderSocialLinks(links) {
    const container = document.getElementById('social-links-container');
    container.innerHTML = '';
    
    if (!links || Object.keys(links).length === 0) return;
 
    const socialIcons = {
        github: { icon: '<svg class="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.042-1.416-4.042-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>', label: 'GitHub' },
        linkedin: { icon: '<svg class="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M4.98 3.5c0 1.381-1.11 2.5-2.48 2.5s-2.48-1.119-2.48-2.5c0-1.38 1.11-2.5 2.48-2.5s2.48 1.12 2.48 2.5zm.02 4.5h-5v16h5v-16zm7.982 0h-4.968v16h4.969v-8.399c0-4.67 6.029-5.052 6.029 0v8.399h4.988v-10.131c0-7.88-8.922-7.593-11.018-3.714v-2.155z"/></svg>', label: 'LinkedIn' },
        twitter: { icon: '<svg class="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.045 4.126H5.078z"/></svg>', label: 'X' },
        facebook: { icon: '<svg class="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>', label: 'Facebook' },
        website: { icon: '<span class="material-symbols-outlined text-lg">language</span>', label: 'Website' }
    };
 
    Object.entries(links).forEach(([key, url]) => {
        if (url && socialIcons[key]) {
            const a = document.createElement('a');
            a.href = url;
            a.target = "_blank";
            a.className = "w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white hover:bg-primary transition-all";
            a.title = socialIcons[key].label;
            a.innerHTML = socialIcons[key].icon;
            container.appendChild(a);
        }
    });
}
 
// Modal functions
window.openVideoModal = function() {
    if (!window.instructorIntroVideo) return;
    const modal = document.getElementById('video-modal');
    const iframe = document.getElementById('video-iframe');
    
    // Convert YouTube URL to embed format if needed
    let videoUrl = window.instructorIntroVideo;
    if (videoUrl.includes('youtube.com/watch?v=')) {
        videoUrl = videoUrl.replace('watch?v=', 'embed/');
    } else if (videoUrl.includes('youtu.be/')) {
        videoUrl = videoUrl.replace('youtu.be/', 'youtube.com/embed/');
    }
    
    iframe.src = videoUrl + (videoUrl.includes('?') ? '&' : '?') + 'autoplay=1';
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
};
 
window.closeVideoModal = function() {
    const modal = document.getElementById('video-modal');
    const iframe = document.getElementById('video-iframe');
    iframe.src = '';
    modal.classList.add('hidden');
    document.body.style.overflow = 'auto';
};

async function loadInstructorCourses() {
    try {
        const { data: courses, error } = await supabase
            .from('courses')
            .select('*')
            .eq('instructor_id', instructorId)
            .eq('status', 'published')
            .eq('is_latest_published', true)
            // Private courses are unlisted: show them only through their direct share link.
            // Keep NULL visibility values public for older courses that predate this flag.
            .or('is_public.eq.true,is_public.is.null');

        if (error) throw error;

        // Fetch boost and banner data to highlight sponsored content on the public profile
        let boostedIds = [];
        let banners = [];
        let bannerMap = {};
        try {
            const { BoostService } = await import('../../services/boostService.js');
            [boostedIds, banners] = await Promise.all([
                BoostService.getBoostedEntityIds('course'),
                BoostService.getActivePromoBanners('course')
            ]);
            banners.forEach(b => bannerMap[b.entity_id] = b.banner_text);
        } catch (e) {
            console.warn("Failed to fetch boost data for public profile:", e);
        }

        const grid = document.getElementById('courses-grid');
        const countEl = document.getElementById('courses-count');
        
        countEl.textContent = `${courses.length} Course${courses.length === 1 ? '' : 's'}`;
        
        if (courses.length === 0) {
            grid.innerHTML = `<div class="col-span-full py-12 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl">
                <span class="material-symbols-outlined text-4xl text-slate-300 mb-3">auto_stories</span>
                <p class="text-slate-500">This instructor hasn't published any courses yet.</p>
            </div>`;
            return;
        }

        // Use the same source of truth as course details: actual student reviews.
        // Fetch all ratings in one query so course cards do not show a nonexistent
        // courses.rating field or issue one request per course.
        const courseRatings = new Map();
        try {
            const { data: reviews, error: reviewsError } = await supabase
                .from('course_reviews')
                .select('course_id, rating')
                .in('course_id', courses.map(course => course.id));

            if (reviewsError) throw reviewsError;

            (reviews || []).forEach(review => {
                const stats = courseRatings.get(review.course_id) || { total: 0, sum: 0 };
                stats.total += 1;
                stats.sum += Number(review.rating) || 0;
                courseRatings.set(review.course_id, stats);
            });
        } catch (reviewError) {
            // A ratings lookup failure should not prevent public course cards loading.
            console.warn("Failed to load course ratings for public profile:", reviewError);
        }

        const urlParams = new URLSearchParams(window.location.search);
        const focusCourseId = urlParams.get('focusCourse');

        const thumbnailUrls = await Promise.all(courses.map(course => resolveCourseThumbnail(course)));
        grid.innerHTML = courses.map((course, courseIndex) => {
            const familyId = course.root_course_id || course.id;
            const isBoosted = boostedIds.includes(familyId);
            const bannerText = bannerMap[familyId];
            const ratingStats = courseRatings.get(course.id);
            const courseRating = ratingStats?.total
                ? (ratingStats.sum / ratingStats.total).toFixed(1)
                : '0.0';
            
            const isFocused = focusCourseId === familyId;
            const borderClass = isBoosted ? 'border-amber-200 dark:border-amber-900/50' : 'border-slate-100 dark:border-slate-800';
            const focusClass = isFocused ? 'ring-4 ring-amber-400 ring-offset-2 dark:ring-offset-slate-900 transform scale-[1.02]' : '';

            return `
            <div onclick="window.location.href='/src/pages/marketplace/course-details/index.html?id=${course.id}'" 
                 class="group bg-white dark:bg-slate-900 rounded-3xl border ${borderClass} shadow-sm overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer ${focusClass} relative">
                
                ${isBoosted ? `
                <div class="absolute -top-10 -right-10 w-24 h-24 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full blur-xl opacity-20 pointer-events-none"></div>
                <div class="absolute top-3 right-3 z-10 px-2 py-1 bg-gradient-to-r from-amber-200 to-amber-100 text-amber-800 text-[9px] font-black uppercase tracking-wider rounded-lg shadow-sm border border-amber-300 flex items-center gap-1 backdrop-blur-md">
                    <span class="material-symbols-outlined text-[10px]" style="font-variation-settings: 'FILL' 1">stars</span>
                    Sponsored
                </div>
                ` : ''}

                <div class="aspect-video relative overflow-hidden">
                    <img src="${thumbnailUrls[courseIndex] || 'https://images.unsplash.com/photo-1542744094-24638eff58bb?w=800'}" 
                         class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                    <div class="absolute inset-0 bg-gradient-to-t from-slate-900/80 to-transparent flex items-end p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span class="text-white text-xs font-bold uppercase tracking-wider">Learn More</span>
                    </div>
                </div>
                <div class="p-6">
                    <div class="flex items-center gap-2 mb-3">
                        <span class="px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-black uppercase rounded">${course.category || 'Course'}</span>
                    </div>
                    ${bannerText ? `<div class="mb-2 px-2.5 py-1.5 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/40 dark:to-purple-900/40 border border-indigo-100 dark:border-indigo-800 rounded flex items-start gap-2 shadow-sm animate-pulse-slow">
                        <span class="material-symbols-outlined text-indigo-500 text-sm mt-0.5 shrink-0 animate-bounce-slow">campaign</span>
                        <p class="text-xs font-bold text-indigo-700 dark:text-indigo-300 leading-snug">${bannerText}</p>
                    </div>` : ''}
                    <h3 class="font-bold text-slate-900 dark:text-white mb-2 line-clamp-2">${course.title}</h3>
                    <div class="flex justify-between items-center mt-6 pt-4 border-t border-slate-50 dark:border-slate-800">
                        <div class="flex items-center gap-1.5">
                            <span class="material-symbols-outlined text-orange-400 text-sm" style="font-variation-settings: 'FILL' 1">star</span>
                            <span class="text-sm font-bold">${courseRating}</span>
                        </div>
                        <span class="font-black text-primary">${course.price > 0 ? '$' + course.price : 'FREE'}</span>
                    </div>
                </div>
            </div>
            `;
        }).join('');

    } catch (err) {
        console.error("Error loading courses:", err);
        document.getElementById('courses-grid').innerHTML = '<p class="text-red-500">Failed to load courses.</p>';
    }
}

async function loadStudentEnrollments() {
    try {
        const { data: enrollments, error } = await supabase
            .from('enrollments')
            .select('*, courses(*)')
            .eq('student_id', instructorId);
            
        if (error) throw error;
        
        const section = document.getElementById('enrolled-courses-section');
        const grid = document.getElementById('enrolled-courses-grid');
        const countEl = document.getElementById('enrolled-courses-count');
        
        if (!enrollments || enrollments.length === 0) {
            section.classList.add('hidden');
            return;
        }
        
        section.classList.remove('hidden');
        countEl.textContent = `${enrollments.length} Course${enrollments.length === 1 ? '' : 's'}`;
        
        // Fetch matching payments for these enrollments
        const { data: paymentsInfo } = await supabase
            .from('payments')
            .select('*')
            .eq('student_id', instructorId)
            .in('payment_status', ['paid', 'SUCCESS'])
            .not('course_id', 'is', null);

        const paymentMap = {};
        if (paymentsInfo) {
            paymentsInfo.forEach(p => {
                if (p.course_id && p.serial_id) {
                    paymentMap[p.course_id] = p;
                }
            });
        }
        
        window._studentPayments = paymentMap;

        grid.innerHTML = enrollments.map(enr => {
            const course = enr.courses;
            if (!course) return '';
            const payData = paymentMap[course.id];
            
            return `
            <div onclick="window.showPaymentReceipt('${course.id}')" 
                 class="group bg-white dark:bg-slate-900 rounded-3xl border border-indigo-100 dark:border-indigo-900/50 shadow-sm overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer">
                <div class="aspect-video relative overflow-hidden">
                    <img src="${course.thumbnail_url || 'https://images.unsplash.com/photo-1542744094-24638eff58bb?w=800'}" 
                         class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                    <div class="absolute inset-0 bg-gradient-to-t from-slate-900/80 to-transparent flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <span class="material-symbols-outlined text-white text-5xl mb-2">receipt_long</span>
                        <span class="text-white text-xs font-bold uppercase tracking-wider">View Payment Receipt</span>
                    </div>
                </div>
                <div class="p-6">
                    <div class="flex items-center flex-wrap gap-2 mb-3">
                        <span class="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 text-[10px] font-black uppercase rounded font-mono">CRS-${course.serial_id || '---'}</span>
                        ${payData ? `<span class="px-2 py-0.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 text-[10px] font-black uppercase rounded font-mono">PAY-${payData.serial_id}</span>` : ''}
                    </div>
                    <h3 class="font-bold text-slate-900 dark:text-white line-clamp-2">${course.title}</h3>
                </div>
            </div>
            `;
        }).join('');
        
        // Check URL for direct receipt trigger
        const urlParams = new URLSearchParams(window.location.search);
        const payIdParam = urlParams.get('pay_id');
        const courseIdParam = urlParams.get('course_id');
        if (payIdParam && courseIdParam) {
            setTimeout(() => window.showPaymentReceipt(courseIdParam), 500);
        }

    } catch (err) {
        console.error("Error loading enrollments:", err);
    }
}

window.showPaymentReceipt = function(courseId) {
    if (!window._studentPayments || !window._studentPayments[courseId]) {
        console.warn("No payment data found for course", courseId);
        return;
    }
    
    const payData = window._studentPayments[courseId];
    const studentName = document.getElementById('instructor-name').textContent || 'Student';
    
    document.getElementById('receipt-date').textContent = new Date(payData.created_at).toLocaleString();
    document.getElementById('receipt-pay-id').textContent = `PAY-${payData.serial_id}`;
    document.getElementById('receipt-amount').textContent = `$${payData.amount ? payData.amount.toFixed(2) : '0.00'}`;
    document.getElementById('receipt-student').textContent = studentName;
    
    // Find course title
    const courseEl = document.querySelector(`div[onclick="window.showPaymentReceipt('${courseId}')"] h3`);
    document.getElementById('receipt-item-name').textContent = courseEl ? courseEl.textContent : 'Course Enrollment';
    
    document.getElementById('payment-receipt-modal').classList.remove('hidden');
};

document.addEventListener('DOMContentLoaded', initPage);
