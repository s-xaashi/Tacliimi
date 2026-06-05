import { supabase } from '/src/services/supabaseClient.js';
import { AuthService } from '/src/services/authService.js';

let currentUserSession = null;
let currentProfile = null;

// Routing for tabs
window.switchDashboardTab = function (tabId) {
    const tabs = ['my-courses', 'my-mentors', 'wishlist'];
    tabs.forEach(tab => {
        const btn = document.getElementById('tab-' + tab);
        if (!btn) return;
        if (tab === tabId) {
            btn.className = "pb-4 text-primary font-semibold border-b-2 border-primary flex items-center gap-2 transition-colors";
        } else {
            btn.className = "pb-4 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-medium flex items-center gap-2 border-b-2 border-transparent transition-colors";
        }
    });

    tabs.forEach(tab => {
        const content = document.getElementById('content-' + tab);
        if (!content) return;
        if (tab === tabId) {
            content.classList.remove('hidden');
        } else {
            content.classList.add('hidden');
        }
    });
};

async function initDashboard() {
    currentUserSession = await AuthService.getSession();
    if (!currentUserSession) {
        window.location.href = '/src/pages/auth/login-select/index.html';
        return;
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUserSession.user.id)
        .single();
    
    currentProfile = profile;
    
    if (profile) {
        const displayNames = document.querySelectorAll('.user-display-name');
        displayNames.forEach(el => el.textContent = profile.full_name || 'Student Name');
    }

    await loadMyCourses();
    await loadWishlist();
    await loadMentors();
}

async function loadMyCourses() {
    const { data: enrollments, error } = await supabase
        .from('enrollments')
        .select('*, courses(*, categories(*), instructor:profiles(*))')
        .eq('student_id', currentUserSession.user.id);
    
    const continueSection = document.getElementById('continue-learning-section');
    const newStudentSection = document.getElementById('new-student-section');
    const enrolledCoursesGrid = document.getElementById('enrolled-courses-grid');
    const welcomeMsg = document.getElementById('dashboard-welcome-msg');
    const emptyState = document.getElementById('global-courses-empty-state');
    
    if (!enrollments || enrollments.length === 0) {
        continueSection.classList.add('hidden');
        newStudentSection.classList.remove('hidden');
        enrolledCoursesGrid.classList.add('hidden');
        emptyState.classList.remove('hidden');
        if (welcomeMsg) welcomeMsg.textContent = "Start your learning journey by exploring our beginner-friendly courses.";
        
        // Fetch and show beginner courses in new student section
        await loadBeginnerCourses();
    } else {
        newStudentSection.classList.add('hidden');
        continueSection.classList.remove('hidden');
        enrolledCoursesGrid.classList.remove('hidden');
        emptyState.classList.add('hidden');

        // Sort to find latest enrolled or progressed course (fallback to enrolled_at)
        const sortedEnrollments = [...enrollments].sort((a,b) => {
            const dateA = new Date(a.updated_at || a.enrolled_at);
            const dateB = new Date(b.updated_at || b.enrolled_at);
            return dateB - dateA;
        });
        
        const latestEnr = sortedEnrollments[0];
        const latestCourse = latestEnr.courses;
        
        if (latestCourse && continueSection) {
            const instructorName = latestCourse.instructor ? latestCourse.instructor.full_name : 'Instructor';
            continueSection.innerHTML = `
                <div class="flex flex-col md:flex-row items-center gap-8 p-8 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
                    <div class="absolute top-0 right-0 p-4">
                        <span class="px-3 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest">Recently Accessed</span>
                    </div>
                    <div class="w-full md:w-72 aspect-video rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0 shadow-inner">
                        ${latestCourse.thumbnail_url 
                            ? `<img src="${latestCourse.thumbnail_url}" alt="${latestCourse.title}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />`
                            : `<div class="w-full h-full flex items-center justify-center"><span class="material-symbols-outlined text-slate-300 dark:text-slate-700 text-5xl">image</span></div>`
                        }
                    </div>
                    <div class="flex-1 space-y-4 w-full">
                        <div>
                            <h2 class="text-2xl font-bold dark:text-white line-clamp-1 mb-1">${latestCourse.title}</h2>
                            <p class="text-slate-500 text-sm flex items-center gap-2">
                                <span class="material-symbols-outlined text-sm">person</span> ${instructorName}
                            </p>
                        </div>
                        <div class="space-y-2">
                            <div class="flex justify-between items-center text-sm font-medium">
                                <span class="text-slate-600 dark:text-slate-400">Course Progress</span>
                                <span class="text-primary">${latestEnr.progress_percentage || 0}%</span>
                            </div>
                            <div class="h-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden p-0.5 shadow-inner">
                                <div class="h-full bg-gradient-to-r from-primary to-purple-500 rounded-full progress-glow transition-all duration-1000" style="width: ${latestEnr.progress_percentage || 0}%"></div>
                            </div>
                        </div>
                        <div class="flex items-center gap-4 pt-2">
                            <button onclick="window.location.href='/src/pages/learning/learning-interface/index.html?course=${encodeURIComponent(latestCourse.id)}'"
                                class="px-8 py-3 bg-primary text-white font-bold rounded-xl hover:bg-purple-600 transition-all shadow-lg shadow-primary/20 flex items-center gap-2 active:scale-95">
                                <span class="material-symbols-outlined">play_circle</span> Continue Learning
                            </button>
                        </div>
                    </div>
                </div>
            `;
            if (welcomeMsg) welcomeMsg.textContent = `You're doing great! You've completed ${latestEnr.progress_percentage || 0}% of "${latestCourse.title}".`;
        }

        // Render full grid
        let html = '';
        enrollments.forEach(enr => {
            const course = enr.courses;
            if(!course) return;
            const instrName = course.instructor ? course.instructor.full_name : 'Instructor';
            const category = course.categories ? course.categories.name : 'Course';
            
            html += `
            <div class="flex flex-col group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden hover:shadow-xl transition-all duration-300 cursor-pointer h-full" onclick="window.location.href='/src/pages/learning/learning-interface/index.html?course=${encodeURIComponent(course.id)}'">
                <div class="aspect-video relative overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0">
                    <img src="${course.thumbnail_url || 'https://placehold.co/600x400'}" alt="${course.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    <div class="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span class="material-symbols-outlined text-white text-5xl">play_circle</span>
                    </div>
                </div>
                <div class="p-5 flex flex-col flex-1">
                    <div class="flex items-center gap-2 mb-3 shrink-0">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary">${category}</span>
                    </div>
                    <h4 class="font-bold text-slate-900 dark:text-white mb-4 line-clamp-2 min-h-[3rem] group-hover:text-primary transition-colors shrink-0">${course.title}</h4>
                    <div class="space-y-3 mt-auto shrink-0">
                        <div class="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                            <span>Your Progress</span>
                            <span class="font-bold">${enr.progress_percentage || 0}%</span>
                        </div>
                        <div class="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                            <div class="bg-primary h-full rounded-full transition-all duration-1000" style="width: ${enr.progress_percentage || 0}%"></div>
                        </div>
                    </div>
                </div>
            </div>
            `;
        });
        enrolledCoursesGrid.innerHTML = html;
    }
}

async function loadWishlist() {
    const { data: wishlisted, error } = await supabase
        .from('wishlist')
        .select('*, courses(*, instructor:profiles!courses_instructor_id_fkey(*), categories:course_categories!courses_category_id_fkey(*))')
        .eq('student_id', currentUserSession.user.id);

    const wishlistContainer = document.getElementById('wishlist-container');
    const wishlistEmptyState = document.getElementById('wishlist-empty-state');
    
    if (!wishlisted || wishlisted.length === 0) {
        wishlistContainer.innerHTML = '';
        wishlistContainer.appendChild(wishlistEmptyState);
    } else {
        wishlistContainer.innerHTML = '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-6"></div>';
        const grid = wishlistContainer.querySelector('.grid');
        
        wishlisted.forEach(w => {
            const course = w.courses;
            if(!course) return;
            const instructorName = course.instructor ? course.instructor.full_name : 'Instructor';
            const category = course.categories ? course.categories.name : 'Course';
            const price = Number(course.price) === 0 ? 'Free' : '$' + Number(course.price).toFixed(2);
            const ratingDisplay = '4.5';
            
            const html = `
                <div onclick="window.location.href='/src/pages/marketplace/course-details/index.html?id=${encodeURIComponent(course.id)}'"
                    class="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 group border border-slate-200 dark:border-slate-700 hover:border-primary/50 cursor-pointer flex flex-col relative">
                    <button onclick="event.stopPropagation(); window.removeFromWishlist('${course.id}');" 
                        class="absolute top-3 right-3 z-10 w-8 h-8 bg-white/90 dark:bg-slate-800/90 backdrop-blur-md rounded-full flex items-center justify-center text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 transition-all shadow-sm">
                        <span class="material-symbols-outlined text-[18px]">favorite</span>
                    </button>
                    <div class="relative aspect-video">
                        <img alt="${course.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" src="${course.thumbnail_url || 'https://placehold.co/600x400'}" />
                    </div>
                    <div class="p-5 flex flex-col flex-1">
                        <div class="text-xs text-primary font-bold uppercase tracking-widest mb-2">${category}</div>
                        <h3 class="font-bold text-slate-900 dark:text-white mb-2 line-clamp-2 leading-snug group-hover:text-primary transition-colors">${course.title}</h3>
                        <p class="text-sm text-slate-500 mb-4">${instructorName}</p>
                        <div class="flex items-center gap-1 mb-4 mt-auto">
                            <span class="font-bold text-sm text-yellow-500">${ratingDisplay}</span>
                            <div class="flex text-yellow-400">
                                <span class="material-symbols-outlined text-[14px]">star</span>
                            </div>
                            <span class="text-xs text-slate-400">(0)</span>
                        </div>
                        <div class="flex items-center justify-between border-t border-slate-100 dark:border-slate-700 pt-4 mt-2">
                            <span class="text-lg font-bold text-slate-900 dark:text-white">${price}</span>
                            <button onclick="event.stopPropagation(); window.enrollCourse('${course.id}');" 
                                class="px-4 py-2 bg-primary/10 text-primary hover:bg-primary font-medium hover:text-white rounded-lg transition-colors text-sm">
                                Enroll Now
                            </button>
                        </div>
                    </div>
                </div>
            `;
            grid.insertAdjacentHTML('beforeend', html);
        });
    }
}

async function loadMentors() {
    const { data: sessions, error } = await supabase
        .from('mentorship_sessions')
        .select('*, mentor:profiles!mentor_id(full_name, avatar_url)')
        .eq('student_id', currentUserSession.user.id);
        
    const mentorsContent = document.getElementById('content-my-mentors');
    if(sessions && sessions.length > 0) {
        mentorsContent.innerHTML = `<div class="p-10 text-center"><h3 class="text-2xl font-bold dark:text-white mb-2">You have ${sessions.length} sessions</h3></div>`;
    }
}

async function loadBeginnerCourses() {
    const { data: beginnerCourses, error } = await supabase
        .from('course_marketplace_view')
        .select('*')
        .eq('level', 'Beginner')
        .limit(3);

    const newStudentSection = document.getElementById('new-student-section');
    if (!beginnerCourses || beginnerCourses.length === 0) return;

    // Add a container for beginner courses if it doesn't exist
    let coursesContainer = document.getElementById('beginner-courses-recommendations');
    if (!coursesContainer) {
        const div = document.createElement('div');
        div.id = 'beginner-courses-recommendations';
        div.className = 'mt-12 grid grid-cols-1 md:grid-cols-3 gap-6';
        newStudentSection.appendChild(div);
        coursesContainer = div;
    }

    let html = '<div class="col-span-full border-b border-primary/20 pb-4 mb-4"><h3 class="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-purple-400">Popular Beginner Courses</h3></div>';
    
    beginnerCourses.forEach(course => {
        html += `
        <div onclick="window.location.href='/src/pages/marketplace/course-details/index.html?id=${encodeURIComponent(course.id)}'"
            class="flex flex-col group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden hover:shadow-xl transition-all duration-300 cursor-pointer h-full relative">
            <div class="aspect-video relative overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0">
                <img src="${course.thumbnail_url || 'https://placehold.co/600x400'}" alt="${course.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                <div class="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition-colors"></div>
            </div>
            <div class="p-5 flex flex-col flex-1">
                <div class="flex items-center gap-2 mb-3 shrink-0">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary">Beginner</span>
                </div>
                <h4 class="font-bold text-slate-900 dark:text-white mb-2 line-clamp-2 leading-snug group-hover:text-primary transition-colors flex-1">${course.title}</h4>
                <div class="flex items-center justify-between pt-4 mt-auto border-t border-slate-50 dark:border-slate-800/50">
                    <span class="font-bold text-slate-900 dark:text-white">${course.price_type === 'free' ? 'Free' : '$' + (course.price || 0).toFixed(2)}</span>
                    <button class="text-primary font-bold text-xs uppercase tracking-widest flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                        Detail <span class="material-symbols-outlined text-sm">arrow_forward</span>
                    </button>
                </div>
            </div>
        </div>
        `;
    });
    coursesContainer.innerHTML = html;
}

window.removeFromWishlist = async function(courseId) {
    await supabase.from('wishlist').delete().eq('course_id', courseId).eq('student_id', currentUserSession.user.id);
    loadWishlist();
};

window.enrollCourse = async function(courseId) {
    await supabase.from('enrollments').insert({ student_id: currentUserSession.user.id, course_id: courseId, progress_percentage: 0 });
    window.removeFromWishlist(courseId); // Remove from wishlist internally
    await loadMyCourses();
    window.location.href = '/src/pages/learning/learning-interface/index.html?course=' + encodeURIComponent(courseId);
};

document.addEventListener('DOMContentLoaded', initDashboard);
