import re
import sys

path = r'c:\Users\salmaan\.gemini\antigravity\Tacliimi\src\pages\instructor\instructor-profile\index.html'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

# First, remove existing re-definitions that might be in the teaching tab
c = re.sub(r'const containsUrl\s*= \(v\) => /https\?:\\/\\/\|www\\\.\|ftp:\\/\\/\|<script|<\\/\|javascript:/i\.test\(v\);', '', c)
c = re.sub(r'const hasSQLInjection\s*= \(v\) => /\(\[\'\"`\;]\|--\|\\/\\*\|\\*\\/\|\\bUNION\\b\|\\bSELECT\\b\|\\bDROP\\b\|\\bINSERT\\b\|\\bDELETE\\b\|\\bUPDATE\\b\|\\bEXEC\\b\|\\bXP_\\b\)/i\.test\(v\);', '', c)
c = re.sub(r'const isTextDirty\s*= \(v\) => v && \(containsUrl\(v\) \|\| hasSQLInjection\(v\)\);', '', c)

# Instead, insert them at the top of the JS block 
target = "document.addEventListener('DOMContentLoaded', () => {"
new_code = """
window.containsUrl = (v) => /https?:\\/\\/|www\\.|ftp:\\/\\/|<script|<\\/|javascript:/i.test(v);
window.hasSQLInjection = (v) => /(['"`;]|--|\\/\\*|\\*\\/|\\bUNION\\b|\\bSELECT\\b|\\bDROP\\b|\\bINSERT\\b|\\bDELETE\\b|\\bUPDATE\\b|\\bEXEC\\b|\\bXP_\\b)/i.test(v);
window.isTextDirty = (v) => v && (window.containsUrl(v) || window.hasSQLInjection(v));
"""

# Also ensure local constant bindings exist in the exact teaching scope where `showTFieldError` is
target2 = "const showTFieldError = (inputEl, msg) => {"
new_code2 = """
                    const containsUrl = window.containsUrl;
                    const hasSQLInjection = window.hasSQLInjection;
                    const isTextDirty = window.isTextDirty;
"""

if target in c:
    c = c.replace(target, target + new_code)
if target2 in c:
    c = c.replace(target2, new_code2 + target2)

with open(path, 'w', encoding='utf-8') as f:
    f.write(c)

print('Done applying global validation fixes.')
