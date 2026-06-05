const fs = require('fs');
const path = require('path');

const walk = (dir, done) => {
    let results = [];
    fs.readdir(dir, (err, list) => {
        if (err) return done(err);
        let pending = list.length;
        if (!pending) return done(null, results);
        list.forEach((file) => {
            file = path.resolve(dir, file);
            fs.stat(file, (err, stat) => {
                if (stat && stat.isDirectory()) {
                    walk(file, (err, res) => {
                        results = results.concat(res);
                        if (!--pending) done(null, results);
                    });
                } else {
                    if (file.endsWith('.html')) {
                        results.push(file);
                    }
                    if (!--pending) done(null, results);
                }
            });
        });
    });
};

const newGuardScript = `
    <script type="module">
        import { AuthService } from '/src/services/authService.js';
        
        // If the URL contains an access token from an email link or OAuth, do not prematurely redirect
        const isOAuthRedirect = window.location.hash.includes('access_token=');
        
        if (!isOAuthRedirect) {
            AuthService.getSession().then(session => {
                if (!session) window.location.href = '/src/pages/auth/login-select/index.html';
            });
        }
    </script>
`;

walk(path.join(__dirname, '..', 'src', 'pages'), (err, results) => {
    if (err) throw err;
    let count = 0;
    results.forEach(file => {
        let content = fs.readFileSync(file, 'utf8');
        let modified = false;

        // Detect old module script
        const oldModuleRegex = /<script type="module">\s*import { AuthService } from '\/src\/services\/authService\.js';\s*AuthService\.getSession\(\)\.then\(session => {\s*if \(!session\) window\.location\.href = '\/src\/pages\/auth\/login-select\/index\.html';\s*}\);\s*<\/script>/gs;

        if (oldModuleRegex.test(content)) {
            content = content.replace(oldModuleRegex, newGuardScript.trim());
            modified = true;
        }

        if (modified) {
            fs.writeFileSync(file, content, 'utf8');
            console.log('Fixed auth guard in:', file);
            count++;
        }
    });
    console.log('Total files fixed:', count);
});
