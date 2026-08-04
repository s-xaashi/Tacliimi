"""
audit_admin_pages.py
Audits all admin pages to check for mobile nav implementation.
Reports back if it's missing, or if it uses the wrong breakpoint.
"""
import os, glob
from bs4 import BeautifulSoup

ADMIN_ROOT = r"c:\Users\salmaan\.gemini\antigravity\Tacliimi\src\pages\admin"

def audit_file(path):
    with open(path, encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")
        
    aside = soup.find("aside")
    hamburger = soup.find(id="toggle-sidebar") or soup.find(id="admin-mobile-menu-btn")
    overlay = soup.find(id="sidebar-overlay")
    
    if not aside:
        return "No aside found"
    
    classes = aside.get("class", [])
    classes_str = " ".join(classes)
    
    if "hidden" in classes and "lg:flex" in classes:
        # It's hidden on mobile, lg:flex on desktop, but is it offcanvas?
        if "-translate-x-full" not in classes:
            return "Uses hidden lg:flex (completely vanishes on mobile)"
    
    if "md:" in classes_str:
        return "Uses md: breakpoint"
        
    if not hamburger:
        return "Missing hamburger button"
        
    if not overlay:
        return "Missing overlay"
        
    # Check if aside has offcanvas classes
    if "-translate-x-full" in classes and "lg:translate-x-0" in classes:
        return "OK (Offcanvas with lg: breakpoint)"
        
    return f"Unknown state: {classes_str}"

print(f"{'Page':<50} | {'Status'}")
print("-" * 80)
for file in glob.glob(os.path.join(ADMIN_ROOT, "**", "*.html"), recursive=True):
    rel_path = os.path.relpath(file, ADMIN_ROOT)
    status = audit_file(file)
    print(f"{rel_path:<50} | {status}")
