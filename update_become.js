const fs = require('fs');
const path = 'c:/Users/salmaan/.gemini/antigravity/Tacliimi/src/pages/instructor/become-instructor/index.html';

let html = fs.readFileSync(path, 'utf8');

// 1. Remove rogue markdown formatting
html = html.replace(/```html\r?\n/, '');
html = html.replace(/```\r?\n/, '');

// 2. Remove "Watch How it Works" button
html = html.replace(/<button[^>]*>\s*<span class="material-icons-round text-primary">play_circle<\/span>\s*Watch How it Works\s*<\/button>/s, '');

// 3. Update footer logo
const footerOld = `<div class="flex items-center gap-2 opacity-80">
                    <div class="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                        <span class="material-icons-round text-white text-sm">school</span>
                    </div>
                    <span class="font-bold tracking-tight text-slate-900 dark:text-white">Tacliimi<span
                            class="text-primary text-sm">Learn</span></span>
                </div>`;
const footerNew = `<div class="flex items-center gap-2 opacity-80">
                    <img src="/public/assets/images/IMG_7454.png" alt="Tacliimi Learn" class="h-8 w-auto grayscale contrast-125">
                </div>`;
html = html.replace(footerOld, footerNew);

// Fallback regex if precise match fails for footer
if(html === fs.readFileSync(path, 'utf8')) {
  // Try regex
  html = html.replace(/<div class="flex items-center gap-2 opacity-80">.*?<\/span>\s*<\/span>\s*<\/div>/s, footerNew);
}

// 4. Update testimonial
const testimonialRegex = /<img alt="Instructor Sarah Jenkins" class="w-16 h-16 rounded-full border-4 border-white\/20"\s*src="[^"]+" \/>\s*<div class="text-left">\s*<div class="font-bold text-xl">Sarah Jenkins<\/div>\s*<div class="text-highlight font-medium">Senior UX\/UI Designer &amp; Educator<\/div>\s*<\/div>/s;

const newTestimonial = `<img alt="Mohamed Yuusuf Cali" class="w-16 h-16 rounded-full object-cover border-4 border-white/20"
                        src="/public/assets/images/IMG_7448.png" />
                    <div class="text-left">
                        <div class="font-bold text-xl">Mohamed Yuusuf Cali</div>
                        <div class="text-highlight font-medium">Senior UX/UI Designer &amp; Educator</div>
                    </div>`;

html = html.replace(testimonialRegex, newTestimonial);

// 5. Replace Desktop/Mobile Header and add Sidebar Drawer Overlay
const navRegex = /<nav.*?<\/nav>/s;
const newNav = `<nav class="sticky top-0 z-[50] bg-white/80 dark:bg-background-dark/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div class="max-w-7xl mx-auto px-6 h-16 flex items-center">
          <!-- Mobile Menu Toggle Button (Left) -->
          <button id="mobile-menu-btn" class="md:hidden flex-shrink-0 p-2 -ml-2 text-slate-600 dark:text-slate-300 hover:text-primary transition-colors focus:outline-none">
            <span class="material-symbols-outlined text-2xl leading-none">menu</span>
          </button>
          
          <!-- Logo (Centered on mobile, left on desktop) -->
          <div class="md:hidden absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer z-[60]" onclick="window.location.href='/index.html'">
            <img src="/public/assets/images/IMG_7454.png" alt="Tacliimi Learn" class="h-9 w-auto">
          </div>
          <div class="hidden md:flex items-center gap-2 cursor-pointer shrink-0" onclick="window.location.href='/index.html'">
            <img src="/public/assets/images/IMG_7454.png" alt="Tacliimi Learn" class="h-9 w-auto">
          </div>

          <!-- Spacer for desktop -->
          <div class="hidden md:flex flex-grow"></div>

            <div class="hidden md:flex items-center gap-6">
                <a class="font-medium hover:text-primary transition-colors" href="/src/pages/marketplace/marketplace/index.html">Courses</a>
                <a class="font-medium hover:text-primary transition-colors" href="/src/pages/mentorship/mentor-marketplace/index.html">Mentors</a>
                <button
                    class="bg-primary hover:bg-purple-700 text-white px-6 py-2.5 rounded-full font-semibold transition-all shadow-lg shadow-primary/20"
                    onclick="window.location.href='/src/pages/auth/instructor-login/index.html'">Get Started</button>
                <div class="border-l border-slate-200 dark:border-slate-700 h-6 mx-2"></div>
                <div class="flex items-center gap-3" id="global-profile-container">
                    <button onclick="window.location.href='/src/pages/auth/login/'"
                        class="text-sm font-semibold text-slate-700 dark:text-slate-300 hover:text-primary transition-colors">Log
                        in</button>
                </div>
            </div>
        </div>
    </nav>
    
    <!-- Mobile Side Drawer -->
    <div id="sidebar-overlay" class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[65] hidden opacity-0 transition-opacity duration-300"></div>
    <aside id="mobile-sidebar" class="fixed top-0 left-0 h-full w-[280px] bg-white dark:bg-slate-900 shadow-2xl z-[70] -translate-x-full transition-transform duration-300 flex flex-col">
      <div class="h-16 flex items-center justify-between px-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
        <img src="/public/assets/images/IMG_7454.png" alt="Tacliimi Learn" class="h-8 w-auto">
        <button id="close-sidebar-btn" class="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <div class="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        <div id="global-profile-container-mobile" class="px-3 mb-4"></div>
        <a href="/index.html" class="flex items-center gap-3 px-3 py-3 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium">
          <span class="material-symbols-outlined text-[20px]">home</span>
          Home
        </a>
        <a href="/src/pages/learning/dashboard/index.html" class="flex items-center gap-3 px-3 py-3 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium">
          <span class="material-symbols-outlined text-[20px]">dashboard</span>
          Dashboard
        </a>
        <a href="/src/pages/marketplace/marketplace/index.html" class="flex items-center gap-3 px-3 py-3 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium">
          <span class="material-symbols-outlined text-[20px]">school</span>
          Courses
        </a>
        <a href="/src/pages/mentorship/mentor-marketplace/index.html" class="flex items-center gap-3 px-3 py-3 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium">
          <span class="material-symbols-outlined text-[20px]">groups</span>
          Mentors
        </a>
      </div>
    </aside>`;

html = html.replace(navRegex, newNav);

// 6. Update scripts at EOF
const finalScriptRegex = /<script>.*?mobileMenuBtn\.addEventListener.*?<\/script>/s;
const newScript = `<script>
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const closeSidebarBtn = document.getElementById('close-sidebar-btn');
    const mobileSidebar = document.getElementById('mobile-sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');

    const toggleSidebar = () => {
      const isClosed = mobileSidebar.classList.contains('-translate-x-full');
      if (isClosed) {
        sidebarOverlay.classList.remove('hidden');
        // trigger reflow
        void sidebarOverlay.offsetWidth;
        sidebarOverlay.classList.remove('opacity-0');
        mobileSidebar.classList.remove('-translate-x-full');
        document.body.style.overflow = 'hidden';
      } else {
        sidebarOverlay.classList.add('opacity-0');
        mobileSidebar.classList.add('-translate-x-full');
        setTimeout(() => { sidebarOverlay.classList.add('hidden'); }, 300);
        document.body.style.overflow = '';
      }
    };

    mobileMenuBtn?.addEventListener('click', toggleSidebar);
    closeSidebarBtn?.addEventListener('click', toggleSidebar);
    sidebarOverlay?.addEventListener('click', toggleSidebar);
  </script>`;

if (html.match(finalScriptRegex)) {
    html = html.replace(finalScriptRegex, newScript);
} else {
    // If not found, just inject before </body>
    html = html.replace('</body>', newScript + '\\n</body>');
}

fs.writeFileSync(path, html);
console.log('Update successful!');
