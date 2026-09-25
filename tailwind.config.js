/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',

  // ------------------------------------------------------------------
  // Content sources — used for class purging in production build.
  // Include all HTML pages and all JS files that inject class strings.
  // ------------------------------------------------------------------
  content: [
    './index.html',
    './public/**/*.html',
    './src/**/*.html',
    './src/**/*.js',
  ],

  theme: {
    extend: {
      // ------------------------------------------------------------------
      // Canonical Tacliimi color tokens.
      //
      // AUDIT NOTE: Multiple per-page primary/background-dark/accent values
      // were found across 92 pages. These values below are the dominant
      // production values used by all core/dashboard pages.
      //
      // Pages with intentionally different palettes (e.g. landing page uses
      // brand-dark, edu-yellow, edu-purple which are unique to it) retain
      // their own colors via explicit hex classes in their markup — no change
      // is needed there. The tokens below ensure that any class reference to
      // `primary`, `background-dark`, etc. resolves consistently.
      // ------------------------------------------------------------------
      colors: {
        // Core brand (dominant across 70+ pages)
        primary:            '#4F46E5',
        'brand-purple':     '#7c3aed',
        secondary:          '#818cf8',

        // Background tokens
        'background-light': '#F9FAFB',
        'background-dark':  '#111827',

        // Accent — used across admin + mentor pages
        accent:             '#7C3AED',

        // Landing page exclusive tokens (public/index.html)
        'brand-dark':       '#1e1b4b',
        'edu-dark':         '#020617',
        'edu-yellow':       '#facc15',
        'edu-purple':       '#1e1b4b',
      },

      fontFamily: {
        display: ['Inter', 'system-ui', 'sans-serif'],
        body:    ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },

  // ------------------------------------------------------------------
  // Safelist: classes composed dynamically at runtime that would be
  // purged by the content scanner. Prefer rewriting to literal strings
  // where practical; use safelist only when necessary.
  //
  // Admin dashboard uses:
  //   catColors = { course:'bg-blue-500', mentor:'bg-emerald-500', ... }
  //   `${catColors[cat]}/20`
  //   `text-${catColors[cat].replace('bg-','')}`
  //
  // Fix applied in HTML: catColors now includes /20 variants as full strings.
  // Safelist retained as belt-and-suspenders for the text- variants which
  // are constructed by .replace().
  // ------------------------------------------------------------------
  safelist: [
    'text-blue-500',
    'text-emerald-500',
    'text-amber-500',
    'text-red-500',
    'bg-blue-500/20',
    'bg-emerald-500/20',
    'bg-amber-500/20',
    'bg-red-500/20',
  ],

  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('@tailwindcss/container-queries'),
  ],
};
