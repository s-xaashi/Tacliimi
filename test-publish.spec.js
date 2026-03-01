const { test, expect } = require('@playwright/test');

test('test publish course via wizard', async ({ page }) => {
    // Load local file
    const url = 'http://localhost:8000/instructor-courses/wizard.html';
    await page.goto(url);

    // Step 1: Basic Info
    await page.fill('#course-title', 'Playwright Automated Course');
    await page.fill('#course-subtitle', 'Learn Playwright');
    await page.fill('#description', 'This is an awesome testing course.');
    await page.selectOption('#course-category', 'Computer Science');
    await page.selectOption('#course-level', 'Advanced');

    // Go to Next Step
    await page.click('#btn-next');

    // Step 2: Curriculum
    // Click Add Section
    await page.click('button:has-text("Add New Section")');
    // Save New Section (assuming there's a modal, we might just click next for now)

    // Go to Next Step
    await page.click('#btn-next');

    // Step 3: Pricing
    await page.click('#btn-tier-paid');
    await page.fill('#course-price', '99.99');

    // Go to Next Step
    await page.click('#btn-next');

    // Step 4: Publish
    // Make sure we are on step 4
    await expect(page.locator('#final-title-preview')).toContainText('Playwright Automated Course');

    // Click Publish
    await page.click('#btn-publish');

    // Expect Congratulations
    await expect(page.locator('h2:has-text("Congratulations!")')).toBeVisible();

    // Now go to marketplace and check if the course exists
    await page.goto('http://localhost:8000/marketplace/index.html');
    await expect(page.locator('h3:has-text("Playwright Automated Course")')).toBeVisible();
});
