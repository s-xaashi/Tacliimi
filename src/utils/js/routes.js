/**
 * routes.js
 * ===========================================================
 * Central URL registry for the Tacliimi application.
 * Import and use these constants instead of hardcoding paths.
 *
 * Usage:
 *   import { ROUTES } from '/src/utils/js/routes.js';
 *   window.location.href = ROUTES.INSTRUCTOR.MENTORSHIP;
 * ===========================================================
 */

/** Instructor-area routes */
export const INSTRUCTOR = {
    DASHBOARD:       '/instructor/dashboard/',
    COURSES:         '/instructor/courses/',
    MENTORSHIP:      '/instructor/mentorship/',
    MENTORSHIP_REQ:  '/instructor/mentorship/#requests',
    ANALYTICS:       '/instructor/analytics/',
    EARNINGS:        '/instructor/earnings/',
    COMMUNICATIONS:  '/instructor/communications/',
    PROFILE:         '/instructor/profile/',
    AVAILABILITY:    '/instructor/availability/',
    BECOME:          '/become-instructor/',
};

/** Student-area routes */
export const STUDENT = {
    DASHBOARD:       '/student/dashboard/',
    DASHBOARD_MENTORS: '/student/dashboard/#my-mentors',
    ACCOUNT:         '/student/account-settings/',
};

/** Admin-area routes */
export const ADMIN = {
    DASHBOARD:       '/src/pages/admin/dashboard/',
    COURSES_REVIEW:  '/src/pages/admin/courses-review/',
    BOOKINGS_REVIEW: '/src/pages/admin/bookings-review/',
    USERS:           '/src/pages/admin/users/',
    INSTRUCTORS:     '/src/pages/admin/instructors/',
    FINANCE:         '/src/pages/admin/finance/',
    ANALYTICS:       '/src/pages/admin/analytics/',
};

/** Public-facing routes */
export const PUBLIC = {
    HOME:            '/index.html',
    MARKETPLACE:     '/courses/',
    MENTOR_PROFILE:  (serialId) => `/src/pages/instructor/public-profile/?id=${serialId}`,
    COURSE_DETAIL:   (courseId)  => `/course-details/?id=${courseId}`,
    VERIFY:          '/verify/',
};

/** Consolidated ROUTES export for convenience */
export const ROUTES = { INSTRUCTOR, STUDENT, ADMIN, PUBLIC };
