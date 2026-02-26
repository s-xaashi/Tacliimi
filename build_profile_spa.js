const fs = require('fs');
const path = require('path');

const screensDir = path.join(__dirname, 'instructor-screens');
const profileDir = path.join(__dirname, 'instructor-profile');

const personalFile = path.join(screensDir, '3685e4ed5be64f4a8a2aa193a9b4b52f.html');
const teachingFile = path.join(screensDir, '2108ffffb6ce405a9445217c9d300ed3.html');
const payoutFile = path.join(screensDir, '232059355e324050a8d9ce566ba9b386.html');
const securityFile = path.join(screensDir, '42e7d32a5dac47279271c4fd1b827b65.html');

function extractMainContent(filePath) {
    const html = fs.readFileSync(filePath, 'utf8');
    const match = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
    return match ? match[1] : '';
}

let baseHtml = fs.readFileSync(personalFile, 'utf8');

const personalContent = extractMainContent(personalFile);
const teachingContent = extractMainContent(teachingFile);
const payoutContent = extractMainContent(payoutFile);
const securityContent = extractMainContent(securityFile);

// Build the compiled SPA panels
const panelsHtml = `
<div id="panel-personal" class="profile-panel block">
${personalContent}
</div>
<div id="panel-teaching" class="profile-panel hidden">
${teachingContent}
</div>
<div id="panel-payout" class="profile-panel hidden">
${payoutContent}
</div>
<div id="panel-security" class="profile-panel hidden">
${securityContent}
</div>
`;

// Replace the single <main> ... </main> block with our new wrapped panels
// Also reduce its top padding specifically to prevent the extra gap
baseHtml = baseHtml.replace(/(<main[^>]*?class="[^"]*?)\bp-4 md:p-10\b([^"]*?"[^>]*>)([\s\S]*?)(<\/main>)/, `$1px-4 pb-4 md:px-10 md:pb-10 pt-2 md:pt-4$2${panelsHtml}$4`);

// Fallback replacement if the specific p-4 md:p-10 classes aren't matched
if (baseHtml.indexOf('pt-2 md:pt-4') === -1) {
    baseHtml = baseHtml.replace(/(<main[^>]*>)([\s\S]*?)(<\/main>)/, `$1${panelsHtml}$3`);
}

// Inject the Javascript logic
const scriptTags = `
<script>
function switchPanel(panelId, event) {
    if (event) event.preventDefault();
    
    // Hide all panels
    document.querySelectorAll('.profile-panel').forEach(el => {
        el.classList.remove('block');
        el.classList.add('hidden');
    });
    
    // Remove active styles from sidebar
    document.querySelectorAll('aside nav a').forEach(el => {
        el.classList.remove('sidebar-item-active');
        el.classList.add('text-slate-600', 'hover:bg-primary/10', 'hover:text-primary', 'dark:text-slate-400', 'dark:hover:bg-primary/20');
        el.classList.remove('text-slate-600', 'hover:bg-primary/10', 'hover:text-primary', 'dark:text-slate-400', 'dark:hover:bg-primary/20'); // Reset classes nicely
        if (!el.classList.contains('sidebar-item-active') && !el.id) {
             el.className = "flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-slate-600 hover:bg-primary/10 hover:text-primary dark:text-slate-400 dark:hover:bg-primary/20 transition-all";
        }
    });

    // Show selected panel
    document.getElementById(panelId).classList.remove('hidden');
    document.getElementById(panelId).classList.add('block');
    
    // Mark target link active
    if (event && event.currentTarget) {
        event.currentTarget.className = "sidebar-item-active flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-all";
    }
}
</script>
</body>
`;

baseHtml = baseHtml.replace('</body>', scriptTags);

// Wire up the sidebar anchors
baseHtml = baseHtml.replace(
    /<a class="sidebar-item-active flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-all" href="#">[\s\S]*?Personal Info[\s\S]*?<\/a>/,
    `<a class="sidebar-item-active flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-all" href="#" onclick="switchPanel('panel-personal', event)">
<span class="material-symbols-outlined text-[20px]">person</span> Personal Info </a>`
);

baseHtml = baseHtml.replace(
    /<a class="flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-slate-600 hover:bg-primary\/10 hover:text-primary dark:text-slate-400 dark:hover:bg-primary\/20" href="#">[\s\S]*?Teaching Profile[\s\S]*?<\/a>/,
    `<a class="flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-slate-600 hover:bg-primary/10 hover:text-primary dark:text-slate-400 dark:hover:bg-primary/20 transition-all" href="#" onclick="switchPanel('panel-teaching', event)">
<span class="material-symbols-outlined text-[20px]">co_present</span> Teaching Profile </a>`
);

baseHtml = baseHtml.replace(
    /<a class="flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-slate-600 hover:bg-primary\/10 hover:text-primary dark:text-slate-400 dark:hover:bg-primary\/20" href="#">[\s\S]*?Payout Settings[\s\S]*?<\/a>/,
    `<a class="flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-slate-600 hover:bg-primary/10 hover:text-primary dark:text-slate-400 dark:hover:bg-primary/20 transition-all" href="#" onclick="switchPanel('panel-payout', event)">
<span class="material-symbols-outlined text-[20px]">account_balance_wallet</span> Payout Settings </a>`
);

baseHtml = baseHtml.replace(
    /<a class="flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-slate-600 hover:bg-primary\/10 hover:text-primary dark:text-slate-400 dark:hover:bg-primary\/20" href="#">[\s\S]*?Security[\s\S]*?<\/a>/,
    `<a class="flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-slate-600 hover:bg-primary/10 hover:text-primary dark:text-slate-400 dark:hover:bg-primary/20 transition-all" href="#" onclick="switchPanel('panel-security', event)">
<span class="material-symbols-outlined text-[20px]">shield_person</span> Security </a>`
);

// Link Home and Dashboard to correct routes
baseHtml = baseHtml.replace(
    /<a class="text-sm font-medium text-slate-600 hover:text-primary dark:text-slate-400 dark:hover:text-white transition-colors" href="#">Home<\/a>/,
    `<a class="text-sm font-medium text-slate-600 hover:text-primary dark:text-slate-400 dark:hover:text-white transition-colors" href="/index.html">Home</a>`
);

baseHtml = baseHtml.replace(
    /<a class="text-sm font-medium text-slate-600 hover:text-primary dark:text-slate-400 dark:hover:text-white transition-colors" href="#">Dashboard<\/a>/,
    `<a class="text-sm font-medium text-slate-600 hover:text-primary dark:text-slate-400 dark:hover:text-white transition-colors" href="/instructor-dashboard/index.html">Dashboard</a>`
);

// Update Tacliimi Learn Logo to link home appropriately
baseHtml = baseHtml.replace(
    /<div class="flex items-center gap-3">[\s\S]*?Tacliimi <span class="text-primary">Learn<\/span><\/h2>\s*<\/div>/,
    `<div class="flex items-center gap-3 cursor-pointer" onclick="window.location.href='/index.html'">
<div class="flex size-9 items-center justify-center rounded-lg bg-primary text-white">
<span class="material-symbols-outlined">school</span>
</div>
<h2 class="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Tacliimi <span class="text-primary">Learn</span></h2>
</div>`
);

fs.writeFileSync(path.join(profileDir, 'index.html'), baseHtml);
console.log('Successfully written compiled index.html to instructor-profile/');
