path = r'c:\Users\salmaan\.gemini\antigravity\Tacliimi\src\pages\instructor\instructor-profile\index.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

import re

# Find the big script block (the one containing the profile logic)
# Check for any </ sequences that aren't </script> or HTML tags in template literals

# Just report all lines containing '</' inside JS context
lines = content.splitlines()
in_main_script = False

for i, line in enumerate(lines):
    lineno = i + 1
    # detect the main profile module script start
    if "document.addEventListener('DOMContentLoaded'" in line:
        in_main_script = True
    # Look for </ which could kill the parser
    if in_main_script and '</' in line:
        # exclude template literals where we are intentionally rendering HTML
        if 'row.innerHTML' not in line and 'tb.innerHTML' not in line and 'securityErr' not in line and 'innerHTML' not in line:
            print(f"Line {lineno}: {line.strip()[:120]}")

print("Scan complete.")
