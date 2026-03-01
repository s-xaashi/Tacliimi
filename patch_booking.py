import os

proj_dir = r"C:\Users\salmaan\.gemini\antigravity\Tacliimi"

def read_file(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def write_file(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

# 1. Update index.html
index_path = os.path.join(proj_dir, "mentor-booking", "index.html")
html = read_file(index_path)

# Back to Marketplace
html = html.replace('<a class="inline-flex items-center text-sm font-medium text-slate-500 hover:text-primary transition-colors gap-1" href="#">',
                    '<a class="inline-flex items-center text-sm font-medium text-slate-500 hover:text-primary transition-colors gap-1" href="/mentor-marketplace/index.html">')

# Header Links
html = html.replace('<div class="flex items-center gap-2">', '<a href="/index.html" class="flex items-center gap-2">', 1)
html = html.replace('<span class="text-xl font-bold tracking-tight">Tacliimi Learn</span>\n</div>', '<span class="text-xl font-bold tracking-tight">Tacliimi Learn</span>\n</a>', 1)
html = html.replace('<a class="text-sm font-medium hover:text-primary transition-colors" href="#">Courses</a>', '<a class="text-sm font-medium hover:text-primary transition-colors" href="/marketplace/">Courses</a>')
html = html.replace('<a class="text-sm font-medium hover:text-primary transition-colors" href="#">Mentors</a>', '<a class="text-sm font-medium hover:text-primary transition-colors" href="/mentor-marketplace/index.html">Mentors</a>')
html = html.replace('<button class="bg-primary text-white px-5 py-2 rounded-lg text-sm font-bold hover:bg-primary/90 transition-all">\n                        Become a Teacher\n                    </button>',
                    '<button onclick="window.location.href=\'/become-instructor/\'" class="bg-primary text-white px-5 py-2 rounded-lg text-sm font-bold hover:bg-primary/90 transition-all">\n                        Become a Teacher\n                    </button>')

# Calendar IDs
html = html.replace('<h3 class="font-bold">October 2024</h3>', '<h3 class="font-bold" id="calendar-month-year">October 2024</h3>')
html = html.replace('<button class="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"><span class="material-symbols-outlined text-lg">chevron_left</span></button>',
                    '<button id="prev-month-btn" class="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"><span class="material-symbols-outlined text-lg">chevron_left</span></button>')
html = html.replace('<button class="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"><span class="material-symbols-outlined text-lg">chevron_right</span></button>',
                    '<button id="next-month-btn" class="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"><span class="material-symbols-outlined text-lg">chevron_right</span></button>')

# Topic Text Area
old_topic = """<div class="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 text-sm italic text-slate-400 min-h-[120px]">
                                    Session Details Will Appear Here
                                </div>"""
new_topic = """<textarea class="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 text-sm text-slate-900 dark:text-white min-h-[120px] focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-slate-400 placeholder:italic" placeholder="Session Details Will Appear Here"></textarea>"""
html = html.replace(old_topic, new_topic)

# Javascript injects
js_addition = """
        // --- Meeting Type Hover/Select ---
        const meetingRadios = document.querySelectorAll('input[name="meeting_type"]');
        meetingRadios.forEach(radio => {
            radio.addEventListener('change', function() {
                document.querySelectorAll('input[name="meeting_type"]').forEach(r => {
                    const label = r.closest('label');
                    const icon = label.querySelector('.material-symbols-outlined');
                    const checkCircle = label.querySelector('div.w-5.h-5');
                    
                    if (r.checked) {
                        label.className = 'relative flex flex-col p-5 bg-white dark:bg-slate-900 border-2 border-primary rounded-2xl cursor-pointer shadow-sm group';
                        icon.className = 'material-symbols-outlined text-primary text-3xl transition-colors';
                        checkCircle.className = 'w-5 h-5 rounded-full border-2 border-primary flex items-center justify-center';
                        checkCircle.innerHTML = '<div class="w-2.5 h-2.5 rounded-full bg-primary"></div>';
                    } else {
                        label.className = 'relative flex flex-col p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl cursor-pointer hover:border-primary/50 transition-colors shadow-sm group';
                        icon.className = 'material-symbols-outlined text-slate-400 group-hover:text-primary/70 text-3xl transition-colors';
                        checkCircle.className = 'w-5 h-5 rounded-full border-2 border-slate-200';
                        checkCircle.innerHTML = '';
                    }
                });
            });
        });
        
        // --- Duration Hover/Select ---
        const durationRadios = document.querySelectorAll('input[name="mentorship_duration"]');
        durationRadios.forEach(radio => {
            radio.addEventListener('change', function() {
                document.querySelectorAll('input[name="mentorship_duration"]').forEach(r => {
                    const label = r.closest('label');
                    const iconBox = label.querySelector('div.w-12.h-12');
                    const checkCircle = label.querySelector('div.w-6.h-6');
                    
                    if (r.checked) {
                        label.className = 'relative flex flex-col p-6 bg-white dark:bg-slate-900 border-2 border-primary rounded-2xl cursor-pointer shadow-sm group transition-all';
                        iconBox.className = 'w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary transition-colors';
                        checkCircle.className = 'w-6 h-6 rounded-full border-2 border-primary flex items-center justify-center';
                        checkCircle.innerHTML = '<div class="w-3 h-3 rounded-full bg-primary"></div>';
                    } else {
                        label.className = 'relative flex flex-col p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl cursor-pointer hover:border-primary/50 transition-all shadow-sm group';
                        iconBox.className = 'w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 group-hover:text-primary transition-colors';
                        checkCircle.className = 'w-6 h-6 rounded-full border-2 border-slate-200 group-hover:border-primary/50';
                        checkCircle.innerHTML = '';
                    }
                });
            });
        });
        
        // --- Calendar Change Month/Year ---
        const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        let currentMonth = 9; // October
        let currentYear = 2024;
        const calMonthYear = document.getElementById('calendar-month-year');
        document.getElementById('prev-month-btn')?.addEventListener('click', function() {
            currentMonth--;
            if (currentMonth < 0) {
                currentMonth = 11;
                currentYear--;
            }
            calMonthYear.innerText = months[currentMonth] + " " + currentYear;
        });
        document.getElementById('next-month-btn')?.addEventListener('click', function() {
            currentMonth++;
            if (currentMonth > 11) {
                currentMonth = 0;
                currentYear++;
            }
            calMonthYear.innerText = months[currentMonth] + " " + currentYear;
        });
"""

html = html.replace('// --- Date Selection ---', js_addition + '\n        // --- Date Selection ---')

write_file(index_path, html)

# 2. Update confirmation.html
conf_path = os.path.join(proj_dir, "mentor-booking", "confirmation.html")
html_conf = read_file(conf_path)

# Header Updates
html_conf = html_conf.replace('<div class="flex items-center gap-2 text-primary">', '<a href="/index.html" class="flex items-center gap-2 text-primary">', 1)
html_conf = html_conf.replace('<h2 class="text-slate-900 dark:text-white text-xl font-bold tracking-tight">Tacliimi Learn</h2>\n</div>', '<h2 class="text-slate-900 dark:text-white text-xl font-bold tracking-tight">Tacliimi Learn</h2>\n</a>', 1)
html_conf = html_conf.replace('<a class="text-slate-600 dark:text-slate-300 text-sm font-medium hover:text-primary transition-colors" href="#">Browse Mentors</a>', 
                              '<a class="text-slate-600 dark:text-slate-300 text-sm font-medium hover:text-primary transition-colors" href="/mentor-marketplace/index.html">Browse Mentors</a>')
html_conf = html_conf.replace('<a class="text-slate-600 dark:text-slate-300 text-sm font-medium hover:text-primary transition-colors" href="#">My Courses</a>',
                              '<a class="text-slate-600 dark:text-slate-300 text-sm font-medium hover:text-primary transition-colors" href="/student-dashboard/index.html">My Courses</a>')
html_conf = html_conf.replace('<button class="hidden sm:flex items-center justify-center rounded-lg bg-primary px-5 py-2 text-sm font-bold text-white hover:bg-primary/90 transition-all shadow-sm">\n                Become a Teacher\n            </button>',
                              '<button onclick="window.location.href=\'/become-instructor/\'" class="hidden sm:flex items-center justify-center rounded-lg bg-primary px-5 py-2 text-sm font-bold text-white hover:bg-primary/90 transition-all shadow-sm">\n                Become a Teacher\n            </button>')

# Action buttons
html_conf = html_conf.replace('<button class="flex-1 bg-primary hover:bg-primary/90 text-white font-bold py-3 px-6 rounded-lg flex items-center justify-center gap-2 transition-all">',
                              '<button onclick="window.location.href=\'/student-dashboard/index.html#mentors\'" class="flex-1 bg-primary hover:bg-primary/90 text-white font-bold py-3 px-6 rounded-lg flex items-center justify-center gap-2 transition-all">')
html_conf = html_conf.replace('<button class="flex-1 bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 hover:border-primary text-slate-700 dark:text-slate-300 font-bold py-3 px-6 rounded-lg transition-all">',
                              '<button onclick="window.location.href=\'/mentor-marketplace/index.html\'" class="flex-1 bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 hover:border-primary text-slate-700 dark:text-slate-300 font-bold py-3 px-6 rounded-lg transition-all">')

write_file(conf_path, html_conf)
print("Updated successfully")
