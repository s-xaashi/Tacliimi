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

const guardScript = `
    <script type="module">
        import { AuthService } from '/src/services/authService.js';
        AuthService.getSession().then(session => {\n            if (!session) window.location.href = '/src/pages/auth/login-select/index.html';\n        });
    </script>
`;

walk(path.join(__dirname, '..', 'src', 'pages'), (err, results) => {
    if (err) throw err;
    let count = 0;
    results.forEach(file => {
        let content = fs.readFileSync(file, 'utf8');
        let modified = false;

        // Detect Top level checks
        const checkRegex = /if\s*\(!TacliimiDB\.getCurrentSession\(\)\)\s*window\.location\.href\s*=\s*'\/src\/pages\/auth\/login\/index\.html';/g;

        if (checkRegex.test(content)) {
            content = content.replace(checkRegex, '// Removed synchronous Auth check');

            // Inject module script
            if (!content.includes('AuthService.getSession()')) {
                content = content.replace('</head>', guardScript + '\n</head>');
            }
            modified = true;
        }

        // Detect floating inline session requests
        const sessionGetRegex = /const session = TacliimiDB\.getCurrentSession\(\);/g;
        if (sessionGetRegex.test(content) && !file.includes('instructor-register') && !file.includes('instructor-login') && !file.includes('user-register') && !file.includes('user-login')) {
            content = content.replace(sessionGetRegex, '// session handled globally');
            modified = true;
        }

        if (modified) {
            fs.writeFileSync(file, content, 'utf8');
            console.log('Updated guards in:', file);
            count++;
        }
    });
    console.log('Total files updated:', count);
});
