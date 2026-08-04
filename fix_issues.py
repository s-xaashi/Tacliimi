import os
import glob

instructor_dir = r"c:\Users\salmaan\.gemini\antigravity\Tacliimi\src\pages\instructor"

html_files = glob.glob(os.path.join(instructor_dir, "**", "*.html"), recursive=True)

header_search = 'class="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-8 sticky top-0 z-10 shrink-0"'
header_replace = 'class="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-8 sticky top-0 z-10 shrink-0 w-full"'

script_search = '<script src="/src/pages/instructor/instructor-mentorship/mentorship.js"></script>'
script_replace = '<script type="module" src="/src/pages/instructor/instructor-mentorship/mentorship.js"></script>'

files_modified = 0

for file_path in html_files:
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    original_content = content

    if header_search in content:
        content = content.replace(header_search, header_replace)
    
    if script_search in content:
        content = content.replace(script_search, script_replace)

    if content != original_content:
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        files_modified += 1
        print(f"Fixed: {file_path}")

print(f"Total files modified: {files_modified}")
