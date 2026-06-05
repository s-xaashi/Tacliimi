const fs = require('fs');
const file = 'c:/Users/salmaan/.gemini/antigravity/Tacliimi/src/pages/instructor/instructor-profile/index.html';
let content = fs.readFileSync(file, 'utf8');

const regex = /<script>\s*function handleProfileUpload\(event\) {[\s\S]*?function removeProfileImage\(\) {[\s\S]*?<\/script>/;

const replacement = `
    <script type="module">
        import { AuthService } from '/src/services/authService.js';
        
        window.handleProfileUpload = async function(event) {
            const file = event.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onloadend = async () => {
                    const base64String = reader.result;
                    try {
                        const loadingToast = document.createElement('div');
                        loadingToast.id = 'avatar-loading-toast';
                        loadingToast.className = 'fixed bottom-4 right-4 bg-slate-800 text-white px-4 py-2 rounded shadow-lg z-50 flex items-center gap-2';
                        loadingToast.innerHTML = '<span class="material-symbols-outlined animate-spin">refresh</span> Uploading image...';
                        document.body.appendChild(loadingToast);

                        await AuthService.updateProfile({ avatar_url: base64String });
                        if (window.currentProfile) {
                            window.currentProfile.avatar_url = base64String;
                        }

                        // Force DOM update directly to bypass querySelector issues with generic elements on this page
                        const mainProfileNode = document.querySelector('.size-24');
                        if (mainProfileNode) {
                            mainProfileNode.innerHTML = \`<img src="\${base64String}" class="w-full h-full object-cover rounded-full" />\`;
                            mainProfileNode.classList.add('overflow-hidden');
                        }
                        
                        document.body.removeChild(loadingToast);
                        
                        // Also update global header if TacliimiDB is present
                        if (typeof TacliimiDB !== 'undefined' && TacliimiDB.applyGlobalProfile) {
                             TacliimiDB.applyGlobalProfile();
                        }
                    } catch (err) {
                        alert("Failed to upload image: " + err.message);
                        if (document.getElementById('avatar-loading-toast')) {
                            document.getElementById('avatar-loading-toast').remove();
                        }
                    }
                };
                reader.readAsDataURL(file);
            }
        }

        window.removeProfileImage = async function() {
            try {
                const loadingToast = document.createElement('div');
                loadingToast.id = 'avatar-loading-toast';
                loadingToast.className = 'fixed bottom-4 right-4 bg-slate-800 text-white px-4 py-2 rounded shadow-lg z-50 flex items-center gap-2';
                loadingToast.innerHTML = '<span class="material-symbols-outlined animate-spin">refresh</span> Removing image...';
                document.body.appendChild(loadingToast);

                await AuthService.updateProfile({ avatar_url: null });
                if (window.currentProfile) {
                    window.currentProfile.avatar_url = null;
                }

                const placeholderHtml = \`<span class="material-symbols-outlined text-slate-300 dark:text-slate-600 text-5xl">person</span>\`;
                const mainProfileNode = document.querySelector('.size-24');
                if (mainProfileNode) {
                    mainProfileNode.innerHTML = placeholderHtml;
                    mainProfileNode.classList.remove('overflow-hidden');
                }
                
                document.body.removeChild(loadingToast);
                
                // Also update global header if TacliimiDB is present
                if (typeof TacliimiDB !== 'undefined' && TacliimiDB.applyGlobalProfile) {
                     TacliimiDB.applyGlobalProfile();
                }
            } catch (err) {
                alert("Failed to remove image: " + err.message);
                if (document.getElementById('avatar-loading-toast')) {
                    document.getElementById('avatar-loading-toast').remove();
                }
            }
        }
    </script>
`;

content = content.replace(regex, replacement.trim());
fs.writeFileSync(file, content, 'utf8');
console.log('Fixed avatar upload logic');
