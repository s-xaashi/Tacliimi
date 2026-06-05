const fs = require('fs');
const file = 'c:/Users/salmaan/.gemini/antigravity/Tacliimi/src/pages/instructor/instructor-profile/index.html';
let content = fs.readFileSync(file, 'utf8');

const regexCityPhone = /<div class="grid grid-cols-1 gap-4 md:grid-cols-3">\s*<div>\s*<label class="mb-2 block text-xs font-bold uppercase text-slate-500"\s*for="cod-city">City<\/label>\s*<input id="cod-city" type="text"\s*class="w-full rounded-lg border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white"\s*placeholder="Hargeisa" \/>\s*<\/div>\s*<div>\s*<label class="mb-2 block text-xs font-bold uppercase text-slate-500"\s*for="cod-phone">Contact Phone<\/label>/;

const replaceCityPhone = `<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
                                                <div>
                                                    <label class="mb-2 block text-xs font-bold uppercase text-slate-500"
                                                        for="cod-city">City</label>
                                                    <input id="cod-city" type="text"
                                                        class="w-full rounded-lg border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                                                        placeholder="Hargeisa" />
                                                </div>
                                                <div>
                                                    <label class="mb-2 block text-xs font-bold uppercase text-slate-500"
                                                        for="cod-country">Country</label>
                                                    <input id="cod-country" type="text"
                                                        class="w-full rounded-lg border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                                                        placeholder="Somalia" />
                                                </div>
                                                <div>
                                                    <label class="mb-2 block text-xs font-bold uppercase text-slate-500"
                                                        for="cod-phone">Contact Phone</label>`;

if (regexCityPhone.test(content)) {
    content = content.replace(regexCityPhone, replaceCityPhone);
    fs.writeFileSync(file, content, 'utf8');
    console.log("Successfully replaced HTML COD Fields");
} else {
    console.log("Failed to match HTML COD Fields text block");
}
