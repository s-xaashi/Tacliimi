import re

path = r'c:\Users\salmaan\.gemini\antigravity\Tacliimi\src\pages\instructor\instructor-profile\index.html'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

# 1. Make validation helpers accessible globally on `window`
c = c.replace(
    r"const containsUrl    = (v) => /https?:\/\/|www\.|ftp:\/\/|<script|<\/|javascript:/i.test(v);",
    "window.containsUrl = (v) => /https?:\\/\\/|www\\.|ftp:\\/\\/|<script|<\\/|javascript:/i.test(v);\n                    const containsUrl = window.containsUrl;"
)

c = c.replace(
    r"const hasSQLInjection = (v) => /(['\"`;]|--|\/\*|\*\/|\bUNION\b|\bSELECT\b|\bDROP\b|\bINSERT\b|\bDELETE\b|\bUPDATE\b|\bEXEC\b|\bXP_\b)/i.test(v);",
    "window.hasSQLInjection = (v) => /(['\"`;]|--|\\/\\*|\\*\\/|\\bUNION\\b|\\bSELECT\\b|\\bDROP\\b|\\bINSERT\\b|\\bDELETE\\b|\\bUPDATE\\b|\\bEXEC\\b|\\bXP_\\b)/i.test(v);\n                    const hasSQLInjection = window.hasSQLInjection;"
)

c = c.replace(
    r"const isTextDirty    = (v) => v && (containsUrl(v) || hasSQLInjection(v));",
    "window.isTextDirty = (v) => v && (window.containsUrl(v) || window.hasSQLInjection(v));\n                    const isTextDirty = window.isTextDirty;"
)

# Replace local usages inside the security section with window calls
c = c.replace("isTextDirty(currPw)", "window.isTextDirty(currPw)")
c = c.replace("isTextDirty(newPw)", "window.isTextDirty(newPw)")

# 2. Add TOS Checkbox saving to the Updates object if the security panel is being saved
c = c.replace(
    """if (newPw || confirmPw) {""",
    """updates.agreed_to_instructor_tos = tosCheckbox.checked;\n                    if (newPw || confirmPw) {"""
)

# 3. Add TOS Checkbox hydration during populateForm
populateStr = "const populateForm = (profile) => {"
populateNew = "const populateForm = (profile) => {\n                const tos = document.getElementById('tos-checkbox');\n                if (tos && profile.agreed_to_instructor_tos !== undefined) { tos.checked = profile.agreed_to_instructor_tos; }"
c = c.replace(populateStr, populateNew)

with open(path, 'w', encoding='utf-8') as f:
    f.write(c)

print("Replacements done.")
