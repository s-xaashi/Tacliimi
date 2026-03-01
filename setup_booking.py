import os

brain_dir = r"C:\Users\salmaan\.gemini\antigravity\brain\be141a2a-7c8a-4a49-8048-b7c148090ae9"
proj_dir = r"C:\Users\salmaan\.gemini\antigravity\Tacliimi"

def read_file(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def write_file(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

# 1. Create confirmation page
confirmation_html = read_file(os.path.join(brain_dir, "stitch_confirmation.html"))
write_file(os.path.join(proj_dir, "mentor-booking", "confirmation.html"), confirmation_html)

# 2. Add Booking Selection JS and Routing to mentor-booking/index.html
booking_html = read_file(os.path.join(proj_dir, "mentor-booking", "index.html"))

# Update the "Confirm and Book Session" button to go to confirmation.html
booking_html = booking_html.replace(
    '''<button class="w-full px-10 py-4 bg-primary text-white rounded-2xl font-bold text-lg hover:bg-primary/90 active:scale-[0.98] transition-all shadow-xl shadow-primary/20">
                            Confirm and Book Session
                        </button>''',
    '''<button onclick="window.location.href='confirmation.html'" class="w-full px-10 py-4 bg-primary text-white rounded-2xl font-bold text-lg hover:bg-primary/90 active:scale-[0.98] transition-all shadow-xl shadow-primary/20">
                            Confirm and Book Session
                        </button>'''
)

js_interaction = """
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
        
        // --- Date Selection ---
        const calendarBtns = document.querySelectorAll('.calendar-grid > button');
        calendarBtns.forEach(btn => {
            btn.addEventListener('click', function() {
                // Remove active classes from all buttons
                calendarBtns.forEach(b => {
                    b.classList.remove('bg-primary', 'text-white', 'shadow-lg', 'shadow-primary/30');
                    b.classList.add('hover:bg-primary/10', 'hover:text-primary');
                });
                // Add active classes to the clicked one
                this.classList.remove('hover:bg-primary/10', 'hover:text-primary');
                this.classList.add('bg-primary', 'text-white', 'shadow-lg', 'shadow-primary/30');
            });
        });
        
        // --- Time Slot Selection ---
        // Find all time slots within Morning Windows and Afternoon Windows
        const timeSlots = document.querySelectorAll('h4 + div > button.group, h4 + div > button.border-primary'); 
        timeSlots.forEach(slot => {
            // Ignore the booked one
            if(slot.classList.contains('cursor-not-allowed')) return;
            
            slot.addEventListener('click', function() {
                // Reset all to default state
                timeSlots.forEach(s => {
                    if(s.classList.contains('cursor-not-allowed')) return;
                    s.className = 'w-full flex items-center justify-between p-4 border border-slate-200 dark:border-slate-800 rounded-xl hover:border-primary hover:bg-primary/5 transition-all group';
                    
                    // Restore to base content if time dataset exists
                    if (s.dataset.time) {
                        s.innerHTML = `
                            <div class="flex items-center gap-3">
                                <span class="material-symbols-outlined text-slate-400 group-hover:text-primary">${s.dataset.icon || 'wb_sunny'}</span>
                                <span class="font-semibold text-sm">${s.dataset.time}</span>
                            </div>
                            <span class="text-xs font-bold text-slate-400">Available</span>
                        `;
                    }
                });
                
                // Store the default values as data attributes before overwriting if they don't exist
                if(!this.dataset.time) this.dataset.time = this.querySelector('.font-semibold, .font-bold').innerText;
                if(!this.dataset.icon) this.dataset.icon = this.querySelector('.material-symbols-outlined').innerText;
                
                // Set clicked one to active state
                this.className = 'w-full flex items-center justify-between p-4 border-2 border-primary bg-primary/5 text-primary rounded-xl transition-all';
                this.innerHTML = `
                    <div class="flex items-center gap-3">
                        <span class="material-symbols-outlined">${this.dataset.icon}</span>
                        <span class="font-bold text-sm">${this.dataset.time}</span>
                    </div>
                    <span class="material-symbols-outlined text-lg">check_circle</span>
                `;
            });
        });
        
    });
</script>"""

# Replace the existing script tag with the new expanded one
old_script = """<script>
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
</script>"""

booking_html = booking_html.replace(old_script, js_interaction)

write_file(os.path.join(proj_dir, "mentor-booking", "index.html"), booking_html)
print("Done")
