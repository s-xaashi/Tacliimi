import { MentorService } from '../../../services/mentorService.js';

async function initMarketplace() {
    const grid = document.querySelector('.grid.grid-cols-1.md\\:grid-cols-2.xl\\:grid-cols-3');
    if (!grid) return;

    try {
        // Show loading state
        grid.innerHTML = `
            <div class="col-span-full py-20 text-center">
                <div class="w-10 h-10 border-4 border-slate-200 border-t-primary rounded-full animate-spin mx-auto"></div>
                <p class="mt-4 text-slate-500 font-medium">Finding best mentors for you...</p>
            </div>
        `;

        const mentors = await MentorService.getActiveMentors();

        if (mentors.length === 0) {
            grid.innerHTML = `
                <div class="col-span-full py-20 text-center bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
                    <span class="material-symbols-outlined text-6xl text-slate-300 mb-4">person_off</span>
                    <h3 class="text-xl font-bold mb-2">No mentors found</h3>
                    <p class="text-slate-500">We couldn't find any public mentors at the moment. Check back later!</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = ''; // Clear loading

        mentors.forEach(mentor => {
            const card = document.createElement('div');
            card.className = 'group bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-5 hover:shadow-xl hover:shadow-slate-200/50 dark:hover:shadow-none transition-all duration-300';
            
            // Expertise tags
            const expertiseTags = mentor.expertise?.slice(0, 2).map(exp => 
                `<span class="px-2.5 py-1 rounded-lg bg-brand-purple/5 text-brand-purple text-[10px] font-bold uppercase tracking-wider">${exp}</span>`
            ).join('') || '';

            card.innerHTML = `
                <div class="flex items-start justify-between mb-4">
                    <div class="relative">
                        <img src="${mentor.avatar_url || '/assets/images/default-avatar.png'}" 
                             alt="${mentor.full_name}" 
                             class="w-16 h-16 rounded-2xl object-cover ring-4 ring-slate-50 dark:ring-slate-800">
                        <div class="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 border-4 border-white dark:border-slate-900 rounded-full"></div>
                    </div>
                    <div class="flex flex-col items-end">
                        <div class="flex items-center gap-1 text-amber-500 mb-1">
                            <span class="material-symbols-outlined text-[18px] fill-current">star</span>
                            <span class="text-sm font-bold">${mentor.rating || '0.0'}</span>
                            <span class="text-slate-400 text-xs font-medium">(${mentor.review_count || 0})</span>
                        </div>
                        <div class="text-brand-purple">
                            <span class="text-lg font-black">$${mentor.hourly_rate || 0}</span>
                            <span class="text-[10px] font-bold uppercase tracking-tighter">/ hr</span>
                        </div>
                    </div>
                </div>

                <div class="mb-4">
                    <h3 class="text-base font-bold text-slate-900 dark:text-white group-hover:text-brand-purple transition-colors line-clamp-1">
                        ${mentor.full_name}
                    </h3>
                    <p class="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                        ${mentor.short_bio || 'Expert mentor ready to guide you.'}
                    </p>
                </div>

                <div class="flex flex-wrap gap-2 mb-4">
                    ${expertiseTags}
                    ${mentor.expertise?.length > 2 ? `<span class="text-[10px] font-bold text-slate-400 self-center">+${mentor.expertise.length - 2} more</span>` : ''}
                </div>

                <div class="grid grid-cols-2 gap-3 mb-5 py-4 border-y border-slate-50 dark:border-slate-800">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-lg bg-slate-50 dark:bg-slate-800 flex items-center justify-center">
                            <span class="material-symbols-outlined text-slate-400 text-[18px]">history</span>
                        </div>
                        <div>
                            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Sessions</p>
                            <p class="text-xs font-bold text-slate-700 dark:text-slate-200">${mentor.total_sessions || 0}</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-lg bg-slate-50 dark:bg-slate-800 flex items-center justify-center">
                            <span class="material-symbols-outlined text-slate-400 text-[18px]">bolt</span>
                        </div>
                        <div>
                            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Response</p>
                            <p class="text-xs font-bold text-slate-700 dark:text-slate-200">${mentor.avg_response_time || 0}h</p>
                        </div>
                    </div>
                </div>

                <a href="/src/pages/mentorship/mentor-profile/index.html?id=${mentor.instructor_id}" 
                   class="block w-full py-3 rounded-xl bg-slate-900 dark:bg-brand-purple text-white text-center text-sm font-bold hover:bg-brand-purple dark:hover:bg-brand-purple/90 transition-all shadow-lg shadow-slate-200 dark:shadow-none">
                    View Profile
                </a>
            `;
            grid.appendChild(card);
        });

    } catch (err) {
        console.error("Error loading marketplace:", err);
        // Display technical error for easier debugging
        grid.innerHTML = `
            <div class="col-span-full py-20 text-center text-red-500">
                <span class="material-symbols-outlined text-6xl mb-4">error</span>
                <h3 class="text-xl font-bold mb-2">Oops! Something went wrong</h3>
                <p>We couldn't load the mentors. Please try again later.</p>
                <p class="text-[10px] mt-4 opacity-50 font-mono">${err.message || 'Unknown error'}</p>
            </div>
        `;
    }
}

document.addEventListener('DOMContentLoaded', initMarketplace);
