import os

proj_dir = r"C:\Users\salmaan\.gemini\antigravity\Tacliimi"

def read_file(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def write_file(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

# ==========================================
# 1. Update mentor-marketplace/index.html
# ==========================================
market_path = os.path.join(proj_dir, "mentor-marketplace", "index.html")
html = read_file(market_path)

# Header Updates
html = html.replace('<div class="flex items-center gap-2">', '<a href="/index.html" class="flex items-center gap-2">', 1)
html = html.replace('<span class="text-xl font-bold tracking-tight">Tacliimi Learn</span>\n</div>', '<span class="text-xl font-bold tracking-tight">Tacliimi Learn</span>\n</a>', 1)
html = html.replace('<a class="text-sm font-medium hover:text-primary transition-colors" href="#">Courses</a>', 
                    '<a class="text-sm font-medium hover:text-primary transition-colors" href="/marketplace/">Courses</a>')
html = html.replace('<button class="bg-primary text-white px-5 py-2 rounded-lg text-sm font-bold hover:bg-primary/90 transition-all">\n                    Become a Teacher\n                </button>', 
                    '<button onclick="window.location.href=\'/become-instructor/\'" class="bg-primary text-white px-5 py-2 rounded-lg text-sm font-bold hover:bg-primary/90 transition-all">\n                    Become a Teacher\n                </button>')
html = html.replace('<div class="w-10 h-10 rounded-full border-2 border-primary/20 bg-slate-100 flex items-center justify-center text-slate-400">', 
                    '<div onclick="window.location.href=\'/account-settings/index.html\'" class="w-10 h-10 rounded-full border-2 border-primary/20 bg-slate-100 flex items-center justify-center text-slate-400 cursor-pointer hover:border-primary/50 transition-colors">')

# Footer Updates
html = html.replace('<div class="flex items-center gap-2 mb-6">', '<a href="/index.html" class="flex items-center gap-2 mb-6">', 1)
html = html.replace('<span class="text-xl font-bold tracking-tight">Tacliimi Learn</span>\n</div>', '<span class="text-xl font-bold tracking-tight">Tacliimi Learn</span>\n</a>', 1)
html = html.replace('<li><a class="hover:text-primary transition-colors" href="#">Marketplace</a></li>', 
                    '<li><a class="hover:text-primary transition-colors" href="/mentor-marketplace/index.html">Marketplace</a></li>')
html = html.replace('<li><a class="hover:text-primary transition-colors" href="#">Courses</a></li>', 
                    '<li><a class="hover:text-primary transition-colors" href="/marketplace/">Courses</a></li>')
html = html.replace('<li><a class="hover:text-primary transition-colors" href="#">Become a Mentor</a></li>', 
                    '<li><a class="hover:text-primary transition-colors" href="/become-instructor/">Become a Mentor</a></li>')

# Add missing ID to categories container
old_cats = """<div class="space-y-2">
<label class="flex items-center gap-3 p-2 rounded-lg bg-primary/10 text-primary cursor-pointer">
<span class="material-symbols-outlined text-xl">grid_view</span>
<span class="text-sm font-medium">All Categories</span>
</label>"""
new_cats = """<div class="space-y-2" id="category-filters">
<label class="flex items-center gap-3 p-2 rounded-lg bg-primary/10 text-primary cursor-pointer filter-item">
<span class="material-symbols-outlined text-xl">grid_view</span>
<span class="text-sm font-medium">All Categories</span>
</label>"""
html = html.replace(old_cats, new_cats)

html = html.replace('<label class="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors">',
                    '<label class="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors filter-item">')

js_addition = """
<script>
    document.addEventListener("DOMContentLoaded", function() {
        const filterItems = document.querySelectorAll('.filter-item');
        filterItems.forEach(item => {
            item.addEventListener('click', function() {
                filterItems.forEach(f => {
                    f.className = 'flex items-center gap-3 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors filter-item';
                });
                this.className = 'flex items-center gap-3 p-2 rounded-lg bg-primary/10 text-primary cursor-pointer filter-item';
            });
        });
    });
</script>
</body>
"""
html = html.replace("</body>", js_addition)
write_file(market_path, html)

# ==========================================
# 2. Update mentor-profile/index.html
# ==========================================
prof_path = os.path.join(proj_dir, "mentor-profile", "index.html")
html = read_file(prof_path)

# Header Updates
html = html.replace('<div class="flex items-center gap-2">', '<a href="/index.html" class="flex items-center gap-2">', 1)
html = html.replace('<span class="text-xl font-bold tracking-tight">Tacliimi Learn</span>\n</div>', '<span class="text-xl font-bold tracking-tight">Tacliimi Learn</span>\n</a>', 1)
html = html.replace('<a class="text-sm font-medium hover:text-primary transition-colors" href="#">Home</a>', 
                    '<a class="text-sm font-medium hover:text-primary transition-colors" href="/index.html">Home</a>')
html = html.replace('<a class="text-sm font-medium text-primary" href="#">Browse Mentors</a>', 
                    '<a class="text-sm font-medium hover:text-primary transition-colors" href="/mentor-marketplace/index.html">Browse Mentors</a>')
html = html.replace('<a class="text-sm font-medium hover:text-primary transition-colors" href="#">Browse Courses</a>', 
                    '<a class="text-sm font-medium hover:text-primary transition-colors" href="/marketplace/">Browse Courses</a>')
html = html.replace('<div class="w-10 h-10 rounded-full border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-400">', 
                    '<div onclick="window.location.href=\'/account-settings/index.html\'" class="w-10 h-10 rounded-full border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-400 cursor-pointer hover:border-primary/50 transition-colors">')

# Footer Updates
html = html.replace('<div class="flex items-center gap-2 mb-6">', '<a href="/index.html" class="flex items-center gap-2 mb-6">', 1)
html = html.replace('<span class="text-xl font-bold tracking-tight">Tacliimi Learn</span>\n</div>', '<span class="text-xl font-bold tracking-tight">Tacliimi Learn</span>\n</a>', 1)
html = html.replace('<li><a class="hover:text-primary transition-colors" href="#">Marketplace</a></li>', 
                    '<li><a class="hover:text-primary transition-colors" href="/mentor-marketplace/index.html">Marketplace</a></li>')
html = html.replace('<li><a class="hover:text-primary transition-colors" href="#">Courses</a></li>', 
                    '<li><a class="hover:text-primary transition-colors" href="/marketplace/">Courses</a></li>')
html = html.replace('<li><a class="hover:text-primary transition-colors" href="#">Become a Mentor</a></li>', 
                    '<li><a class="hover:text-primary transition-colors" href="/become-instructor/">Become a Mentor</a></li>')

write_file(prof_path, html)
print("Updated marketplace and profile.")
