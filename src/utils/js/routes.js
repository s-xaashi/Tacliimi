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
    DASHBOARD:       '/src/pages/instructor/instructor-dashboard/',
    COURSES:         '/src/pages/instructor/instructor-courses/',
    MENTORSHIP:      '/src/pages/instructor/instructor-mentorship/',
    MENTORSHIP_REQ:  '/src/pages/instructor/instructor-mentorship/#requests',
    ANALYTICS:       '/src/pages/instructor/instructor-analytics/',
    EARNINGS:        '/src/pages/instructor/instructor-earnings/',
    COMMUNICATIONS:  '/src/pages/instructor/instructor-communications/',
    PROFILE:         '/src/pages/instructor/instructor-profile/',
    AVAILABILITY:    '/src/pages/instructor/instructor-availability/',
    BECOME:          '/src/pages/instructor/become-instructor/',
};

/** Student-area routes */
export const STUDENT = {
    DASHBOARD:       '/src/pages/student/student-dashboard/',
    DASHBOARD_MENTORS: '/src/pages/student/student-dashboard/#my-mentors',
    ACCOUNT:         '/src/pages/student/account-settings/',
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
    MARKETPLACE:     '/src/pages/marketplace/',
    MENTOR_PROFILE:  (serialId) => `/src/pages/instructor/public-profile/?id=${serialId}`,
    COURSE_DETAIL:   (courseId)  => `/src/pages/course-detail/?id=${courseId}`,
    VERIFY:          '/src/pages/verify/',
};

/** Consolidated ROUTES export for convenience */
export const ROUTES = { INSTRUCTOR, STUDENT, ADMIN, PUBLIC };
