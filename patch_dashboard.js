const fs = require('fs');
const path = 'src/pages/student/student-dashboard/index.html';
let content = fs.readFileSync(path, 'utf8');

const scriptRegex = /<script>[\s\S]*?function switchDashboardTab[\s\S]*?<\/script>/g;
content = content.replace(scriptRegex, '');

const modScriptRegex = /<script type="module" src="\/src\/services\/globalProfile\.js"><\/script>\s*<script>[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>/;
content = content.replace(modScriptRegex, '');

const inlineOAuthRegex = /<script type="module">\s*import \{ AuthService \} from[\s\S]*?<\/script>/g;
content = content.replace(inlineOAuthRegex, '');

if (!content.includes('dashboard.js')) {
    content = content.replace('</body>', '    <script type="module" src="./dashboard.js"></script>\n</body>');
}

fs.writeFileSync(path, content);
console.log("Dashboard patched successfully!");
