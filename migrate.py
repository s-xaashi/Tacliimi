import os
import shutil

ROOT_DIR = r"c:\Users\salmaan\.gemini\antigravity\Tacliimi"
SRC_DIR = os.path.join(ROOT_DIR, "src")
PUBLIC_DIR = os.path.join(ROOT_DIR, "public")

MAPPING = {
    "student-dashboard": "src/pages/student/student-dashboard",
    "account-settings": "src/pages/student/account-settings",
    
    "instructor-dashboard": "src/pages/instructor/instructor-dashboard",
    "instructor-courses": "src/pages/instructor/instructor-courses",
    "instructor-analytics": "src/pages/instructor/instructor-analytics",
    "instructor-mentorship": "src/pages/instructor/instructor-mentorship",
    "instructor-profile": "src/pages/instructor/instructor-profile",
    "instructor-availability": "src/pages/instructor/instructor-availability",
    "instructor-earnings": "src/pages/instructor/instructor-earnings",
    "instructor-communications": "src/pages/instructor/instructor-communications",
    "become-instructor": "src/pages/instructor/become-instructor",
    "instructor-screens": "src/pages/instructor/instructor-screens",
    
    "login": "src/pages/auth/login",
    "login-select": "src/pages/auth/login-select",
    "forgot-password": "src/pages/auth/forgot-password",
    "reset-password": "src/pages/auth/reset-password",
    "user-login": "src/pages/auth/user-login",
    "user-register": "src/pages/auth/user-register",
    "instructor-login": "src/pages/auth/instructor-login",
    "instructor-register": "src/pages/auth/instructor-register",
    
    "marketplace": "src/pages/marketplace/marketplace",
    "course-details": "src/pages/marketplace/course-details",
    
    "mentor-marketplace": "src/pages/mentorship/mentor-marketplace",
    "mentor-booking": "src/pages/mentorship/mentor-booking",
    "mentor-profile": "src/pages/mentorship/mentor-profile",
    
    "learning-interface": "src/pages/learning/learning-interface",
    
    "index.html": "src/pages/common/index.html",
    "instructor-layout-shell.html": "src/pages/common/instructor-layout-shell.html",
    "raw.html": "src/pages/common/raw.html",
    "stitch_wizard.html": "src/pages/common/stitch_wizard.html",
    "old-dash.html": "src/pages/common/old-dash.html",
    "old-dash2.html": "src/pages/common/old-dash2.html",
    "new_mentorship_screen.html": "src/pages/common/new_mentorship_screen.html",
    "student-dashboard-stitch.html": "src/pages/common/student-dashboard-stitch.html",
    
    "new-screens": "src/pages/common/new-screens",
    "new-tabs-screens": "src/pages/common/new-tabs-screens",

    "tacliimi_db.js": "src/services/tacliimi_db.js",
    "js": "src/utils/js"
}

REPLACEMENTS = {
    '"../tacliimi_db.js"': '"/src/services/tacliimi_db.js"',
    '"../../tacliimi_db.js"': '"/src/services/tacliimi_db.js"',
    '"/tacliimi_db.js"': '"/src/services/tacliimi_db.js"',
    "'../tacliimi_db.js'": "'/src/services/tacliimi_db.js'",
    "'../../tacliimi_db.js'": "'/src/services/tacliimi_db.js'",
    "'/tacliimi_db.js'": "'/src/services/tacliimi_db.js'",

    '"../js/': '"/src/utils/js/',
    '"../../js/': '"/src/utils/js/',
    '"/js/': '"/src/utils/js/',
    "'../js/": "'/src/utils/js/",
    "'../../js/": "'/src/utils/js/",
    "'/js/": "'/src/utils/js/",
    
    '`/js/': '`/src/utils/js/'
}

for old_name, new_path in MAPPING.items():
    if old_name.endswith('.html') or old_name.endswith('.js'):
        new_root = f"/{new_path}"
        variants = [
            f'"/{old_name}"', f'"../{old_name}"', f'"../../{old_name}"',
            f"'{old_name}'", f"'/{old_name}'", f"'../{old_name}'", f"'../../{old_name}'",
            f"`/{old_name}`", f"`../{old_name}`", f"`../../{old_name}`"
        ]
        for v in variants:
            REPLACEMENTS[v] = f'{v[0]}{new_root}{v[-1]}'
    else:
        new_root = f"/{new_path}"
        variants = [
            f'"/{old_name}/', f'"../{old_name}/', f'"../../{old_name}/',
            f"'{old_name}/", f"'/{old_name}/", f"'../{old_name}/", f"'../../{old_name}/",
            f"`/{old_name}/", f"`../{old_name}/", f"`../../{old_name}/"
        ]
        for v in variants:
            REPLACEMENTS[v] = f'{v[0]}{new_root}/'

# Standalone absolute edge-cases
REPLACEMENTS['href="/index.html"'] = 'href="/src/pages/common/index.html"'
REPLACEMENTS['href="../index.html"'] = 'href="/src/pages/common/index.html"'
REPLACEMENTS["href='/index.html'"] = "href='/src/pages/common/index.html'"
REPLACEMENTS["href='../index.html'"] = "href='/src/pages/common/index.html'"
REPLACEMENTS['window.location.href="/index.html"'] = 'window.location.href="/src/pages/common/index.html"'
REPLACEMENTS["window.location.href='/index.html'"] = "window.location.href='/src/pages/common/index.html'"
REPLACEMENTS["onclick=\"window.location.href='/index.html'\""] = "onclick=\"window.location.href='/src/pages/common/index.html'\""

# Execute Moves
for old_name, new_path in MAPPING.items():
    src_abs = os.path.join(ROOT_DIR, old_name)
    dst_abs = os.path.join(ROOT_DIR, new_path)
    if os.path.exists(src_abs):
        os.makedirs(os.path.dirname(dst_abs), exist_ok=True)
        if os.path.isdir(src_abs):
            if os.path.exists(dst_abs):
                shutil.rmtree(dst_abs)
            shutil.copytree(src_abs, dst_abs)
        else:
            shutil.copy2(src_abs, dst_abs)

# Execute Replacement on NEW files strictly
for root, dirs, files in os.walk(SRC_DIR):
    for filename in files:
        if filename.endswith(".html") or filename.endswith(".js"):
            filepath = os.path.join(root, filename)
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
                
            orig_content = content
            # Sort replacements by length in descending order to avoid generic prefixes overriding longer specific ones
            for old_str in sorted(REPLACEMENTS.keys(), key=len, reverse=True):
                new_str = REPLACEMENTS[old_str]
                content = content.replace(old_str, new_str)
                
            if content != orig_content:
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(content)
                print(f"Patched: {filepath[len(ROOT_DIR):]}")

# Create directories
os.makedirs(PUBLIC_DIR, exist_ok=True)
os.makedirs(os.path.join(SRC_DIR, "components"), exist_ok=True)
os.makedirs(os.path.join(SRC_DIR, "styles"), exist_ok=True)

print("Migration layout built.")
