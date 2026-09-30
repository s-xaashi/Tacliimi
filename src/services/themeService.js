/**
 * ThemeService
 * Manages global theme persistence using localStorage.
 */
export const ThemeService = {
    /**
     * Initialize theme based on saved preference or system default.
     */
    init() {
        const savedTheme = localStorage.theme || localStorage.getItem('tacliimi-theme') || localStorage.getItem('theme');
        if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
        this.updateToggleIcons();
    },

    /**
     * Toggle between light and dark mode.
     */
    toggle() {
        const isDark = document.documentElement.classList.toggle('dark');
        const themeVal = isDark ? 'dark' : 'light';
        localStorage.theme = themeVal;
        try { localStorage.setItem('tacliimi-theme', themeVal); } catch (e) {}
        try { localStorage.setItem('theme', themeVal); } catch (e) {}
        this.updateToggleIcons();
        return isDark;
    },

    /**
     * Update all theme toggle icons on the page.
     */
    updateToggleIcons() {
        const isDark = document.documentElement.classList.contains('dark');
        const toggles = document.querySelectorAll('#theme-toggle, #themeToggle, #global-theme-toggle, #mobile-theme-toggle, .theme-toggle, button[aria-label*="theme" i], button[title*="theme" i]');
        toggles.forEach(btn => {
            const singleIcon = btn.querySelector('.material-symbols-outlined:not(.dark\\:hidden):not(.hidden), .material-icons-outlined:not(.dark\\:hidden):not(.hidden)');
            if (singleIcon && !singleIcon.classList.contains('dark:hidden') && !singleIcon.classList.contains('hidden')) {
                singleIcon.textContent = isDark ? 'light_mode' : 'dark_mode';
            }
        });
    }
};
