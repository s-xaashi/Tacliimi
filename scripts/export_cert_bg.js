const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: 1400, height: 990 }
  });
  const page = await context.newPage();

  const filePath = path.resolve('public', 'assets', 'certificate-background.source.html');
  await page.goto('file://' + filePath, { waitUntil: 'load' });

  // Wait for web fonts (Fraunces / Caveat) to fully render
  await page.waitForTimeout(2000);

  const fields = [
    'studentPhoto', 'studentName', 'courseName', 'dateCompleted',
    'quizScore', 'instructorSignature', 'instructorName',
    'verificationCode', 'dateIssued'
  ];

  // Extract coords
  const coords = await page.evaluate((fieldList) => {
    const data = {};
    fieldList.forEach(f => {
      const el = document.querySelector(`[data-field="${f}"]`);
      if (el) {
        const rect = el.getBoundingClientRect();
        // Since deviceScaleFactor is 2, multiply by 2 for the final render size
        const cx = (rect.left + rect.width / 2) * 2;
        const cy = (rect.top + rect.height / 2) * 2;
        data[f] = { x: Math.round(cx), y: Math.round(cy) };
        if (f === 'studentPhoto') {
          data[f].r = Math.round((rect.width / 2) * 2);
        }
      }
    });
    return data;
  }, fields);

  console.log('EXTRACTED COORDS:');
  console.log(JSON.stringify(coords, null, 2));

  // Blank out dynamic fields so the background PNG is clean
  await page.evaluate((fieldList) => {
    fieldList.forEach(f => {
      const el = document.querySelector(`[data-field="${f}"]`);
      if (el) {
        if (el.tagName === 'IMG') {
          el.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        } else {
          el.innerHTML = '';
        }
      }
    });
  }, fields);

  const imgDest = path.resolve('public', 'assets', 'images', 'certificate-background.png');
  fs.mkdirSync(path.dirname(imgDest), { recursive: true });

  // Screenshot only the cert wrap — no outer padding or body whitespace
  await page.locator('#certWrap').screenshot({ path: imgDest });

  await browser.close();
  console.log('Exported certificate background to ' + imgDest);
})();
