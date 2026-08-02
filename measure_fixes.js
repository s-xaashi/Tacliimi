const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

async function measure() {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  await page.setViewport({ width: 2800, height: 1980, deviceScaleFactor: 1 });
  
  const content = fs.readFileSync(path.join(__dirname, 'public/assets/certificate-background.source.html'), 'utf8');
  await page.setContent(content, { waitUntil: 'networkidle0' });
  
  // Wait for fonts
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  const coords = await page.evaluate(() => {
    const cw = document.querySelector('.cert-wrap').getBoundingClientRect();
    const dpr = 2; // For 2800x1980 output

    function getCenter(selector) {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round((r.left + r.width / 2 - cw.left) * dpr),
        y: Math.round((r.top + r.height / 2 - cw.top) * dpr),
        left: Math.round((r.left - cw.left) * dpr),
        right: Math.round((r.right - cw.left) * dpr),
        width: Math.round(r.width * dpr),
        height: Math.round(r.height * dpr),
        top: Math.round((r.top - cw.top) * dpr)
      };
    }
    
    return {
      seal: getCenter('.seal'),
      dateCompletedBlock: getCenter('.stat-block:nth-of-type(1)'),
      quizScoreBlock: getCenter('.stat-block:nth-of-type(2)'),
      studentPhoto: getCenter('.student-identity img:first-child'),
      certificateBody: getCenter('.cert-wrap'),
      statsRow: getCenter('.stats-row')
    };
  });

  console.log(JSON.stringify(coords, null, 2));
  await browser.close();
}

measure().catch(console.error);
