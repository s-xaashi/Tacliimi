import os
import re
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

script_to_inject = """
  <!-- Mobile Menu Toggle Script -->
  <script>
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileMenuBtn && mobileMenu) {
        mobileMenuBtn.addEventListener('click', () => {
            mobileMenu.classList.toggle('hidden');
        });
    }
  </script>
"""

HAMBURGER_HTML = """
          <button class="md:hidden p-2 text-slate-600 dark:text-slate-300" id="mobile-menu-btn">
            <span class="material-symbols-outlined">menu</span>
          </button>"""

def find_closing_tag(text, start_idx, tag_name="div"):
    # Extremely basic parser for finding closing tag of a div
    depth = 0
    tag_pattern = re.compile(f'</?{tag_name}[^>]*>', re.IGNORECASE)
    pos = start_idx
    for match in tag_pattern.finditer(text, pos):
        if match.group(0).startswith('</'):
            depth -= 1
        else:
            depth += 1
            
        if depth == 0:
            return match.end()
    return -1

for path in target_files:
    full_path = os.path.join(base_dir, path)
    if not os.path.exists(full_path):
        print(f"Skipping {path}, file not found.")
        continue
    
    with open(full_path, "r", encoding="utf-8") as f:
        html_content = f.read()

    if "id=\"mobile-menu-btn\"" in html_content:
        print(f"[{path}] already has mobile-menu-btn!")
        continue

    # Use soup to parse but purely non-destructively by extracting info
    soup = BeautifulSoup(html_content, 'html.parser')
    desktop_navs = soup.find_all(lambda tag: tag.name == "div" and tag.has_attr("class") and "hidden" in tag["class"] and "md:flex" in tag["class"])
    
    if not desktop_navs:
        print(f"[{path}] desktop nav not found!")
        continue
        
    desktop_nav = desktop_navs[0]
    
    # Construct mobile menu links
    mobile_menu_links_html = []
    
    interactive_elements = desktop_nav.find_all(lambda t: t.name == "a" or t.name == "button" or t.has_attr("onclick"))
    for elem in interactive_elements:
        href_attr = ''
        
        # Use str(elem) inside BeautifulSoup to see what properties we can extract
        if elem.has_attr("href"):
            href_attr = f'href="{elem["href"]}"'
        elif elem.has_attr("onclick"):
            match = re.search(r"window\.location\.href\s*=\s*'([^']+)'", str(elem['onclick']))
            if match:
                href_attr = f'href="{match.group(1)}"'
            else:
                href_attr = f'onclick="{elem["onclick"]}" href="javascript:void(0);"'
                
        # Inner content (strip leading/trailing space around it)
        # However if it's got HTML, let's keep it. 
        # But wait, what if it's the profile circle?
        # A profile icon doesn't have text. So we'll just take the innerHTML of `elem`.
        
        # The user has explicitly stated they want: 
        # class="block text-base font-medium text-slate-700 dark:text-slate-200 hover:text-primary transition-colors"
        
        content = elem.decode_contents().strip()
        link_str = f'    <a class="block text-base font-medium text-slate-700 dark:text-slate-200 hover:text-primary transition-colors" {href_attr}>{content}</a>'
        mobile_menu_links_html.append(link_str)
        
    mobile_menu_inner = "\n".join(mobile_menu_links_html)
    
    mobile_menu_div = f"""
  <!-- Mobile Menu -->
  <div class="hidden md:hidden bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-4 py-6 space-y-4 absolute w-full shadow-xl z-40" id="mobile-menu">
{mobile_menu_inner}
  </div>"""

    # Do the raw string replacement
    
    # Find exact string of the desktop nav opening tag to locate it block in raw text
    # Search for anything that resembles the class list we found
    match = re.search(r'<div[^>]*class="[^"]*hidden[^"]*md:flex[^"]*"[^>]*>', html_content)
    if not match:
         print(f"[{path}] Regex failed to find desktop nav open tag")
         continue
         
    nav_open_idx = match.start()
    nav_close_idx = find_closing_tag(html_content, nav_open_idx, "div")
    if nav_close_idx == -1:
        print(f"[{path}] Couldn't find closing tag for desktop nav")
        continue

    # Insert Hamburger after desktop_nav closing tag
    new_html = html_content[:nav_close_idx] + HAMBURGER_HTML + html_content[nav_close_idx:]

    # Insert mobile-menu BEFORE </nav>
    nav_end = new_html.find("</nav>")
    if nav_end != -1:
        new_html = new_html[:nav_end] + mobile_menu_div + "\n  " + new_html[nav_end:]
    else:
        print(f"[{path}] Countn't find </nav>")
        continue
        
    # Insert Script BEFORE </body>
    body_end = new_html.find("</body>")
    if body_end != -1:
        new_html = new_html[:body_end] + script_to_inject + new_html[body_end:]
    else:
        print(f"[{path}] Couldn't find </body>")
        continue

    # Save
    with open(full_path, "w", encoding="utf-8") as f:
        f.write(new_html)
    print(f"[{path}] Successfully processed.")

