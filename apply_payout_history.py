import re

path = r'c:\Users\salmaan\.gemini\antigravity\Tacliimi\src\pages\instructor\instructor-profile\index.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace the tbody HTML empty state with skeleton loaders
html_target = """<tbody id="payout-history-tbody">
                                                <tr class="h-64" id="payout-empty-state">
                                                    <td class="px-6 py-10" colspan="5">
                                                        <div
                                                            class="flex flex-col items-center justify-center text-center">
                                                            <div
                                                                class="mb-4 flex size-16 items-center justify-center rounded-full bg-slate-50 text-slate-300 dark:bg-slate-800/50">
                                                                <span
                                                                    class="material-symbols-outlined text-4xl">history</span>
                                                            </div>
                                                            <p
                                                                class="text-base font-semibold text-slate-900 dark:text-white">
                                                                No transactions yet</p>
                                                            <p class="mt-1 text-sm text-slate-500">Your earnings history
                                                                will appear here.</p>
                                                        </div>
                                                    </td>
                                                </tr>
                                            </tbody>"""

html_skeleton = """<tbody id="payout-history-tbody">
                                                <tr class="animate-pulse border-b border-slate-100 dark:border-slate-800">
                                                    <td class="px-6 py-4"><div class="h-4 w-20 rounded bg-slate-200 dark:bg-slate-700"></div></td>
                                                    <td class="px-6 py-4"><div class="h-4 w-24 rounded bg-slate-200 dark:bg-slate-700"></div></td>
                                                    <td class="px-6 py-4"><div class="h-4 w-32 rounded bg-slate-200 dark:bg-slate-700"></div></td>
                                                    <td class="px-6 py-4 text-right"><div class="ml-auto h-4 w-16 rounded bg-slate-200 dark:bg-slate-700"></div></td>
                                                    <td class="px-6 py-4"><div class="h-6 w-16 rounded-full bg-slate-200 dark:bg-slate-700"></div></td>
                                                </tr>
                                                <tr class="animate-pulse border-b border-slate-100 dark:border-slate-800">
                                                    <td class="px-6 py-4"><div class="h-4 w-20 rounded bg-slate-200 dark:bg-slate-700"></div></td>
                                                    <td class="px-6 py-4"><div class="h-4 w-24 rounded bg-slate-200 dark:bg-slate-700"></div></td>
                                                    <td class="px-6 py-4"><div class="h-4 w-32 rounded bg-slate-200 dark:bg-slate-700"></div></td>
                                                    <td class="px-6 py-4 text-right"><div class="ml-auto h-4 w-16 rounded bg-slate-200 dark:bg-slate-700"></div></td>
                                                    <td class="px-6 py-4"><div class="h-6 w-16 rounded-full bg-slate-200 dark:bg-slate-700"></div></td>
                                                </tr>
                                                <tr class="animate-pulse">
                                                    <td class="px-6 py-4"><div class="h-4 w-20 rounded bg-slate-200 dark:bg-slate-700"></div></td>
                                                    <td class="px-6 py-4"><div class="h-4 w-24 rounded bg-slate-200 dark:bg-slate-700"></div></td>
                                                    <td class="px-6 py-4"><div class="h-4 w-32 rounded bg-slate-200 dark:bg-slate-700"></div></td>
                                                    <td class="px-6 py-4 text-right"><div class="ml-auto h-4 w-16 rounded bg-slate-200 dark:bg-slate-700"></div></td>
                                                    <td class="px-6 py-4"><div class="h-6 w-16 rounded-full bg-slate-200 dark:bg-slate-700"></div></td>
                                                </tr>
                                            </tbody>"""

content = content.replace(html_target, html_skeleton)


# 2. Replace the JS logic to render the empty state when no results
js_target = """                    instructorEarningsService.getWithdrawalHistory(session.user.id).then(withdrawals => {
                        const tb = document.getElementById('payout-history-tbody');
                        if (tb && withdrawals.length > 0) {
                             tb.innerHTML = '';
                             withdrawals.forEach(item => {"""

js_replacement = """                    instructorEarningsService.getWithdrawalHistory(session.user.id).then(withdrawals => {
                        const tb = document.getElementById('payout-history-tbody');
                        if (tb) {
                            if (withdrawals.length > 0) {
                                 tb.innerHTML = '';
                                 withdrawals.forEach(item => {"""

content = content.replace(js_target, js_replacement)

# And now inject the actual else block for the empty state
js_target_bot = """                                 tb.appendChild(row);
                             });
                        }
                    });"""

js_replacement_bot = """                                 tb.appendChild(row);
                             });
                            } else {
                                tb.innerHTML = `
                                    <tr class="h-64" id="payout-empty-state">
                                        <td class="px-6 py-10" colspan="5">
                                            <div class="flex flex-col items-center justify-center text-center">
                                                <div class="mb-4 flex size-16 items-center justify-center rounded-full bg-slate-50 text-slate-300 dark:bg-slate-800/50">
                                                    <span class="material-symbols-outlined text-4xl">history</span>
                                                </div>
                                                <p class="text-base font-semibold text-slate-900 dark:text-white">No transactions yet</p>
                                                <p class="mt-1 text-sm text-slate-500">Your earnings history will appear here.</p>
                                            </div>
                                        </td>
                                    </tr>
                                `;
                            }
                        }
                    });"""

content = content.replace(js_target_bot, js_replacement_bot)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")
