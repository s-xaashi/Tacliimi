const fs = require('fs');
const file = 'src/pages/instructor/instructor-dashboard/index.html';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
    /<!-- QUICK ACTIONS & FILTER BAR -->[\s\S]*?<\/button>\s*<\/div>/,
    `<!-- QUICK ACTIONS & FILTER BAR -->
<div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 mb-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
<div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 flex-1 w-full sm:w-auto">
<div class="relative flex-1 w-full max-w-none sm:max-w-md">
<span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">search</span>
<input class="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-transparent rounded-xl text-sm focus:ring-2 focus:ring-primary/20 transition-all dark:text-white" id="course-search-input" placeholder="Search courses by name, ID or category..." type="text"/>
</div>
<select class="bg-slate-50 dark:bg-slate-800 border border-transparent rounded-xl text-sm py-2.5 px-4 focus:ring-2 focus:ring-primary/20 dark:text-white w-full sm:w-auto" id="status-filter">
<option value="all">All Statuses</option>
<option value="published">Published</option>
<option value="pending_review">Pending Review</option>
<option value="draft">Draft</option>
<option value="rejected">Rejected</option>
</select>
</div>
<button class="bg-primary hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl flex items-center justify-center gap-2 font-semibold transition-all shadow-lg shadow-indigo-100 dark:shadow-none whitespace-nowrap w-full sm:w-auto mt-2 sm:mt-0" onclick="window.location.href='/src/pages/instructor/instructor-courses/wizard.html'">
<span class="material-symbols-outlined text-xl">add_circle</span>
                        Create New Course
                    </button>
</div>`
);

content = content.replace(
    /<!-- DATA GRID -->[\s\S]*?<\/table>\n<\/div>\n<\/div>/,
    `<!-- DATA GRID -->
<div class="hidden" id="portfolio-grid-wrapper">
<div class="overflow-hidden sm:overflow-x-visible bg-transparent lg:bg-white lg:dark:bg-slate-900 lg:rounded-2xl lg:border lg:border-slate-200 lg:dark:border-slate-800">
<table class="w-full text-left block lg:table">
<thead class="hidden lg:table-header-group">
<tr class="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider">
<th class="px-6 py-4">Course Details</th>
<th class="px-6 py-4">Category / ID</th>
<th class="px-6 py-4">Status</th>
<th class="px-6 py-4">Performance</th>
<th class="px-6 py-4">Price</th>
<th class="px-6 py-4 text-right">Actions</th>
</tr>
</thead>
<tbody class="block lg:table-row-group divide-y-0 lg:divide-y divide-slate-100 dark:divide-slate-800 text-sm max-lg:space-y-4" id="portfolio-table-body">
<!-- Dynamic Rows -->
</tbody>
</table>
</div>
</div>`
);

content = content.replace(
    /return \`[\s\S]*?<tr class="hover:bg-slate-50 dark:hover:bg-slate-800\/50 transition-colors group">[\s\S]*?<\/tr>[\s\S]*?\`;/g,
    `return \`
                            <tr class="block lg:table-row bg-white dark:bg-slate-900 lg:bg-transparent lg:hover:bg-slate-50 dark:lg:hover:bg-slate-800/50 transition-colors group rounded-2xl border border-slate-200 dark:border-slate-800 lg:border-none shadow-sm flex flex-col lg:shadow-none overflow-hidden max-lg:mx-auto max-lg:max-w-[360px] lg:max-w-none">
                                <td class="block lg:table-cell px-4 py-4 lg:px-6 lg:py-5 border-b lg:border-b-0 border-slate-100 dark:border-slate-800 w-full lg:w-auto">
                                    <div class="flex flex-col sm:flex-row items-center lg:items-center gap-4 text-center sm:text-left w-full">
                                        <div class="w-full sm:w-24 lg:w-12 h-32 sm:h-16 lg:h-12 rounded-xl lg:rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden flex-shrink-0 border border-slate-200 dark:border-slate-700 mx-auto sm:mx-0">
                                            \${course.thumbnail_url ? \\\`<img src="\${course.thumbnail_url}" class="w-full h-full object-cover">\\\` : \\\`<span class="material-symbols-outlined text-slate-400 w-full h-full flex items-center justify-center">image</span>\\\`}
                                        </div>
                                        <div class="w-full">
                                            <div class="font-bold text-slate-900 dark:text-white group-hover:text-primary transition-colors text-base lg:text-sm mb-1 lg:mb-0 line-clamp-2">\${course.title || 'Untitled Course'}</div>
                                            <div class="text-xs text-slate-400 mt-1 flex items-center justify-center sm:justify-start gap-1">
                                                <span class="material-symbols-outlined text-[14px]">calendar_today</span>
                                                Created: \${createdDate}
                                            </div>
                                        </div>
                                    </div>
                                </td>
                                <td class="block lg:table-cell px-4 py-3 lg:px-6 lg:py-5 w-full lg:w-auto">
                                    <div class="flex justify-between items-center w-full lg:hidden mb-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                                        <span>Category / ID</span>
                                    </div>
                                    <div class="flex flex-col lg:block max-lg:items-end w-full">
                                        <div class="text-xs font-mono bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded inline-block mb-1 text-slate-500 dark:text-slate-400">
                                            \${course.serial_id || 'CRS-XXXX'}
                                        </div>
                                        <div class="text-xs text-slate-500 dark:text-slate-400 font-medium">
                                            \${course.category?.name || 'Uncategorized'}
                                        </div>
                                    </div>
                                </td>
                                <td class="block lg:table-cell px-4 py-3 lg:px-6 lg:py-5 w-full lg:w-auto border-t lg:border-none border-dashed border-slate-200 dark:border-slate-800">
                                    <div class="flex justify-between items-center w-full lg:hidden mb-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                                        <span>Status</span>
                                    </div>
                                    <div class="flex flex-col lg:block max-lg:items-end w-full">
                                        <span class="px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider \${statusClass}">
                                            \${statusLabel}
                                        </span>
                                        \${course.is_revision ? \\\`<div class="mt-2 text-[10px] text-blue-600 dark:text-blue-400 font-semibold uppercase flex items-center gap-1"><span class="material-symbols-outlined text-[12px]">edit_note</span> Revision Draft</div>\\\` : ''}
                                    </div>
                                </td>
                                <td class="block lg:table-cell px-4 py-3 lg:px-6 lg:py-5 w-full lg:w-auto border-t lg:border-none border-dashed border-slate-200 dark:border-slate-800">
                                    <div class="flex justify-between items-center w-full lg:hidden mb-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                                        <span>Performance</span>
                                    </div>
                                    <div class="flex items-center lg:flex-col lg:items-start max-lg:justify-end gap-3 lg:gap-1.5 w-full">
                                        <div class="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                                            <span class="material-symbols-outlined text-sm">group</span>
                                            <span class="font-semibold">\${course.enrolled_count || 0}</span>
                                            <span class="text-[10px] text-slate-400 hidden lg:inline">students</span>
                                        </div>
                                        <div class="flex items-center gap-1.5 text-amber-500">
                                            <span class="material-symbols-outlined text-sm">star</span>
                                            <span class="font-semibold">\${course.avg_rating || '0.0'}</span>
                                            <span class="text-[10px] text-slate-400 hidden lg:inline">(\${course.review_count || 0})</span>
                                        </div>
                                    </div>
                                </td>
                                <td class="block lg:table-cell px-4 py-3 lg:px-6 lg:py-5 w-full lg:w-auto border-t lg:border-none border-dashed border-slate-200 dark:border-slate-800">
                                    <div class="flex justify-between items-center w-full lg:hidden mb-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                                        <span>Price</span>
                                    </div>
                                    <div class="flex flex-col lg:block max-lg:items-end w-full">
                                        <div class="font-bold text-slate-900 dark:text-white lg:text-base">$\${parseFloat(\${course.price || 0}).toFixed(2)}</div>
                                        <div class="text-[10px] text-slate-400 uppercase mt-0.5">\${course.price > 0 ? 'One-time' : 'Free'}</div>
                                    </div>
                                </td>
                                <td class="block lg:table-cell px-4 py-4 lg:px-6 lg:py-5 w-full lg:w-auto border-t lg:border-none border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 lg:bg-transparent lg:text-right">
                                    <div class="flex justify-center items-center lg:justify-end gap-3 w-full">
                                        \${normalizedStatus === 'pending_review' 
                                            ? \\\`<button onclick="withdrawReview('\${course.id}')" class="px-4 py-2 lg:px-3 lg:py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 rounded-lg text-xs font-bold transition-all max-lg:flex-1 w-full" title="Withdraw submission to edit">Withdraw</button>\\\`
                                            : normalizedStatus === 'published'
                                                ? \\\`<button onclick="editPublishedCourse('\${course.id}')" class="px-4 py-2 lg:p-2 bg-white dark:bg-slate-800 lg:bg-transparent border border-slate-200 dark:border-slate-700 lg:border-none shadow-sm lg:shadow-none hover:bg-primary/10 hover:text-primary rounded-lg transition-all text-slate-600 dark:text-slate-300 max-lg:flex-1 w-full flex items-center justify-center gap-1.5" title="Edit Course"><span class="material-symbols-outlined text-lg">edit</span> <span class="lg:hidden text-xs font-semibold">Edit</span></button>\\\`
                                                : \\\`<button onclick="window.location.href='/src/pages/instructor/instructor-courses/wizard.html?id=\${course.id}'" class="px-4 py-2 lg:p-2 bg-white dark:bg-slate-800 lg:bg-transparent border border-slate-200 dark:border-slate-700 lg:border-none shadow-sm lg:shadow-none hover:bg-primary/10 hover:text-primary rounded-lg transition-all text-slate-600 dark:text-slate-300 max-lg:flex-1 w-full flex items-center justify-center gap-1.5" title="Edit Course"><span class="material-symbols-outlined text-lg">edit</span> <span class="lg:hidden text-xs font-semibold">Edit</span></button>\\\`
                                        }
                                        <button onclick="window.location.href='/src/pages/learning/learning-interface/index.html?id=\${course.id}'" 
                                            class="px-4 py-2 lg:p-2 bg-white dark:bg-slate-800 lg:bg-transparent border border-slate-200 dark:border-slate-700 lg:border-none shadow-sm lg:shadow-none hover:bg-emerald-500/10 hover:text-emerald-500 rounded-lg transition-all text-slate-600 dark:text-slate-300 max-lg:flex-1 w-full flex items-center justify-center gap-1.5" title="Preview Course">
                                            <span class="material-symbols-outlined text-lg">visibility</span> <span class="lg:hidden text-xs font-semibold">Preview</span>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        \`;`
);

fs.writeFileSync(file, content);
