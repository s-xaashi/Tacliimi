import os
import re

brain_dir = r"C:\Users\salmaan\.gemini\antigravity\brain\be141a2a-7c8a-4a49-8048-b7c148090ae9"
proj_dir = r"C:\Users\salmaan\.gemini\antigravity\Tacliimi"

def read_file(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def write_file(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

# 1. Mentor Marketplace
marketplace_html = read_file(os.path.join(brain_dir, "stitch_marketplace.html"))
# Replace buttons with links
marketplace_html = marketplace_html.replace(
    '''<button class="w-full bg-primary text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-primary/90 active:scale-[0.98] transition-all">
                            See More Details
                        </button>''',
    '''<a href="../mentor-profile/index.html" class="w-full bg-primary text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-primary/90 active:scale-[0.98] transition-all">
                            See More Details
                        </a>'''
)
write_file(os.path.join(proj_dir, "mentor-marketplace", "index.html"), marketplace_html)

# 2. Mentor Profile
details_html = read_file(os.path.join(brain_dir, "stitch_details.html"))
details_html = details_html.replace(
    '''<button class="w-full bg-primary text-white py-4 rounded-xl font-bold text-lg hover:bg-primary/90 transition-all active:scale-[0.98] shadow-lg shadow-primary/20">
                    Book a Session
                </button>''',
    '''<a href="../mentor-booking/index.html" class="w-full block text-center bg-primary text-white py-4 rounded-xl font-bold text-lg hover:bg-primary/90 transition-all active:scale-[0.98] shadow-lg shadow-primary/20">
                    Book a Session
                </a>'''
)
write_file(os.path.join(proj_dir, "mentor-profile", "index.html"), details_html)

# 3. Mentor Booking
booking_html = read_file(os.path.join(brain_dir, "stitch_booking.html"))

# Add modal CSS
modal_css = """
        .modal-backdrop {
            background-color: rgba(25, 16, 34, 0.4);
            backdrop-filter: blur(12px);
        }
    </style>"""
booking_html = booking_html.replace("</style>", modal_css)

# Add Modal HTML & JS before </body>
modal_html = """
<div class="fixed inset-0 z-[100] flex items-center justify-center p-4 modal-backdrop" id="in-person-modal" style="display: none;">
    <div class="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl shadow-[0_35px_60px_-15px_rgba(0,0,0,0.3)] border border-white/20 dark:border-slate-800 overflow-hidden">
        <div class="p-8">
            <div class="flex items-center justify-between mb-6">
                <h3 class="text-xl font-bold text-slate-900 dark:text-white">In-Person Meeting Details</h3>
                <button class="text-slate-400 hover:text-slate-600 transition-colors" onclick="document.getElementById('in-person-modal').style.display='none'">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
            <div class="space-y-5">
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 px-1">Meeting Location</label>
                    <input class="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-slate-400/50" placeholder="Enter Meeting Location (e.g., Cafe, Library, or Address)" type="text"/>
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 px-1">Your Phone Number</label>
                    <input class="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-slate-400/50" placeholder="Your Phone Number" type="tel"/>
                </div>
                <div class="flex items-start gap-2 py-2">
                    <span class="material-symbols-outlined text-primary text-lg shrink-0">info</span>
                    <p class="text-xs text-slate-500 leading-relaxed italic">
                        This information will be shared with the mentor to finalize the meeting details.
                    </p>
                </div>
            </div>
            <div class="mt-8 flex justify-end">
                <button class="bg-primary text-white px-10 py-3 rounded-xl text-sm font-bold hover:bg-primary/90 transition-all shadow-lg shadow-primary/25" onclick="document.getElementById('in-person-modal').style.display='none'">
                    Done
                </button>
            </div>
        </div>
    </div>
</div>
<script>
    document.addEventListener("DOMContentLoaded", function() {
        const inPersonRadio = document.querySelector('input[name="meeting_type"][value="in-person"]');
        const onlineRadio = document.querySelector('input[name="meeting_type"][value="online"]');
        const modal = document.getElementById('in-person-modal');
        
        if (inPersonRadio) {
            inPersonRadio.addEventListener('change', function() {
                if (this.checked) {
                    modal.style.display = 'flex';
                }
            });
        }
    });
</script>
</body>"""
booking_html = booking_html.replace("</body>", modal_html)
write_file(os.path.join(proj_dir, "mentor-booking", "index.html"), booking_html)

print("Done generating files.")
