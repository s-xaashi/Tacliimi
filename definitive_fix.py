import re

path = r'c:\Users\salmaan\.gemini\antigravity\Tacliimi\src\pages\instructor\instructor-profile\index.html'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

print(f"File size before: {len(c)}")

# ─── STEP 1: Remove ALL injected window.* validation and duplicated const aliases ───
c = re.sub(r'\n[ \t]*window\.containsUrl[^\n]*', '', c)
c = re.sub(r'\n[ \t]*window\.hasSQLInjection[^\n]*', '', c)
c = re.sub(r'\n[ \t]*window\.isTextDirty[^\n]*', '', c)
c = re.sub(r'\n[ \t]*const containsUrl = window\.containsUrl;[^\n]*', '', c)
c = re.sub(r'\n[ \t]*const hasSQLInjection = window\.hasSQLInjection;[^\n]*', '', c)
c = re.sub(r'\n[ \t]*const isTextDirty = window\.isTextDirty;[^\n]*', '', c)

# ─── STEP 2: Remove all standalone stray | lines (artifact from bad regex substitution) ───
c = re.sub(r'\n[ \t]*\|[ \t]*\n', '\n', c)

# ─── STEP 3: Remove any remaining broken local const definitions that reference old helpers ───
# These were left orphaned in the personal/teaching tab blocks
c = re.sub(r'\n[ \t]*const containsUrl\s*=\s*\(v\)[^\n]*', '', c)
c = re.sub(r'\n[ \t]*const hasSQLInjection\s*=\s*\(v\)[^\n]*', '', c)
c = re.sub(r'\n[ \t]*const isTextDirty\s*=\s*\(v\)[^\n]*', '', c)

# ─── STEP 4: Re-inject ONE clean set of helpers, using RegExp() constructor so
# the HTML parser never sees the literal </  inside a <script> block ───
# We place them right after `document.addEventListener('DOMContentLoaded', () => {`
clean_injection = "\n" + """\
            // ── Global security validation helpers ─────────────────────────────────
            // Using RegExp() constructor to prevent the HTML parser from misreading
            // regex literals containing `</` and treating them as closing </script> tags.
            window.containsUrl = function(v) {
                return new RegExp('https?:\\\\/\\\\/|www\\\\.|ftp:\\\\/\\\\/|javascript:', 'i').test(v);
            };
            window.hasSQLInjection = function(v) {
                return new RegExp("(['\"`]|--|/\\\\*|\\\\*/|\\\\bUNION\\\\b|\\\\bSELECT\\\\b|\\\\bDROP\\\\b|\\\\bINSERT\\\\b|\\\\bDELETE\\\\b|\\\\bUPDATE\\\\b|\\\\bEXEC\\\\b)", 'i').test(v);
            };
            window.isTextDirty = function(v) {
                return v && (window.containsUrl(v) || window.hasSQLInjection(v));
            };
"""

target = "document.addEventListener('DOMContentLoaded', () => {"
c = c.replace(target, target + clean_injection, 1)

# ─── STEP 5: Where local code now uses bare containsUrl / hasSQLInjection
# make them call window.*, since local const aliases were removed ───
# Replace bare calls that aren't already prefixed
c = re.sub(r'\bcontainsUrl\(', 'window.containsUrl(', c)
c = re.sub(r'\bhasSQLInjection\(', 'window.hasSQLInjection(', c)
c = re.sub(r'\bisTextDirty\(', 'window.isTextDirty(', c)

print(f"File size after: {len(c)}")

with open(path, 'w', encoding='utf-8') as f:
    f.write(c)

print("Done.")
