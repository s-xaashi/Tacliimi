const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    await page.setViewportSize({ width: 1600, height: 1200 });
    const htmlPath = 'file://' + path.resolve(__dirname, 'tacliimi_certificate_v2 (1).html').replace(/\\/g, '/');
    await page.goto(htmlPath);

    // Hide dynamic field guides and corner marks for a clean background export
    await page.evaluate(() => {
        document.body.classList.remove('show-guides');
        document.querySelectorAll('.corner-mark, .field-guide, #guideToggle').forEach(el => el.style.display = 'none');
        
        // Also clear any text from the dynamic fields so they don't get baked into the background
        document.querySelector('.student-name').innerText = '';
        document.querySelector('.course-name').innerText = '';
        document.querySelector('.completed-line').innerText = '';
        const stats = document.querySelectorAll('.stat-value');
        if (stats.length >= 2) {
            stats[0].innerText = ''; // date
            stats[1].innerText = ''; // score
        }
        document.querySelector('.sign-script').innerText = '';
        document.querySelector('.sign-name').innerText = '';
        document.querySelector('.verify-code').innerText = '';
        document.querySelector('.issued-value a').innerText = '';
        document.querySelector('.photo-circle').style.background = 'transparent';
        document.querySelector('.photo-circle').innerText = '';
    });

    // Wait for fonts to load
    await page.waitForLoadState('networkidle');

    // Take screenshot of the exact cert-wrap element at 2x scale
    const certWrap = await page.$('.cert-wrap');
    await certWrap.screenshot({ path: path.join(__dirname, 'public/assets/images/certificate-background.png') });
    // Note: Playwright's `scale: 'css'` uses deviceScaleFactor. Let's explicitly set viewport scale if needed.
    
    await browser.close();
})();
