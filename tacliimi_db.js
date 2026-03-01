// Tacliimi Global DB Simulator using LocalStorage
// This file should be included in any page that interacts with courses.

const TACLIIMI_DB_KEY = 'tacliimi_courses';
const TACLIIMI_ENROLLED_KEY = 'tacliimi_enrolled';
const TACLIIMI_WISHLIST_KEY = 'tacliimi_wishlist';

const defaultCourses = [
    {
        id: 'course-ux-design',
        title: 'Mastering Modern User Experience Design',
        category: 'Design',
        instructor: 'Daniel Walter Scott',
        instructorRole: 'Senior Product Designer',
        thumbnailUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAoxv0lnn9g0hqpV8k7IbB4nHlU5WRInPNUzsbsOw4MERt6qUu-wKJ8hZF1fP5O-AjmvXUsc5jRabFqVdbT7QHymxerTNfftiAKfaqUXneH0jyuu1m3pwea8k5jYqm7t9vGN4_SVlTGZT5NANZh8ZosozBi_L46evR9BzIZIkLuG_gk4P1TV31HsRiM_LvsfbXMJwk0UWfc25apMiGooKsz9O73_bVbnHGE97ZnziwtaSn9hnZzBxxQrky3czU-h_LG31PTYSYujV9S',
        price: 12.99,
        originalPrice: 84.99,
        rating: 4.8,
        reviews: 24532,
        duration: '24h',
        isBestseller: true,
        previewVideo: 'https://www.w3schools.com/html/mov_bbb.mp4' // placeholder preview
    },
    {
        id: 'course-python-ds',
        title: 'Python for Data Science and Machine Learning',
        category: 'Development',
        instructor: 'Jose Portilla',
        instructorRole: 'Head of Data Science at Pierian Data Inc.',
        thumbnailUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDWkES2Yh-DOOjliSjirOlQIpnoSvQ7awv_EbU-ccP1CSoQv9npKHJtLcg1h51El9JFrY5QDmGid5KE83YWILqWSXur2wHlvrSObqu4vkjbZnOUKM7s7epPwTQ-fDll47YcirdWF4WDZBBslD-Vrzc-Wpyd6lm6Ee2UwrEhIvdTX0FoGiXxZPSlDp_LpR4yv4ZRzSt_g4Z_c1ckEUVjVD6ZB0oMjpc8PnNu2x7dc0eWLRpa9kc_ZP5pPPQPmUMcskEHLSgFaN9rI_eV',
        price: 14.99,
        originalPrice: 94.99,
        rating: 4.7,
        reviews: 18912,
        duration: '22.5h',
        isBestseller: true,
        previewVideo: 'https://www.w3schools.com/html/mov_bbb.mp4'
    },
    {
        id: 'course-cyber-security',
        title: 'The Complete Cyber Security Course: Hackers Exposed!',
        category: 'IT & Software',
        instructor: 'Nathan House',
        instructorRole: 'CEO of Station X',
        thumbnailUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuC3pP1-o2Jo_01c-yjRQuvIWQhjBIzjt-CmeOALnYnFxfFCn-1VciBADGbvMKihikD_1Xqoth0VvGPYnXtm1OjWkAIHzrsXCVRynMjrb2gMLbthp80NbcBiMk2O3qMLEsDZYM6M5x5quF80QF68xQd-CuqVwFN6vIVNvu_8y0dgIdMKczfS5a8CCtuYHaxUnQ11DrLRXAZzMxWImw5Kkc1y3ikVAzrdcVY4HjU3l9aZbSzqeMm8xVfolZc9Zt9eoP5jwQEvbVZFlrsQ',
        price: 15.99,
        originalPrice: 119.99,
        rating: 4.5,
        reviews: 12001,
        duration: '12h',
        isBestseller: false,
        previewVideo: 'https://www.w3schools.com/html/mov_bbb.mp4'
    },
    {
        id: 'course-marketing',
        title: 'Digital Marketing Strategy Course 2024',
        category: 'Marketing',
        instructor: 'Phil Ebiner',
        instructorRole: 'Video School Online Inc',
        thumbnailUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuA3CSG7MTDBodlUIBlY3lMpZKI20hDueherr1_BG9tl83T3_76rBLgcRVyvp8XdUIjBx2WWEY0Pr83WpsAfMx4PfcIhB0CHs5Ld-dVqc3ut-6jqE2AYjnAIFykNHfDnU3dIiPRSR9apdplRwBz4iOGDm8u5RVXrX26SmjvviSIr70jqE9OoWRXx7U9UdVJwe0Ayv2FdGGQ6dr4uhBTqF__WtzOnNQNF_fxJl_vYkTK_Ts1F2Ufy2TClWAItRxleq8J9W2mdoIgbIkY-',
        price: 12.99,
        originalPrice: 84.99,
        rating: 4.6,
        reviews: 5420,
        duration: '24h',
        isBestseller: false,
        previewVideo: 'https://www.w3schools.com/html/mov_bbb.mp4'
    },
    {
        id: 'course-management',
        title: 'Modern Management: Lead Your Team to Success',
        category: 'Business',
        instructor: 'Sheryl Sandberg',
        instructorRole: 'Former COO of Meta',
        thumbnailUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuC0Ii7N67n4p6i2piP2gPPooXxZXbRIy-PqGatLG5XfNiIaVCxQz_3bFVxfFsweHCZLSDqOIVs_nNE0nIeJOGCid2nClNYyFNPeZmvPVn9Os7PuP2GCmoD_yZK5hY_rMXZi7i4xBXCAfMpAE55r0oBXmhXkqnzhBg_DA-OHQBjqb7_UQnkjr5mo_8vByCe9isniMZp_trdGkl42bO7DhQOUELkNEqAM9hr8ea4CUYVYOSZeQDN6ODkRkXSYtHNQpkEJ6waHA1qHxGtV',
        price: 13.99,
        originalPrice: 89.99,
        rating: 4.8,
        reviews: 3105,
        duration: '8.5h',
        isBestseller: false,
        previewVideo: 'https://www.w3schools.com/html/mov_bbb.mp4'
    }
];

class TacliimiDB {

    // ==========================================
    // INITIALIZATION
    // ==========================================
    static init() {
        if (!localStorage.getItem(TACLIIMI_DB_KEY)) {
            localStorage.setItem(TACLIIMI_DB_KEY, JSON.stringify(defaultCourses));
        }
        if (!localStorage.getItem(TACLIIMI_ENROLLED_KEY)) {
            localStorage.setItem(TACLIIMI_ENROLLED_KEY, JSON.stringify([]));
        }
        if (!localStorage.getItem(TACLIIMI_WISHLIST_KEY)) {
            // Check legacy wishlist key used in earlier version
            const legacyWishlist = localStorage.getItem('tacliimi_wishlist');
            if (legacyWishlist) {
                // Migrate the IDs instead of full objects
                try {
                    const parsed = JSON.parse(legacyWishlist);
                    if (parsed.length > 0 && parsed[0] !== null && typeof parsed[0] === 'object') {
                        const ids = parsed.map(c => c.id);
                        localStorage.setItem(TACLIIMI_WISHLIST_KEY, JSON.stringify(ids));
                    }
                } catch (e) { }
            } else {
                localStorage.setItem(TACLIIMI_WISHLIST_KEY, JSON.stringify([]));
            }
        }
    }

    // ==========================================
    // COURSES
    // ==========================================
    static getAllCourses() {
        this.init();
        return JSON.parse(localStorage.getItem(TACLIIMI_DB_KEY)) || [];
    }

    static getCourseById(id) {
        const courses = this.getAllCourses();
        return courses.find(c => c.id === id) || null;
    }

    static addCourse(course) {
        const courses = this.getAllCourses();
        courses.unshift(course); // Add to beginning (newest first)
        localStorage.setItem(TACLIIMI_DB_KEY, JSON.stringify(courses));
    }

    // ==========================================
    // ENROLLMENTS
    // ==========================================
    static getEnrolledCourseIds() {
        this.init();
        return JSON.parse(localStorage.getItem(TACLIIMI_ENROLLED_KEY)) || [];
    }

    static getEnrolledCourses() {
        const ids = this.getEnrolledCourseIds();
        return ids.map(id => this.getCourseById(id)).filter(c => c !== null);
    }

    static enrollCourse(courseId) {
        let enrolled = this.getEnrolledCourseIds();
        if (!enrolled.includes(courseId)) {
            enrolled.push(courseId);
            localStorage.setItem(TACLIIMI_ENROLLED_KEY, JSON.stringify(enrolled));
            // Automatically remove from wishlist if enrolled
            this.removeFromWishlist(courseId);
        }
    }

    static isEnrolled(courseId) {
        return this.getEnrolledCourseIds().includes(courseId);
    }

    // ==========================================
    // WISHLIST
    // ==========================================
    static getWishlistCourseIds() {
        this.init();
        return JSON.parse(localStorage.getItem(TACLIIMI_WISHLIST_KEY)) || [];
    }

    static getWishlistedCourses() {
        const ids = this.getWishlistCourseIds();
        return ids.map(id => this.getCourseById(id)).filter(c => c !== null);
    }

    static addToWishlist(courseId) {
        let wishlist = this.getWishlistCourseIds();
        if (!wishlist.includes(courseId)) {
            wishlist.push(courseId);
            localStorage.setItem(TACLIIMI_WISHLIST_KEY, JSON.stringify(wishlist));
        }
    }

    static removeFromWishlist(courseId) {
        let wishlist = this.getWishlistCourseIds();
        wishlist = wishlist.filter(id => id !== courseId);
        localStorage.setItem(TACLIIMI_WISHLIST_KEY, JSON.stringify(wishlist));
    }

    static isWishlisted(courseId) {
        return this.getWishlistCourseIds().includes(courseId);
    }

    static toggleWishlist(courseId) {
        if (this.isWishlisted(courseId)) {
            this.removeFromWishlist(courseId);
            return false;
        } else {
            this.addToWishlist(courseId);
            return true;
        }
    }
}

// Ensure init runs
TacliimiDB.init();
