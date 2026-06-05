const fs = require('fs');
const file = 'c:/Users/salmaan/.gemini/antigravity/Tacliimi/src/pages/instructor/instructor-profile/index.html';
let content = fs.readFileSync(file, 'utf8');

// 1. Add COD Country Field
const codRegex = /<input id="cod-city" type="text"[\s\S]*?<\/div>\s*<div>\s*<label[\s\S]*?for="cod-phone">Contact Phone<\/label>/;
if (codRegex.test(content)) {
    content = content.replace(codRegex, `$&`.replace('for="cod-phone">Contact Phone</label>', `for="cod-country">Country</label>
<input id="cod-country" type="text" class="w-full rounded-lg border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white" placeholder="Somalia" />
</div>
<div>
<label class="mb-2 block text-xs font-bold uppercase text-slate-500" for="cod-phone">Contact Phone</label>`));

    // also update grid cols
    content = content.replace(/<div class="grid grid-cols-1 gap-4 md:grid-cols-2">(\s*<div>\s*<label[^>]*for="cod-city")/, '<div class="grid grid-cols-1 gap-4 md:grid-cols-3">$1');
} else {
    console.log('Failed to find COD regex');
}

// 2. Fix populate form to handle COD Country
content = content.replace(/if \(details\.city\) document\.getElementById\('cod-city'\)\.value = details\.city;/, `$&
                        if (details.country) document.getElementById('cod-country').value = details.country;`);

// 3. Fix tab valid validation bypass logic:
// Original: if (!tabValid) return; 
// We need to make sure we show the red rings AND we don't proceed with save.
// Wait, the original does `if (!tabValid) return;`, which stops the save function. The issue is NOT that it saves, the issue is that it bypasses when switching tabs manually.
// So let's look at switchPanel again:
const oldSwitchPanel = /const targetStep = panelId === 'panel-personal' \? 1 :[\s\S]*?if \(targetStep > maxStep\) {[\s\S]*?return; \/\/ BLOCKED\s*}/;
const newSwitchPanel = `
                const targetStep = panelId === 'panel-personal' ? 1 :
                    panelId === 'panel-teaching' ? 2 :
                        panelId === 'panel-payout' ? 3 :
                            panelId === 'panel-security' ? 4 : 1;
                let maxStep = window.currentProfile.setup_progress;
                if (!maxStep || typeof maxStep !== 'number') maxStep = 1;

                if (targetStep > maxStep) {
                    // Temporarily highlight the save button to hint at the requirement
                    const saveBtn = document.querySelector('button:has(.material-symbols-outlined:contains("save")), button#save-profile-btn');
                    if (saveBtn) {
                        saveBtn.classList.add('ring-4', 'ring-red-500/50', 'animate-pulse');
                        
                        // Let's also trigger the save button click to force the red outlines to show
                        saveBtn.click();
                        
                        setTimeout(() => saveBtn.classList.remove('ring-4', 'ring-red-500/50', 'animate-pulse'), 1000);
                    }
                    return; // BLOCKED
                }`;
if (oldSwitchPanel.test(content)) {
    content = content.replace(oldSwitchPanel, newSwitchPanel);
} else {
    console.log('Failed to find switchPanel regex');
}


// 4. In COD saving validation, add Country check
const codSaveRegex = /const city = codCityInput\.value\.trim\(\);\s*const phone = codPhoneInput\.value\.trim\(\);/;
const codSaveReplace = `$&
                    const codCountryInput = document.getElementById('cod-country');
                    if (codCountryInput) codCountryInput.classList.remove('border-red-500', 'ring-1', 'ring-red-500');
                    const country = codCountryInput ? codCountryInput.value.trim() : '';`;
content = content.replace(codSaveRegex, codSaveReplace);

const codValidationRegex = /if \(!address \|\| !city \|\| !phone\) {/;
const codValidationReplace = `if (!address || !city || !phone || !country) {`;
content = content.replace(codValidationRegex, codValidationReplace);

const codValidationRedRingRegex = /if \(!phone\) codPhoneInput\.classList\.add\('border-red-500', 'ring-1', 'ring-red-500'\);/;
const codValidationRedRingReplace = `$&
                            if (!country && codCountryInput) codCountryInput.classList.add('border-red-500', 'ring-1', 'ring-red-500');`;
content = content.replace(codValidationRedRingRegex, codValidationRedRingReplace);

const codUpdateRegex = /updates = { payout_method: 'Cash on Delivery', payout_details: { address, city, phone } };/;
const codUpdateReplace = `updates = { payout_method: 'Cash on Delivery', payout_details: { address, city, phone, country } };`;
content = content.replace(codUpdateRegex, codUpdateReplace);


fs.writeFileSync(file, content, 'utf8');
console.log('Fixed profile UI issues');
