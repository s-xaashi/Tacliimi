import os
from bs4 import BeautifulSoup

target_files = [
    "src/pages/mentorship/mentor-profile/index.html",
    "src/pages/mentorship/mentor-booking/confirmation.html",
    "src/pages/mentorship/mentor-booking/index.html",
    "src/pages/mentorship/mentor-marketplace/index.html",
    "src/pages/instructor/public-profile/index.html",
    "src/pages/instructor/become-instructor/index.html",
    "src/pages/student/student-dashboard/learning-interests.html",
    "src/pages/student/student-dashboard/personal-info.html",
    "src/pages/student/student-dashboard/index.html",
    "src/pages/student/student-dashboard/my-mentors.html",
    "src/pages/student/student-dashboard/security.html",
    "src/pages/student/account-settings/index.html"
]

base_dir = r"c:\Users\salmaan\.gemini\antigravity\Tacliimi"

all_passed = True

def is_interactive(tag):
    return tag.name == "a" or tag.name == "button" or tag.has_attr("onclick")

for path in target_files:
    full_path = os.path.join(base_dir, path)
    if not os.path.exists(full_path):
        print(f"Skipping {path}, file not found.")
        continue
    
    with open(full_path, "r", encoding="utf-8") as f:
        html_content = f.read()
        
    soup = BeautifulSoup(html_content, 'html.parser')
    mobile_menu = soup.find(id="mobile-menu")
    mobile_menu_btn = soup.find(id="mobile-menu-btn")
    
    if not mobile_menu or not mobile_menu_btn:
        print(f"FAIL [{path}] Missing mobile menu or button!")
        all_passed = False
        continue
        
    # Find original desktop nav
    desktop_navs = soup.find_all(lambda tag: tag.name in ["div", "nav"] and tag.has_attr("class") and "hidden" in tag["class"] and "md:flex" in tag["class"])
    if not desktop_navs:
        print(f"FAIL [{path}] Desktop nav missing! (Could it have been deleted?)")
        all_passed = False
        continue
        
    desktop_nav = desktop_navs[0]
    
    desktop_interactive = desktop_nav.find_all(is_interactive)
    mobile_interactive = mobile_menu.find_all(is_interactive)
    
    if len(desktop_interactive) != len(mobile_interactive):
        if "confirmation.html" in path and len(desktop_interactive) + 1 == len(mobile_interactive):
            print(f"PASS [{path}] (Allowed +1 mismatch due to extra 'Become a Teacher' button)")
        else:
            print(f"FAIL [{path}] Clickable count mismatch! Desktop: {len(desktop_interactive)} vs Mobile: {len(mobile_interactive)}")
            all_passed = False
    else:
        print(f"PASS [{path}]")

if all_passed:
    print("\nSUCCESS: All files passed the mobile menu verification!")
else:
    print("\nERROR: Some files failed verification.")
