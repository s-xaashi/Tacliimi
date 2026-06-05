import re

def patch_dashboard():
    with open("src/pages/student/student-dashboard/index.html", "r", encoding="utf-8") as f:
        text = f.read()

    # Replace globalProfile script
    text = re.sub(r'<script type="module" src="/src/services/globalProfile\.js"></script>', '', text)
    
    # Remove inline OAuth script
    text = re.sub(r'<script type="module">\s*import \{ AuthService \} from[\s\S]*?</script>', '', text)

    # Replace the inner script containing switchDashboardTab
    text = re.sub(r'<script>\s*function switchDashboardTab[\s\S]*?</script>', '', text)

    # Insert the dashboard module before </body>
    if 'dashboard.js' not in text:
        text = text.replace('</body>', '    <script type="module" src="./dashboard.js"></script>\n</body>')

    with open("src/pages/student/student-dashboard/index.html", "w", encoding="utf-8") as f:
        f.write(text)

def patch_account():
    with open("src/pages/student/account-settings/index.html", "r", encoding="utf-8") as f:
        text = f.read()

    # Remove display name div
    display_name_div = r'<div class="space-y-2">\s*<label class="text-sm font-bold text-slate-700 dark:text-slate-300"\s*for="display-name">Display Name</label>\s*<input[^>]*id="display-name"[^>]*/>\s*</div>'
    text = re.sub(display_name_div, '', text)

    # Remove globalProfile script
    text = re.sub(r'<script type="module" src="/src/services/globalProfile\.js"></script>', '', text)

    # Remove script switchMentorsTab
    text = re.sub(r'<script>\s*function switchMentorsTab[\s\S]*?</script>', '', text)

    # Remove handleProfileUpload script
    text = re.sub(r'<script>\s*function handleProfileUpload[\s\S]*?</script>', '', text)

    # Disable Email
    text = re.sub(r'(<input[^>]*id="email"[^>]*)(>|/>)', r'\1 readonly disabled style="opacity: 0.7; cursor: not-allowed;" \2', text)

    # Insert the accountSettings module before </body>
    if 'accountSettings.js' not in text:
        text = text.replace('</body>', '    <script type="module" src="./accountSettings.js"></script>\n</body>')

    with open("src/pages/student/account-settings/index.html", "w", encoding="utf-8") as f:
        f.write(text)

if __name__ == "__main__":
    patch_dashboard()
    patch_account()
    print("Patched completely!")
