import sys

file_path = "src/pages/instructor/instructor-mentorship/mentorship.js"
with open(file_path, "r", encoding="utf-8") as f:
    text = f.read()

# Fix the main wrapper in upcoming (from items-center to items-start)
text = text.replace(
    '<div class="flex flex-col md:flex-row gap-8 items-center">',
    '<div class="flex flex-col md:flex-row gap-4 md:gap-8 items-start md:items-center">'
)

# Fix Actions block in upcoming
text = text.replace(
    '<div class="w-full md:w-fit flex flex-row md:flex-col gap-2 justify-center border-t md:border-t-0 ${isCancelled ? \'border-red-100 dark:border-red-900/20\' : \'border-slate-100 dark:border-slate-800\'} pt-4 md:pt-0">',
    '<div class="w-full md:w-fit flex flex-wrap md:flex-col gap-2 justify-start border-t md:border-t-0 ${isCancelled ? \'border-red-100 dark:border-red-900/20\' : \'border-slate-100 dark:border-slate-800\'} pt-4 md:pt-0">'
)

# Make upcoming action buttons responsive (occupy more space instead of overflowing)
text = text.replace(
    '<button class="reschedule-session-btn px-4 py-2.5 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-bold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all text-sm flex items-center justify-center gap-2 whitespace-nowrap"',
    '<button class="reschedule-session-btn flex-1 min-w-[120px] px-4 py-2.5 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-bold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all text-sm flex items-center justify-center gap-2 whitespace-nowrap"'
)

text = text.replace(
    '<button class="message-btn px-4 py-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center"',
    '<button class="message-btn shrink-0 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center"'
)

text = text.replace(
    '<a href="/src/pages/mentorship/mentor-booking/confirmation.html?sessionId=${session.id}" class="px-4 py-2.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-bold rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-all text-sm flex items-center gap-2 justify-center border border-indigo-100 dark:border-indigo-800">',
    '<a href="/src/pages/mentorship/mentor-booking/confirmation.html?sessionId=${session.id}" class="flex-1 min-w-[120px] px-4 py-2.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-bold rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-all text-sm flex items-center gap-2 justify-center border border-indigo-100 dark:border-indigo-800">'
)

text = text.replace(
    '<button class="delete-session-btn px-4 py-2.5 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 transition-all text-sm flex items-center gap-2 shadow-lg shadow-red-500/20" data-id="${session.id}">',
    '<button class="delete-session-btn flex-1 min-w-[120px] px-4 py-2.5 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 transition-all text-sm flex items-center gap-2 justify-center shadow-lg shadow-red-500/20" data-id="${session.id}">'
)

# Fix Actions block in requests
text = text.replace(
    '<div class="w-full md:w-fit flex flex-col gap-2 justify-center border-t md:border-t-0 border-slate-100 dark:border-slate-800 pt-4 md:pt-0">',
    '<div class="w-full md:w-fit flex flex-wrap md:flex-col gap-2 justify-start border-t md:border-t-0 border-slate-100 dark:border-slate-800 pt-4 md:pt-0">'
)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(text)
