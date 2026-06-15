/**
 * ThemeService
 * Manages global theme persistence using localStorage.
 */
export const ThemeService = {
    /**
     * Initialize theme based on saved preference or system default.
     */
    init() {
        const savedTheme = localStorage.getItem('tacliimi-theme');
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
        localStorage.setItem('tacliimi-theme', isDark ? 'dark' : 'light');
        this.updateToggleIcons();
        return isDark;
    },

    /**
     * Update all theme toggle icons on the page.
     */
    updateToggleIcons() {
        const isDark = document.documentElement.classList.contains('dark');
        const toggles = document.querySelectorAll('#theme-toggle, .theme-toggle');
        toggles.forEach(btn => {
            const icon = btn.querySelector('.material-symbols-outlined, .material-icons-outlined');
            if (icon) {
                icon.textContent = isDark ? 'light_mode' : 'dark_mode';
            }
        });
    }
};
