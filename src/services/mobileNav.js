/**
 * shared mobileNav.js
 * Automatically attaches listeners for mobile navigation logic across the instructor and student dashboard pages.
 */
document.addEventListener('DOMContentLoaded', () => {
    // 1. Instructor Sidebars (Group A)
    const instToggleBtn = document.getElementById('instructor-mobile-menu-btn');
    const instSidebar = document.getElementById('instructor-sidebar');
    const instOverlay = document.getElementById('sidebar-overlay');
    
    const sidebar = instSidebar || document.getElementById('sidebar') || document.getElementById('settings-sidebar') || document.getElementById('wizard-sidebar');
    const toggleBtns = [
        instToggleBtn,
        document.getElementById('toggle-sidebar'),
        document.getElementById('settings-mobile-menu-btn'),
        document.getElementById('wizard-mobile-menu-btn'),
        ...document.querySelectorAll('.settings-mobile-menu-btn')
    ].filter(Boolean);
    
    const overlay = instOverlay || document.getElementById('sidebar-overlay');

    if (toggleBtns.length > 0 && sidebar && overlay) {
        toggleBtns.forEach(toggleBtn => {
            if (!toggleBtn.dataset.navBound) {
                toggleBtn.dataset.navBound = 'true';
                
                toggleBtn.addEventListener('click', () => {
                    sidebar.classList.toggle('-translate-x-full');
                    overlay.classList.toggle('hidden');
                });
            }
        });
        
        if (!overlay.dataset.navBound) {
            overlay.dataset.navBound = 'true';
            overlay.addEventListener('click', () => {
                sidebar.classList.add('-translate-x-full');
                overlay.classList.add('hidden');
            });
        }
    }

    // 2. Instructor Dropdown Menus (Group B)
    const mobileMenuBtn = document.getElementById('instructor-mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    
    if (mobileMenuBtn && mobileMenu && !sidebar) {
        if (!mobileMenuBtn.dataset.navBound) {
            mobileMenuBtn.dataset.navBound = 'true';
            
            mobileMenuBtn.addEventListener('click', () => {
                mobileMenu.classList.toggle('hidden');
            });
            
            document.addEventListener('click', (e) => {
                if (!mobileMenuBtn.contains(e.target) && !mobileMenu.contains(e.target) && !mobileMenu.classList.contains('hidden')) {
                    mobileMenu.classList.add('hidden');
                }
            });
        }
    }

    // 3. Wizard Page
    const wizBtn = document.getElementById('wizard-mobile-menu-btn');
    const wizMenu = document.getElementById('wizard-mobile-menu');
    
    if (wizBtn && wizMenu) {
        if (!wizBtn.dataset.navBound) {
            wizBtn.dataset.navBound = 'true';
            
            wizBtn.addEventListener('click', () => {
                wizMenu.classList.toggle('hidden');
            });
            
            document.addEventListener('click', (e) => {
                if (!wizBtn.contains(e.target) && !wizMenu.contains(e.target) && !wizMenu.classList.contains('hidden')) {
                    wizMenu.classList.add('hidden');
                }
            });
        }
    }
});
