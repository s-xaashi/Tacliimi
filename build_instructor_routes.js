const fs = require('fs');
const path = require('path');

const shellHtml = fs.readFileSync('instructor-layout-shell.html', 'utf8');

// The marker where we want to insert the content
const shellStart = shellHtml.split('<main id="instructor-content-area" class="flex-1 bg-background-light dark:bg-background-dark pb-20">')[0] + '<main id="instructor-content-area" class="flex-1 bg-background-light dark:bg-background-dark pb-20">\n';
const shellEnd = '\n        </main>' + shellHtml.split('</main>')[1];

function extractMainContent(filePath) {
    if (!fs.existsSync(filePath)) return '<div class="p-8 text-center text-slate-500">Placeholder Content</div>';
    const htmlText = fs.readFileSync(filePath, 'utf8');
    // Basic extraction
    let match = htmlText.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    let content = match ? match[1] : '<div class="p-8 text-center text-slate-500">Content not found in raw file</div>';

    // Strip out the custom <header> block from the inner content
    content = content.replace(/<header[\s\S]*?<\/header>/i, '');

    // Reduce the top padding of the primary container to fix "extra space on top"
    content = content.replace(/<div\s+class="([^"]*?)\bp-([0-9]+)\b([^"]*?)"/i, '<div class="$1px-$2 pb-$2 pt-2$3"');

    return content;
}

function buildRoute(routeDir, rawHtmlFile, pageTitle) {
    const fullDir = path.join(__dirname, routeDir);
    if (!fs.existsSync(fullDir)) fs.mkdirSync(fullDir, { recursive: true });

    let innerContent = extractMainContent(path.join(__dirname, 'instructor-screens', rawHtmlFile));

    // Construct final layout with inner content only
    let finalHtml = shellStart + innerContent + shellEnd;
    finalHtml = finalHtml.replace(/<h1 class="text-lg font-semibold dark:text-white" id="header-page-title">Dashboard<\/h1>/, `<h1 class="text-lg font-semibold dark:text-white" id="header-page-title">${pageTitle}</h1>`);

    fs.writeFileSync(path.join(fullDir, 'index.html'), finalHtml);
    console.log(`Built ${routeDir}`);
}

// 1. Dashboard
buildRoute('instructor-dashboard', '45182b4c062c432eb96953e3663de372.html', 'Dashboard');

// 2. Mentorship
buildRoute('instructor-mentorship', '5da199345aac4b9a9eeea599b145b8a3.html', 'Mentorship');

// 3. Availability
buildRoute('instructor-availability', '30a1362908484c6795e2fcb9cfaad75c.html', 'Availability');

// 4. Other Routes
buildRoute('instructor-courses', '3ad8e206ba9a49bc8b2de2a741a74f89.html', 'My Courses');
buildRoute('instructor-analytics', '4dd1d91246944f74bc6e9f6f8b0bc80b.html', 'Analytics');
buildRoute('instructor-earnings', '292a0949103144058b163b2be33531dc.html', 'Earnings');
buildRoute('instructor-communications', '2d566d4517b0485c92296e8103e99ff0.html', 'Communications');

// 5. Out-of-shell instructor pages (Landing, Register, Login)
function copyStandalonePage(fileName, destFolder) {
    const srcPath = path.join(__dirname, 'instructor-screens', fileName);
    const destPath = path.join(__dirname, destFolder);
    if (!fs.existsSync(destPath)) fs.mkdirSync(destPath, { recursive: true });
    fs.copyFileSync(srcPath, path.join(destPath, 'index.html'));
    console.log(`Copied ${fileName} to ${destFolder}`);
}

copyStandalonePage('7e590e09009c49598fc8c1ac30287720.html', 'become-instructor');
copyStandalonePage('9dde7afcb48d4ec9be5631a6795bcf5c.html', 'instructor-register');
copyStandalonePage('instructor-login-native.html', 'instructor-login');
copyStandalonePage('88ece1ea2abf4837beddcca76120fe45.html', 'user-login');
copyStandalonePage('user-register-native.html', 'user-register');

console.log('Done.');
