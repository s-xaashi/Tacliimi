/**
 * shared mobileNav.js
 * Automatically attaches listeners for mobile navigation logic across the instructor and student dashboard pages.
 */
document.addEventListener('DOMContentLoaded', () => {
    // 1. Instructor Sidebars (Group A)
    const instToggleBtn = document.getElementById('instructor-mobile-menu-btn');
    const instSidebar = document.getElementById('instructor-sidebar');
    const instOverlay = document.getElementById('sidebar-overlay');
    
    // Some pages may use 'toggle-sidebar' and 'sidebar' (e.g. Admin) but we have adminSidebar.js for that.
    // However, if we want to be fully generic:
    const sidebar = instSidebar || document.getElementById('sidebar');
    const toggleBtn = instToggleBtn || document.getElementById('toggle-sidebar');
    const overlay = instOverlay || document.getElementById('sidebar-overlay');

    if (toggleBtn && sidebar && overlay) {
        // Prevent duplicate listener if run multiple times by checking a dataset flag
        if (!toggleBtn.dataset.navBound) {
            toggleBtn.dataset.navBound = 'true';
            
            toggleBtn.addEventListener('click', () => {
                sidebar.classList.toggle('-translate-x-full');
                overlay.classList.toggle('hidden');
            });
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
