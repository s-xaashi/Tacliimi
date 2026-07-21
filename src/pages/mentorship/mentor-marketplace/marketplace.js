import { MentorService } from '../../../services/mentorService.js';

let allMentors = [];
let expandedDomains = new Set(); // Track which domain groups are open
let activeFilters = {
    search: '',
    category: 'all',
    country: 'all',
    city: 'all'
};

async function initMarketplace() {
    const grid = document.getElementById('mentor-cards-grid');
    if (!grid) {
        console.error('[Marketplace] Grid element #mentor-cards-grid not found. Retrying in 250ms...');
        setTimeout(initMarketplace, 250);
        return;
    }

    try {
        grid.innerHTML = `
            <div class="col-span-full py-20 text-center">
                <div class="w-10 h-10 border-4 border-slate-200 border-t-primary rounded-full animate-spin mx-auto"></div>
                <p class="mt-4 text-slate-500 font-medium">Finding best mentors for you...</p>
            </div>
        `;

        allMentors = await MentorService.getActiveMentors();
        
        if (allMentors.length === 0) {
            renderEmptyState(grid);
            return;
        }

        await populateFilters(allMentors);
        setupEventListeners();
        renderMentors(allMentors);

    } catch (err) {
        console.error("Error loading marketplace:", err);
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

async function populateFilters(mentors) {
    const categoryContainer = document.getElementById('category-filters');
    const countrySelect = document.getElementById('country-filter');
    const citySelect = document.getElementById('city-filter');

    // Fetch categories grouped by domain from the mentor_categories table
    let domainGroups = [];
    try {
        domainGroups = await MentorService.getGroupedMentorCategories();
    } catch (err) {
        // Fallback: aggregate distinct expertise strings from mentor data
        const dynamicCats = new Set();
        mentors.forEach(m => m.expertise.forEach(e => dynamicCats.add(e)));
        domainGroups = [{ domain: 'Expertise', categories: Array.from(dynamicCats).sort().map(n => ({ name: n, slug: n })) }];
    }

    // Render grouped hierarchical filter
    categoryContainer.innerHTML = `
        <button data-category="all"
            class="w-full flex items-center gap-3 p-3 rounded-xl bg-primary text-white shadow-lg shadow-primary/20 cursor-pointer filter-category-btn transition-all duration-200 mb-2">
            <span class="material-symbols-outlined text-xl">grid_view</span>
            <span class="text-sm font-bold">All Mentors</span>
        </button>
    `;

    domainGroups.forEach(group => {
        const domainKey = group.domain.replace(/\s+/g, '-').toLowerCase();
        const isOpen = expandedDomains.has(domainKey);

        const groupEl = document.createElement('div');
        groupEl.className = 'domain-group mb-1';
        groupEl.dataset.domain = domainKey;

        // Domain icon mapping
        const iconMap = {
            'technology & programming': 'code',
            'design & creative': 'palette',
            'languages': 'translate',
            'islamic studies': 'mosque',
            'business & finance': 'trending_up',
            'mathematics & science': 'calculate',
            'general': 'label',
        };
        const domainLower = group.domain.toLowerCase();
        const icon = Object.entries(iconMap).find(([k]) => domainLower.includes(k.split(' ')[0]))?.['1'] || 'category';

        groupEl.innerHTML = `
            <button class="domain-header w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 text-left group" data-domain-key="${domainKey}">
                <div class="flex items-center gap-2.5">
                    <span class="material-symbols-outlined text-lg text-primary/70">${icon}</span>
                    <span class="text-xs font-extrabold uppercase tracking-widest text-slate-500 dark:text-slate-400 group-hover:text-slate-800 dark:group-hover:text-white">${group.domain}</span>
                </div>
                <span class="material-symbols-outlined text-base text-slate-400 transition-transform duration-200 domain-chevron ${isOpen ? 'rotate-180' : ''}">expand_more</span>
            </button>
            <div class="subcategory-list pl-2 space-y-0.5 overflow-hidden transition-all duration-300 ${isOpen ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}">
                ${group.categories.map(cat => `
                    <button data-category="${cat.name}"
                        class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer filter-category-btn transition-all duration-150 group/item text-left">
                        <span class="w-1.5 h-1.5 rounded-full bg-slate-300 group-hover/item:bg-primary flex-shrink-0 transition-colors"></span>
                        <span class="text-sm font-medium text-slate-600 dark:text-slate-400 group-hover/item:text-slate-900 dark:group-hover/item:text-white">${cat.name}</span>
                    </button>
                `).join('')}
            </div>
        `;
        categoryContainer.appendChild(groupEl);
    });

    // Countries
    const countries = new Set(mentors.map(m => m.country).filter(Boolean));
    Array.from(countries).sort().forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        countrySelect.appendChild(opt);
    });

    // Cities
    updateCityOptions(mentors);
}

function updateCityOptions(mentors) {
    const citySelect = document.getElementById('city-filter');
    const currentVal = citySelect.value;
    citySelect.innerHTML = '<option value="all">All Cities</option>';
    
    const cities = new Set(mentors.map(m => m.city).filter(Boolean));
    Array.from(cities).sort().forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        citySelect.appendChild(opt);
    });
    citySelect.value = cities.has(currentVal) ? currentVal : 'all';
}

function setActiveCategory(selectedCategory) {
    activeFilters.category = selectedCategory;

    // Reset all subcategory buttons
    document.querySelectorAll('.filter-category-btn').forEach(b => {
        const isAll = b.dataset.category === 'all';
        const isSelected = b.dataset.category === selectedCategory;

        if (isAll) {
            b.className = selectedCategory === 'all'
                ? 'w-full flex items-center gap-3 p-3 rounded-xl bg-primary text-white shadow-lg shadow-primary/20 cursor-pointer filter-category-btn transition-all duration-200 mb-2'
                : 'w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer filter-category-btn transition-all duration-200 mb-2';
            const icon = b.querySelector('.material-symbols-outlined');
            const text = b.querySelector('span:not(.material-symbols-outlined)');
            if (selectedCategory === 'all') {
                if (icon) icon.className = 'material-symbols-outlined text-xl';
                if (text) text.className = 'text-sm font-bold';
            } else {
                if (icon) icon.className = 'material-symbols-outlined text-xl text-slate-400';
                if (text) text.className = 'text-sm font-bold text-slate-600 dark:text-slate-400';
            }
        } else {
            // subCategory button
            if (isSelected) {
                b.className = 'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg bg-primary/10 cursor-pointer filter-category-btn transition-all duration-150 group/item text-left';
                const dot = b.querySelector('.w-1\\.5');
                const label = b.querySelector('span:last-child');
                if (dot) dot.className = 'w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0';
                if (label) label.className = 'text-sm font-bold text-primary';
            } else {
                b.className = 'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer filter-category-btn transition-all duration-150 group/item text-left';
                const dot = b.querySelector('.w-1\\.5');
                const label = b.querySelector('span:last-child');
                if (dot) dot.className = 'w-1.5 h-1.5 rounded-full bg-slate-300 group-hover/item:bg-primary flex-shrink-0 transition-colors';
                if (label) label.className = 'text-sm font-medium text-slate-600 dark:text-slate-400 group-hover/item:text-slate-900 dark:group-hover/item:text-white';
            }
        }
    });

    applyFilters();
}

function toggleDomain(domainKey) {
    const groupEl = document.querySelector(`.domain-group[data-domain="${domainKey}"]`);
    if (!groupEl) return;

    const subcategoryList = groupEl.querySelector('.subcategory-list');
    const chevron = groupEl.querySelector('.domain-chevron');

    if (expandedDomains.has(domainKey)) {
        expandedDomains.delete(domainKey);
        subcategoryList.className = subcategoryList.className.replace('max-h-[500px] opacity-100', 'max-h-0 opacity-0');
        chevron.classList.remove('rotate-180');
    } else {
        expandedDomains.add(domainKey);
        subcategoryList.className = subcategoryList.className.replace('max-h-0 opacity-0', 'max-h-[500px] opacity-100');
        chevron.classList.add('rotate-180');
    }
}

function setupEventListeners() {
    const searchInput = document.getElementById('marketplace-search');
    const countrySelect = document.getElementById('country-filter');
    const citySelect = document.getElementById('city-filter');

    searchInput?.addEventListener('input', (e) => {
        activeFilters.search = e.target.value.toLowerCase();
        applyFilters();
    });

    countrySelect?.addEventListener('change', (e) => {
        activeFilters.country = e.target.value;
        const filteredByCountry = activeFilters.country === 'all' 
            ? allMentors 
            : allMentors.filter(m => m.country === activeFilters.country);
        updateCityOptions(filteredByCountry);
        applyFilters();
    });

    citySelect?.addEventListener('change', (e) => {
        activeFilters.city = e.target.value;
        applyFilters();
    });

    // Delegated handler for category filter container (domain toggles + subcategory selections)
    document.getElementById('category-filters')?.addEventListener('click', (e) => {
        // Domain header toggle
        const domainBtn = e.target.closest('.domain-header');
        if (domainBtn) {
            toggleDomain(domainBtn.dataset.domainKey);
            return;
        }

        // Subcategory or "All" button
        const catBtn = e.target.closest('.filter-category-btn');
        if (!catBtn) return;
        setActiveCategory(catBtn.dataset.category);
    });
}


function applyFilters() {
    const filtered = allMentors.filter(m => {
        const matchesSearch = !activeFilters.search || 
            m.full_name?.toLowerCase().includes(activeFilters.search) ||
            m.expertise.some(e => e.toLowerCase().includes(activeFilters.search)) ||
            m.country?.toLowerCase().includes(activeFilters.search) ||
            m.short_bio?.toLowerCase().includes(activeFilters.search);
        
        const matchesCategory = activeFilters.category === 'all' || 
            m.expertise.includes(activeFilters.category);
        
        const matchesCountry = activeFilters.country === 'all' || 
            m.country === activeFilters.country;
        
        const matchesCity = activeFilters.city === 'all' || 
            m.city === activeFilters.city;

        return matchesSearch && matchesCategory && matchesCountry && matchesCity;
    });

    renderMentors(filtered);

    // Track search telemetry (fire-and-forget)
    const keyword = activeFilters.search?.trim();
    if (keyword) {
        MentorService.trackSearch(keyword, filtered.length).catch(() => {});
    }
}

function formatResponseTime(hours) {
    if (!hours || hours === 0) return '0h 0m';
    
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    const s = Math.round(((hours - h) * 60 - m) * 60);

    if (h > 0) return `${h}h ${m > 0 ? m + 'm' : ''}`;
    if (m > 0) return `${m}m ${s > 0 ? s + 's' : ''}`;
    return `${s}s`;
}

function renderMentors(mentors) {
    const grid = document.querySelector('.grid.grid-cols-1.md\\:grid-cols-2.xl\\:grid-cols-3');
    if (!grid) return;

    if (mentors.length === 0) {
        renderEmptyState(grid, true);
        return;
    }

    grid.innerHTML = '';
    mentors.forEach(mentor => {
        const card = document.createElement('div');
        // Added flex flex-col h-full for alignment
        card.className = 'group bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-5 hover:shadow-xl hover:shadow-slate-200/50 dark:hover:shadow-none transition-all duration-300 flex flex-col h-full';
        
        const expertiseTags = mentor.expertise?.slice(0, 2).map(exp => 
            `<span class="px-2.5 py-1 rounded-lg bg-primary/5 text-primary text-[10px] font-bold uppercase tracking-wider">${exp}</span>`
        ).join('') || '';

        card.innerHTML = `
            <div class="flex items-start justify-between mb-4">
                <div class="relative cursor-pointer" onclick="window.location.href='/src/pages/mentorship/mentor-profile/index.html?id=${mentor.instructor_id}'">
                    <img src="${mentor.avatar_url || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(mentor.full_name) + '&background=random&color=fff'}" 
                         alt="${mentor.full_name}" 
                         class="w-16 h-16 rounded-2xl object-cover ring-4 ring-slate-50 dark:ring-slate-800 text-[10px] italic">
                    <div class="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 border-4 border-white dark:border-slate-900 rounded-full"></div>
                </div>
                <div class="flex flex-col items-end">
                    <div class="flex items-center gap-1 text-amber-500 mb-1">
                        <span class="material-symbols-outlined text-[18px] fill-current">star</span>
                        <span class="text-sm font-bold">${mentor.rating || '0.0'}</span>
                        <span class="text-slate-400 text-xs font-medium">(${mentor.review_count || 0})</span>
                    </div>
                    <div class="text-primary">
                        <span class="text-lg font-black">$${mentor.hourly_rate || 0}</span>
                        <span class="text-[10px] font-bold uppercase tracking-tighter opacity-60">/ hr</span>
                    </div>
                </div>
            </div>

            <div class="mb-4">
                <div class="flex items-center gap-2 mb-1">
                    <h3 class="text-base font-bold text-slate-900 dark:text-white group-hover:text-primary transition-colors line-clamp-1 cursor-pointer" 
                        onclick="window.location.href='/src/pages/mentorship/mentor-profile/index.html?id=${mentor.instructor_id}'">
                        ${mentor.full_name}
                    </h3>
                    ${mentor.country ? `<span class="text-[10px] text-slate-400">📍 ${mentor.country}</span>` : ''}
                </div>
                <p class="text-xs font-medium text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed h-10 overflow-hidden">
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
                        <p class="text-xs font-bold text-slate-700 dark:text-slate-200">${mentor.completed_sessions ?? mentor.total_sessions ?? 0}</p>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <div class="w-8 h-8 rounded-lg bg-slate-50 dark:bg-slate-800 flex items-center justify-center">
                        <span class="material-symbols-outlined text-slate-400 text-[18px]">bolt</span>
                    </div>
                    <div>
                        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Response</p>
                        <p class="text-xs font-bold text-slate-700 dark:text-slate-200">${formatResponseTime(mentor.avg_response_time)}</p>
                    </div>
                </div>
            </div>

            <a href="/src/pages/mentorship/mentor-profile/index.html?id=${mentor.instructor_id}" 
               class="mt-auto block w-full py-3 rounded-xl bg-slate-900 dark:bg-primary text-white text-center text-sm font-bold hover:bg-primary dark:hover:bg-primary/90 transition-all shadow-lg shadow-slate-200 dark:shadow-none">
                View Profile
            </a>
        `;
        grid.appendChild(card);
    });
}

function renderEmptyState(container, isFiltered = false) {
    container.innerHTML = `
        <div class="col-span-full py-20 text-center bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
            <span class="material-symbols-outlined text-6xl text-slate-300 mb-4">person_off</span>
            <h3 class="text-xl font-bold mb-2">${isFiltered ? 'No mentors match your filters' : 'No mentors found'}</h3>
            <p class="text-slate-500">${isFiltered ? 'Try adjusting your search or filters to find what you are looking for.' : 'We couldn\'t find any public mentors at the moment. Check back later!'}</p>
            ${isFiltered ? `
                <button onclick="window.location.reload()" class="mt-6 text-primary font-bold text-sm hover:underline">
                    Clear all filters
                </button>
            ` : ''}
        </div>
    `;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMarketplace);
} else {
    initMarketplace();
}
