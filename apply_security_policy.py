import re

path = r'c:\Users\salmaan\.gemini\antigravity\Tacliimi\src\pages\instructor\instructor-profile\index.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# ADD THE RATE LIMIT ARRAY AT THE TOP OF THE JS SCRIPT (e.g., right after `let activeTabId`)
# I'll find `let activeTabId = 'panel-personal';` and append to it.
content = content.replace(
    "let activeTabId = 'panel-personal';",
    "let activeTabId = 'panel-personal';\n    let passwordAttempts = []; // Rate limiting tracker for password tries"
)

# REWRITE HTML ERROR SPANS
html_curr_pw = """                                        <input
                                            class="w-full rounded-lg border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                                            id="current-password" placeholder="••••••••••••"
                                            type="password" />"""
html_curr_pw_new = html_curr_pw + '\n                                        <span id="current-password-error" class="hidden text-xs text-red-500 mt-1"></span>'

html_new_pw = """                                        <input
                                            class="w-full rounded-lg border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                                            id="new-password" placeholder="Min. 8 characters" type="password" />"""
html_new_pw_new = html_new_pw + '\n                                        <span id="new-password-error" class="hidden text-xs text-red-500 mt-1"></span>'

html_confirm_pw = """                                        <input
                                            class="w-full rounded-lg border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                                            id="confirm-password" placeholder="Confirm your new password" type="password" />"""
html_confirm_pw_new = html_confirm_pw + '\n                                        <span id="confirm-password-error" class="hidden text-xs text-red-500 mt-1"></span>'

content = content.replace(html_curr_pw, html_curr_pw_new)
content = content.replace(html_new_pw, html_new_pw_new)
content = content.replace(html_confirm_pw, html_confirm_pw_new)


# REWRITE JAVASCRIPT SAVE HANDLER LOGIC
js_old = """                } else if (activeTabId === 'panel-security') {
                    const tosCheckbox = document.getElementById('tos-checkbox');
                    tosCheckbox.classList.remove('ring-2', 'ring-red-500', 'border-red-500');

                    if (!tosCheckbox.checked) {
                        tosCheckbox.classList.add('ring-2', 'ring-red-500', 'border-red-500');
                        tabValid = false;
                    }
                    
                    const newPw = document.getElementById('new-password').value;
                    const confirmPw = document.getElementById('confirm-password').value;
                    document.getElementById('confirm-password').classList.remove('border-red-500', 'ring-1', 'ring-red-500');
                    if (newPw && newPw !== confirmPw) {
                        document.getElementById('confirm-password').classList.add('border-red-500', 'ring-1', 'ring-red-500');
                        tabValid = false;
                        const securityErr = document.getElementById('security-error-msg');
                        if (securityErr) {
                            securityErr.textContent = "New password and confirm password do not match.";
                            securityErr.classList.remove('hidden');
                        }
                    }
                }"""

js_new = """                } else if (activeTabId === 'panel-security') {
                    const tosCheckbox = document.getElementById('tos-checkbox');
                    tosCheckbox.classList.remove('ring-2', 'ring-red-500', 'border-red-500');

                    if (!tosCheckbox.checked) {
                        tosCheckbox.classList.add('ring-2', 'ring-red-500', 'border-red-500');
                        tabValid = false;
                    }
                    
                    const securityErr = document.getElementById('security-error-msg');
                    securityErr.classList.add('hidden');
                    
                    ['current-password', 'new-password', 'confirm-password'].forEach(id => {
                        const input = document.getElementById(id);
                        input.classList.remove('border-red-500', 'ring-1', 'ring-red-500');
                        const err = document.getElementById(id + '-error');
                        if (err) err.classList.add('hidden');
                    });

                    const currPwInput = document.getElementById('current-password');
                    const newPwInput = document.getElementById('new-password');
                    const confirmPwInput = document.getElementById('confirm-password');
                    
                    const currPw = currPwInput.value;
                    const newPw = newPwInput.value;
                    const confirmPw = confirmPwInput.value;
                    
                    // Brute force rate limit: 3 attempts every 2 seconds
                    const now = Date.now();
                    passwordAttempts = passwordAttempts.filter(time => now - time < 2000);
                    
                    if (currPw || newPw) {
                        passwordAttempts.push(now);
                        if (passwordAttempts.length > 3) {
                            tabValid = false;
                            securityErr.textContent = "Too many attempts. Please wait 2 seconds before trying again.";
                            securityErr.classList.remove('hidden');
                            return;
                        }
                    }

                    if (newPw || confirmPw) {
                        if (!currPw) {
                            showPayoutError(currPwInput, 'current-password-error', 'Current password is required to set a new one.');
                            tabValid = false;
                        } else if (isTextDirty(currPw)) {
                            showPayoutError(currPwInput, 'current-password-error', 'Invalid characters detected.');
                            tabValid = false;
                        }
                        
                        if (!newPw) {
                            showPayoutError(newPwInput, 'new-password-error', 'New password is required.');
                            tabValid = false;
                        } else if (isTextDirty(newPw)) {
                            showPayoutError(newPwInput, 'new-password-error', 'Invalid characters detected in new password.');
                            tabValid = false;
                        } else if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(newPw)) {
                            showPayoutError(newPwInput, 'new-password-error', 'Must be at least 8 chars long with letters and numbers.');
                            tabValid = false;
                        }
                        
                        if (newPw !== confirmPw) {
                            showPayoutError(confirmPwInput, 'confirm-password-error', 'Passwords do not match.');
                            tabValid = false;
                        }
                    }
                }"""

content = content.replace(js_old, js_new)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Done")
