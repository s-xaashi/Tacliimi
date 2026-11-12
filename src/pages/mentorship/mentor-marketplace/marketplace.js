import { MentorService } from '../../../services/mentorService.js';
import { AuthService } from '../../../services/authService.js';
import { resolveProfileAvatar } from '../../../services/r2ImageUpload.js';

let allMentors = [];
let expandedDomains = new Set(); // Track which domain groups are open
const urlParams = new URLSearchParams(window.location.search);
const filterCity = urlParams.get('city');
const filterCategory = urlParams.get('category');

let activeFilters = {
    search: '',
    category: filterCategory || 'all',
    country: 'all',
    city: filterCity || 'all'
};

let currentUser = null;
let wishlistedMentorIds = new Set();

window.toggleMentorWishlist = async function(mentorId, btnElement) {
    if (!currentUser) {
        window.location.href = '/src/pages/auth/login/';
        return;
    }
    try {
        const isWishlisted = wishlistedMentorIds.has(mentorId);
        const iconSpan = btnElement.querySelector('.ms-fav-icon');
        
        if (isWishlisted) {
            iconSpan.style.fontVariationSettings = "'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24";
            btnElement.classList.replace('text-red-500', 'text-gray-400');
            btnElement.classList.replace('dark:text-red-500', 'dark:text-slate-300');
            wishlistedMentorIds.delete(mentorId);
        } else {
            iconSpan.style.fontVariationSettings = "'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 24";
            btnElement.classList.replace('text-gray-400', 'text-red-500');
            btnElement.classList.replace('dark:text-slate-300', 'dark:text-red-500');
            wishlistedMentorIds.add(mentorId);
        }
        
        const newState = await MentorService.toggleWishlist(mentorId, currentUser.id);
        if (newState !== !isWishlisted) {
            if (newState) {
                iconSpan.style.fontVariationSettings = "'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 24";
                btnElement.classList.replace('text-gray-400', 'text-red-500');
                btnElement.classList.replace('dark:text-slate-300', 'dark:text-red-500');
                wishlistedMentorIds.add(mentorId);
            } else {
                iconSpan.style.fontVariationSettings = "'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24";
                btnElement.classList.replace('text-red-500', 'text-gray-400');
                btnElement.classList.replace('dark:text-red-500', 'dark:text-slate-300');
                wishlistedMentorIds.delete(mentorId);
            }
        }
    } catch (err) {
        alert(err.message || 'Error updating wishlist');
    }
};

function buildMentorSkeletons(count) {
    return Array(count).fill(0).map(() => `
        <div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-4 md:p-5 flex flex-col h-full animate-pulse" aria-hidden="true">
            <div class="flex items-start justify-between mb-3 md:mb-4">
                <div class="relative mt-2 md:mt-3">
                    <div class="w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-slate-200 dark:bg-slate-700"></div>
                </div>
                <div class="flex items-start gap-2 md:gap-4">
                    <div class="flex flex-col items-end mt-1 md:mt-2 gap-1.5">
                        <div class="h-4 w-10 bg-slate-200 dark:bg-slate-700 rounded"></div>
                        <div class="h-5 w-12 bg-slate-200 dark:bg-slate-700 rounded"></div>
                    </div>
                    <div class="w-8 h-8 md:w-10 md:h-10 rounded-full bg-slate-200 dark:bg-slate-700 mt-1 md:mt-2"></div>
                </div>
            </div>
            <div class="mb-3 md:mb-4">
                <div class="h-4 w-2/3 bg-slate-200 dark:bg-slate-700 rounded mb-2"></div>
                <div class="h-3 w-full bg-slate-200 dark:bg-slate-700 rounded mb-1"></div>
                <div class="h-3 w-4/5 bg-slate-200 dark:bg-slate-700 rounded"></div>
            </div>
            <div class="flex flex-wrap gap-1.5 md:gap-2 mb-3 md:mb-4">
                <div class="h-5 w-20 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
                <div class="h-5 w-16 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
            </div>
            <div class="grid grid-cols-2 gap-2 md:gap-3 py-3 md:py-4 border-y border-slate-100 dark:border-slate-800 mb-4 md:mb-5">
                <div class="flex items-center gap-1.5 md:gap-2">
                    <div class="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-slate-200 dark:bg-slate-700"></div>
                    <div class="flex flex-col gap-1">
                        <div class="h-2.5 w-12 bg-slate-200 dark:bg-slate-700 rounded"></div>
                        <div class="h-3 w-8 bg-slate-200 dark:bg-slate-700 rounded"></div>
                    </div>
                </div>
                <div class="flex items-center gap-1.5 md:gap-2">
                    <div class="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-slate-200 dark:bg-slate-700"></div>
                    <div class="flex flex-col gap-1">
                        <div class="h-2.5 w-14 bg-slate-200 dark:bg-slate-700 rounded"></div>
                        <div class="h-3 w-10 bg-slate-200 dark:bg-slate-700 rounded"></div>
                    </div>
                </div>
            </div>
            <div class="mt-auto h-10 md:h-11 w-full bg-slate-200 dark:bg-slate-700 rounded-xl"></div>
        </div>
    `).join('');
}

async function initMarketplace() {
    const grid = document.getElementById('mentor-cards-grid');
    if (!grid) {
        console.error('[Marketplace] Grid element #mentor-cards-grid not found. Retrying in 250ms...');
        setTimeout(initMarketplace, 250);
        return;
    }

    try {
        grid.setAttribute('aria-busy', 'true');
        grid.innerHTML = buildMentorSkeletons(6);

        allMentors = await MentorService.getActiveMentors();
        
        try {
            const session = await AuthService.getSession();
            if (session && session.user) {
                currentUser = session.user;
                const wishlist = await MentorService.getStudentWishlist(currentUser.id) || [];
                wishlistedMentorIds = new Set(wishlist.map(m => m.instructor_id));
            }
        } catch (e) {
            console.warn("Could not load user or wishlist:", e);
        }
        
        try {
            const { BoostService } = await import('../../../services/boostService.js');
            const [boostedIds, banners] = await Promise.all([
                BoostService.getBoostedEntityIds('mentor'),
                BoostService.getActivePromoBanners('mentor')
            ]);
            
            const bannerMap = {};
            banners.forEach(b => bannerMap[b.entity_id] = b.banner_text);
            
            allMentors.forEach((m, i) => {
                if (bannerMap[m.instructor_id]) m.banner_text = bannerMap[m.instructor_id];
                const bIdx = boostedIds.indexOf(m.instructor_id);
                m._boost_order = bIdx !== -1 ? bIdx : 999999;
                m._original_idx = i;
            });
            
            allMentors.sort((a, b) => {
                if (a._boost_order !== b._boost_order) return a._boost_order - b._boost_order;
                return a._original_idx - b._original_idx;
            });
        } catch(e) {
            console.warn("Could not load mentor boosts in marketplace:", e);
        }
        
        if (allMentors.length === 0) {
            renderEmptyState(grid);
            return;
        }

        await populateFilters(allMentors);
        setupEventListeners();
        applyFilters(); // Use applyFilters() so URL params like ?city= are applied on first render

    } catch (err) {
        grid.removeAttribute('aria-busy');
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

    // Auto-expand domain containing selected category from URL parameter
    if (activeFilters.category && activeFilters.category !== 'all') {
        domainGroups.forEach(group => {
            const domainKey = group.domain.replace(/\s+/g, '-').toLowerCase();
            const target = activeFilters.category.toLowerCase();
            if (group.categories.some(c => c.name.toLowerCase().includes(target) || target.includes(c.name.toLowerCase()))) {
                expandedDomains.add(domainKey);
            }
        });
    }

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

    // If active category is set from URL, highlight it
    if (activeFilters.category && activeFilters.category !== 'all') {
        setActiveCategory(activeFilters.category);
    }

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
    // Use activeFilters.city so that URL params (e.g. ?city=Burco) are honoured.
    const desiredCity = activeFilters.city;
    citySelect.innerHTML = '<option value="all">All Cities</option>';
    
    const cities = new Set(mentors.map(m => m.city).filter(Boolean));
    Array.from(cities).sort().forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        citySelect.appendChild(opt);
    });

    // Apply the desired city filter (from URL param or previous selection)
    if (desiredCity !== 'all' && cities.has(desiredCity)) {
        citySelect.value = desiredCity;
    } else {
        citySelect.value = 'all';
        // If a city was requested via URL but not found in data, reset filter
        if (desiredCity !== 'all') activeFilters.city = 'all';
    }
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

    // The empty-state is rendered dynamically, so handle its clear action at the grid level.
    const mentorGrid = document.querySelector('.grid.grid-cols-1.md\\:grid-cols-2.xl\\:grid-cols-3');
    mentorGrid?.addEventListener('click', (e) => {
        const clearButton = e.target.closest('[data-clear-mentor-filters]');
        if (!clearButton) return;
        clearAllMentorFilters();
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

function formatResponseTime(seconds) {
    if (seconds == null || !Number.isFinite(Number(seconds)) || Number(seconds) < 0) return 'Not enough data';
    const value = Math.round(Number(seconds));
    if (value < 60) return `~${value}s`;
    const minutes = Math.floor(value / 60);
    const remainingSeconds = value % 60;
    if (minutes < 60) return remainingSeconds ? `~${minutes}m ${remainingSeconds}s` : `~${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes ? `~${hours}h ${remainingMinutes}m` : `~${hours}h`;
}

async function renderMentors(mentors) {
    const grid = document.querySelector('.grid.grid-cols-1.md\\:grid-cols-2.xl\\:grid-cols-3');
    if (!grid) return;
    grid.removeAttribute('aria-busy');

    if (mentors.length === 0) {
        renderEmptyState(grid, true);
        return;
    }

    grid.innerHTML = '';
    for (const mentor of mentors) {
        // Avatar signing must never prevent the mentor card itself from rendering.
        const resolvedAvatar = await resolveProfileAvatar(mentor).catch(error => {
            console.warn('Could not resolve mentor avatar:', mentor.instructor_id, error);
            return null;
        });
        const card = document.createElement('div');
        const isBoosted = mentor._boost_order !== undefined && mentor._boost_order !== 999999;
        const boostRing = isBoosted ? 'boosted-card' : '';
        
        const roleBadge = isBoosted 
            ? `<div class="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-1 border border-amber-200 dark:border-amber-500/30"><span class="material-symbols-outlined text-[10px]">stars</span> Sponsored</div>`
            : `<div class="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase tracking-widest border border-slate-200 dark:border-slate-700">Top Mentor</div>`;

        let bannerHtml = '';
        if (mentor.banner_text) {
            bannerHtml = `<div class="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/30 dark:to-orange-900/30 border-t border-amber-200/50 dark:border-amber-700/50 px-4 py-2 mt-auto mb-3 md:mb-4 flex gap-2 items-center mx-[-16px] md:mx-[-20px]"><span class="material-symbols-outlined text-amber-500 text-[14px] shrink-0">campaign</span><p class="text-[10px] font-bold text-amber-900 dark:text-amber-100 line-clamp-1 leading-tight">${mentor.banner_text}</p></div>`;
        } else {
            bannerHtml = `<div class="mt-auto mb-3 md:mb-4"></div>`;
        }

        // Added flex flex-col h-full and boost ring
        card.className = `group bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-4 md:p-5 hover:shadow-xl hover:shadow-slate-200/50 dark:hover:shadow-none transition-all duration-300 flex flex-col h-full cursor-pointer ${boostRing}`;
        card.onclick = () => window.location.href = `/src/pages/mentorship/mentor-profile/index.html?id=${mentor.instructor_id}`;
        
        const isWishlisted = wishlistedMentorIds.has(mentor.instructor_id);
        const favIcon = isWishlisted ? 'favorite' : 'favorite_border';
        const favColor = isWishlisted ? 'text-red-500 dark:text-red-500' : 'text-gray-400 dark:text-slate-300';
        
        const expertiseTags = mentor.expertise?.slice(0, 2).map(exp => 
            `<span class="px-2.5 py-1 rounded-lg bg-primary/5 text-primary text-[10px] font-bold uppercase tracking-wider">${exp}</span>`
        ).join('') || '';

        card.innerHTML = `
            <div class="flex items-start justify-between mb-3 md:mb-4">
                <div class="relative cursor-pointer">
                    <div class="absolute -top-3 -left-3">${roleBadge}</div>
                    <img src="${resolvedAvatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(mentor.full_name) + '&background=random&color=fff'}" 
                         alt="${mentor.full_name}" 
                         class="w-14 h-14 md:w-16 md:h-16 rounded-2xl object-cover ring-4 ring-slate-50 dark:ring-slate-800 text-[10px] italic mt-2 md:mt-3">
                    <div class="absolute -bottom-1 -right-1 w-4 h-4 md:w-5 md:h-5 bg-green-500 border-2 md:border-4 border-white dark:border-slate-900 rounded-full"></div>
                </div>
                <div class="flex items-start gap-2 md:gap-4">
                    <div class="flex flex-col items-end mt-1 md:mt-2">
                        <div class="flex items-center gap-1 text-amber-500 mb-0.5">
                            <span class="material-symbols-outlined text-[14px] md:text-[16px] fill-current">star</span>
                            <span class="text-[11px] md:text-xs font-bold leading-none">${mentor.rating || '0.0'}</span>
                        </div>
                        <div class="text-primary text-right">
                            <span class="text-sm font-black">$${mentor.hourly_rate || 0}</span>
                            <span class="text-[9px] font-bold uppercase tracking-tighter opacity-60">/hr</span>
                        </div>
                    </div>
                    <button onclick="event.stopPropagation(); window.toggleMentorWishlist('${mentor.instructor_id}', this);" 
                            class="w-8 h-8 md:w-10 md:h-10 rounded-full border border-slate-100 dark:border-slate-800/60 bg-slate-50 dark:bg-slate-800 flex items-center justify-center hover:shadow hover:bg-white dark:hover:bg-slate-700 transition-all active:scale-95 ${favColor} shrink-0 mt-1 md:mt-2">
                        <span class="material-symbols-outlined ms-fav-icon text-[18px] md:text-[20px]" style="font-variation-settings: ${isWishlisted ? "'FILL' 1" : "'FILL' 0"},'wght' 400,'GRAD' 0,'opsz' 24">favorite</span>
                    </button>
                </div>
            </div>

            <div class="mb-3 md:mb-4">
                <div class="flex items-center gap-2 mb-1">
                    <h3 class="text-sm md:text-base font-bold text-slate-900 dark:text-white group-hover:text-primary transition-colors line-clamp-1 cursor-pointer" 
                        onclick="window.location.href='/src/pages/mentorship/mentor-profile/index.html?id=${mentor.instructor_id}'">
                        ${mentor.full_name}
                    </h3>
                    ${mentor.country ? `<span class="text-[9px] md:text-[10px] text-slate-400">📍 ${mentor.country}</span>` : ''}
                </div>
                <p class="text-[11px] md:text-xs font-medium text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed h-8 md:h-10 overflow-hidden">
                    ${mentor.short_bio || 'Expert mentor ready to guide you.'}
                </p>
            </div>

            <div class="flex flex-wrap gap-1.5 md:gap-2 mb-3 md:mb-4">
                ${expertiseTags}
                ${mentor.expertise?.length > 2 ? `<span class="text-[9px] md:text-[10px] font-bold text-slate-400 self-center">+${mentor.expertise.length - 2} more</span>` : ''}
            </div>

            <div class="grid grid-cols-2 gap-2 md:gap-3 mb-4 md:mb-5 py-3 md:py-4 border-y border-slate-50 dark:border-slate-800">
                <div class="flex items-center gap-1.5 md:gap-2">
                    <div class="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-slate-50 dark:bg-slate-800 flex items-center justify-center">
                        <span class="material-symbols-outlined text-slate-400 text-[16px] md:text-[18px]">history</span>
                    </div>
                    <div>
                        <p class="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-tight">Sessions</p>
                        <p class="text-[11px] md:text-xs font-bold text-slate-700 dark:text-slate-200">${mentor.completed_sessions ?? mentor.total_sessions ?? 0}</p>
                    </div>
                </div>
                <div class="flex items-center gap-1.5 md:gap-2">
                    <div class="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-slate-50 dark:bg-slate-800 flex items-center justify-center">
                        <span class="material-symbols-outlined text-slate-400 text-[16px] md:text-[18px]">bolt</span>
                    </div>
                    <div>
                        <p class="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-tight">Reply time</p>
                        <p class="text-[11px] md:text-xs font-bold text-slate-700 dark:text-slate-200">${formatResponseTime(mentor.avg_response_time_seconds)}</p>
                    </div>
                </div>
            </div>

            ${bannerHtml}

            <a href="/src/pages/mentorship/mentor-profile/index.html?id=${mentor.instructor_id}" 
               class="mt-auto block w-full py-2.5 md:py-3 rounded-xl bg-slate-900 dark:bg-primary text-white text-center text-sm font-bold hover:bg-primary dark:hover:bg-primary/90 transition-all shadow-lg shadow-slate-200 dark:shadow-none">
                View Profile
            </a>
        `;
        grid.appendChild(card);
    }
}

function clearAllMentorFilters() {
    activeFilters.search = '';
    activeFilters.category = 'all';
    activeFilters.country = 'all';
    activeFilters.city = 'all';

    const searchInput = document.getElementById('marketplace-search');
    const countrySelect = document.getElementById('country-filter');
    const citySelect = document.getElementById('city-filter');

    if (searchInput) searchInput.value = '';
    if (countrySelect) countrySelect.value = 'all';
    updateCityOptions(allMentors);
    if (citySelect) citySelect.value = 'all';

    window.history.replaceState({}, document.title, window.location.pathname);
    setActiveCategory('all');
}

function renderEmptyState(container, isFiltered = false) {
    container.innerHTML = `
        <div class="col-span-full py-20 text-center bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
            <span class="material-symbols-outlined text-6xl text-slate-300 mb-4">person_off</span>
            <h3 class="text-xl font-bold mb-2">${isFiltered ? 'No mentors match your filters' : 'No mentors found'}</h3>
            <p class="text-slate-500">${isFiltered ? 'Try adjusting your search or filters to find what you are looking for.' : 'We couldn\'t find any public mentors at the moment. Check back later!'}</p>
            ${isFiltered ? `
                <button type="button" data-clear-mentor-filters class="mt-6 text-primary font-bold text-sm hover:underline">
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
