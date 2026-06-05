const fs = require('fs');
let file = 'c:/Users/salmaan/.gemini/antigravity/Tacliimi/src/pages/instructor/instructor-dashboard/index.html';
let content = fs.readFileSync(file, 'utf8');

// 1. apply CSS classes so TacliimiDB picks up the username properly
content = content.replace('<p class="text-sm font-medium dark:text-white">Instructor account</p>', '<p class="user-display-name text-sm font-medium dark:text-white">Instructor account</p>');
content = content.replace('<p class="text-xs text-slate-500">ID: 32342</p>', '<p class="text-xs text-slate-500" data-role="profile-meta">ID: 32342</p>');

// 2. fix the mandatory profile blocker script bug
const oldScriptStart = "<script>";
const oldScriptEnd = "</script>";
const targetComment = "// session handled globally";

if (content.includes(targetComment)) {
    // We are going to carefully replace the whole script block
    const regex = /<script>\s*document\.addEventListener\('DOMContentLoaded', \(\) => {\s*\/\/ session handled globally[\s\S]*?<\/script>/g;

    const newScript = `
            <script type="module">
                import { AuthService } from '/src/services/authService.js';
                
                document.addEventListener('DOMContentLoaded', async () => {
                    try {
                        const session = await AuthService.getSession();
                        if (session) {
                            const profile = await AuthService.getCurrentProfile();
                            // If profile has no short bio or missing title, force them to complete it
                            const needsCompletion = profile && profile.role === 'instructor' && (!profile.short_bio || !profile.professional_title);
                            
                            if (needsCompletion) {
                                const blocker = document.getElementById('mandatory-profile-blocker');
                                if (blocker) {
                                    blocker.classList.remove('hidden');
                                    blocker.classList.add('flex');
                                    document.body.style.overflow = 'hidden'; // Prevent scrolling
                                }
                            }
                        }
                    } catch (e) {
                         console.error("Error checking profile completion:", e);
                    }
                });
            </script>`;

    content = content.replace(regex, newScript.trim());
}

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed instructor dashboard successfully');
