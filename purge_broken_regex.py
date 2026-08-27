import re
import sys

path = r'c:\Users\salmaan\.gemini\antigravity\Tacliimi\src\pages\instructor\instructor-profile\index.html'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

# 1. Purge all existing definitions of these 3 functions (both window and const)
c = re.sub(r'[ \t]*window\.containsUrl\s*=[^\n]*\n?', '', c)
c = re.sub(r'[ \t]*window\.hasSQLInjection\s*=[^\n]*\n?', '', c)
c = re.sub(r'[ \t]*window\.isTextDirty\s*=[^\n]*\n?', '', c)

c = re.sub(r'[ \t]*const containsUrl\s*=[^\n]*\n?', '', c)
c = re.sub(r'[ \t]*const hasSQLInjection\s*=[^\n]*\n?', '', c)
c = re.sub(r'[ \t]*const isTextDirty\s*=[^\n]*\n?', '', c)

# 2. Inject them safely using RegExp object constructor right at the top of the script blocks
# This avoids any `<script` or `</` HTML parser collision issues in the browser.
injection = """
                    window.containsUrl = (v) => new RegExp("https?:\\\\/\\\\/|www\\\\.|ftp:\\\\/\\\\/|<script|<\\\\/|javascript:", "i").test(v);
                    window.hasSQLInjection = (v) => new RegExp("(['\\"`;]|--|\\\\/\\\\*|\\\\*\\\\/|\\\\bUNION\\\\b|\\\\bSELECT\\\\b|\\\\bDROP\\\\b|\\\\bINSERT\\\\b|\\\\bDELETE\\\\b|\\\\bUPDATE\\\\b|\\\\bEXEC\\\\b|\\\\bXP_\\\\b)", "i").test(v);
                    window.isTextDirty = (v) => v && (window.containsUrl(v) || window.hasSQLInjection(v));
                    
                    const containsUrl = window.containsUrl;
                    const hasSQLInjection = window.hasSQLInjection;
                    const isTextDirty = window.isTextDirty;
"""

# inject at the top of DOMContentLoaded
target = "document.addEventListener('DOMContentLoaded', () => {"
if target in c:
    c = c.replace(target, target + "\n" + injection, 1) # exactly once

with open(path, 'w', encoding='utf-8') as f:
    f.write(c)

print('Cleaned and fixed validation logic.')
