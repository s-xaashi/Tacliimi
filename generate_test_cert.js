const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUTPUT_PNG = path.resolve(__dirname, 'public/assets/images/test-certificate-output.png');


const HTML_CONTENT = `
<!DOCTYPE html>
<html>
<head>
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=IBM+Plex+Mono:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;1,100;1,200;1,300;1,400;1,500;1,600;1,700&family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Caveat:wght@400..700&display=swap" rel="stylesheet">
</head>
<body>
<canvas id="certCanvas" width="2800" height="1980"></canvas>
<script>
    const FIELD_COORDS = {
        studentPhoto:        { x: 1002, y: 504, r: 58 },
        studentName:         { x: 1476, y: 504, font: "italic 500 80px Fraunces, serif",       color: "#0B2D57", align: "center" },
        courseName:          { x: 1400, y: 671, font: "600 50px Fraunces, serif",               color: "#0B2D57", align: "center" },
        dateCompleted:       { x: 1161, y: 1246, font: "600 36px Fraunces, serif",               color: "#0B2D57", align: "center" },
        quizScore:           { x: 1440, y: 1246, font: "600 36px Fraunces, serif",               color: "#0B2D57", align: "center" },
        instructorSignature: { x: 1080, y: 1393, font: "500 60px Caveat, cursive",       color: "#0B2D57", align: "center" },
        instructorName:      { x: 1080, y: 1466, font: "600 24px Inter, sans-serif",             color: "#0B2D57", align: "center" },
        verificationCode:    { x: 182, y: 1902, font: "500 25px 'IBM Plex Mono', monospace",    color: "#0B2D57", align: "left" },
        dateIssued:          { x: 2618, y: 1904, font: "500 23px Inter, sans-serif",             color: "#0B2D57", align: "right" },
    };

    const PHOTO_NAME_GAP = 40; // px gap between photo right edge and name left edge at canvas scale

    function drawCircularPhoto(ctx, img, field) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(field.x, field.y, field.r, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, field.x - field.r, field.y - field.r, field.r * 2, field.r * 2);
        ctx.restore();
    }

    function drawText(ctx, text, field) {
        ctx.font = field.font;
        ctx.fillStyle = field.color;
        ctx.textAlign = field.align;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, field.x, field.y);
    }

    function drawStudentPhotoAndName(ctx, name, photoImg, nameField, photoField) {
        ctx.font = nameField.font;
        const nameWidth = ctx.measureText(name).width;
        const nameLeftEdge = nameField.x - (nameWidth / 2);
        const photoX = nameLeftEdge - PHOTO_NAME_GAP - photoField.r;

        if (photoImg) {
            drawCircularPhoto(ctx, photoImg, { x: photoX, y: photoField.y, r: photoField.r });
        }
        drawText(ctx, name, nameField);
    }

    window.runGeneration = async function(base64Bg) {
        await Promise.all([
            document.fonts.load("italic 500 80px Fraunces"),
            document.fonts.load("600 50px Fraunces"),
            document.fonts.load("500 60px Caveat"),
            document.fonts.load("500 25px 'IBM Plex Mono'"),
            document.fonts.load("500 23px Inter"),
        ]).catch(() => {});
        await document.fonts.ready;

        const bg = new Image();
        bg.src = 'data:image/png;base64,' + base64Bg;
        await new Promise((r) => bg.onload = r);

        // Create a placeholder avatar using an in-page canvas
        const avatarCanvas = document.createElement('canvas');
        avatarCanvas.width = 200; avatarCanvas.height = 200;
        const ac = avatarCanvas.getContext('2d');
        ac.fillStyle = '#3b82f6';
        ac.beginPath(); ac.arc(100, 100, 100, 0, Math.PI * 2); ac.fill();
        ac.fillStyle = '#fff';
        ac.font = 'bold 90px sans-serif';
        ac.textAlign = 'center'; ac.textBaseline = 'middle';
        ac.fillText('U', 100, 100);
        const photoImg = avatarCanvas;

        const canvas = document.getElementById('certCanvas');
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bg, 0, 0, 2800, 1980);

        // Test with a long name and a short name (comment/uncomment as needed)
        const testName = 'Christopher Bartholomew Winchester';
        // const testName = 'salmaan mukhaar xaashi';

        drawStudentPhotoAndName(ctx, testName, photoImg, FIELD_COORDS.studentName, FIELD_COORDS.studentPhoto);
        drawText(ctx, 'Advanced Data Structures and Algorithms with JavaScript and Python', FIELD_COORDS.courseName);
        drawText(ctx, 'January 10, 2026', FIELD_COORDS.dateCompleted);
        drawText(ctx, '100%', FIELD_COORDS.quizScore);
        drawText(ctx, 'Dr. Alexander Montgomery III', FIELD_COORDS.instructorSignature);
        drawText(ctx, 'Dr. Alexander Montgomery III', FIELD_COORDS.instructorName);
        drawText(ctx, 'CERT-99XZ-4421-YQ1W', FIELD_COORDS.verificationCode);
        drawText(ctx, 'January 10, 2026 · Verify at tacliimi.com/verify', FIELD_COORDS.dateIssued);

        return canvas.toDataURL('image/png');
    };
</script>
</body>
</html>
`;

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(HTML_CONTENT, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await new Promise(r => setTimeout(r, 2000));

    const bgPath = path.resolve(__dirname, 'public/assets/images/certificate-background.png');
    const bgBase64 = fs.readFileSync(bgPath).toString('base64');

    const dataUrl = await page.evaluate(
        (base64) => window.runGeneration(base64),
        bgBase64
    );

    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
    fs.writeFileSync(OUTPUT_PNG, base64Data, 'base64');
    console.log('Test certificate saved to:', OUTPUT_PNG);

    await browser.close();
})();
