const fs = require('fs');
const path = 'src/pages/student/account-settings/index.html';

let content = fs.readFileSync(path, 'utf8');

// 1. Remove Display Name block
const displayBlockRegex = /<div class="space-y-2">\s*<label[^>]*for="display-name"[^>]*>Display Name<\/label>\s*<input[^>]*id="display-name"[^>]*\/>\s*<\/div>/g;
content = content.replace(displayBlockRegex, '');

// 2. Disable email field since we'll map it to session email
const emailRegex = /(<input[^>]*id="email"[^>]*)(>|\/>)/g;
content = content.replace(emailRegex, '$1 readonly disabled style="opacity: 0.7; cursor: not-allowed;" $2');

// 3. Remove TacliimiDB script and old inline scripts
// We'll replace everything from `<script>` containing switchMentorsTab to the end before </body>
const scriptRegex = /<script>[\s\S]*?switchMentorsTab[\s\S]*?<\/script>\s*<script>[\s\S]*?handleProfileUpload[\s\S]*?<\/script>/g;
content = content.replace(scriptRegex, '');

// Also remove globalProfile if it exists (since we handle it in accountSettings.js)
const globalProfileRegex = /<script type="module" src="\/src\/services\/globalProfile\.js"><\/script>/g;
content = content.replace(globalProfileRegex, '');

// Insert new script module before </body>
if (!content.includes('accountSettings.js')) {
    content = content.replace('</body>', '    <script type="module" src="./accountSettings.js"></script>\n</body>');
}

fs.writeFileSync(path, content);
console.log("Patched successfully!");
