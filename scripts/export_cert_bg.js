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
  
  const filePath = path.resolve('tacliimi_certificate_v2 (1).html');
  await page.goto('file://' + filePath, { waitUntil: 'load' });
  
  // Wait a bit for fonts to load
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
  
  console.log("EXTRACTED COORDS:");
  console.log(JSON.stringify(coords, null, 2));

  // Blank out fields
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
    // Turn off field guides if any
    const guides = document.querySelectorAll('.field-guide-overlay');
    guides.forEach(g => g.style.display = 'none');
  }, fields);
  
  const modifiedHtml = await page.content();
  const sourceDest = path.resolve('public', 'assets', 'certificate-background.source.html');
  fs.mkdirSync(path.dirname(sourceDest), { recursive: true });
  fs.writeFileSync(sourceDest, modifiedHtml);
  
  const imgDest = path.resolve('public', 'assets', 'images', 'certificate-background.png');
  fs.mkdirSync(path.dirname(imgDest), { recursive: true });
  await page.screenshot({ path: imgDest, fullPage: true });
  
  await browser.close();
  console.log('Exported certificate background to ' + imgDest);
})();
