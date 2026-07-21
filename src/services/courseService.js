import { supabase } from './supabaseClient.js';
import { AuthService } from './authService.js';

export const CourseService = {

    /** Generate a slug from a title */
    generateSlug(title) {
        return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '') + '-' + Math.random().toString(36).substring(2, 6);
    },

    /** CATEGORIES */
    async getCategories() {
        // Public-facing: only return active categories
        const { data, error } = await supabase
            .from('course_categories')
            .select('*')
            .eq('is_active', true)
            .order('name');
        if (error) throw error;
        return data;
    },

    /** ADMIN CATEGORY MANAGEMENT */
    async getAllCategoriesAdmin() {
        const { data, error } = await supabase
            .from('course_categories')
            .select('*, courses(id)')
            .order('name');
        if (error) throw error;
        return data;
    },

    async createCategory(name, slug, isActive = true) {
        const { data, error } = await supabase
            .from('course_categories')
            .insert([{ name, slug, is_active: isActive }])
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async updateCategory(id, updates) {
        const { data, error } = await supabase
            .from('course_categories')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async deleteCategory(id) {
        const { error } = await supabase
            .from('course_categories')
            .delete()
            .eq('id', id);
        if (error) throw error;
    },

    /** SEARCH TRACKING */
    async trackSearch(keyword, resultsCount) {
        // Uses security definer RPC to safely upsert search telemetry
        const { error } = await supabase.rpc('track_search', {
            p_keyword: keyword,
            p_marketplace_type: 'course',
            p_results_count: resultsCount
        });
        if (error) console.warn('Search tracking failed:', error.message);
    },

    /** COURSE CRUD */
    async getCourse(courseId) {
        const { data, error } = await supabase
            .from('courses')
            .select(`
                *,
                serial_id,
                instructor:profiles(full_name, avatar_url, professional_title, short_bio, expertise_list),
                course_categories(name),
                course_sections(
                    id, title, order_index,
                    course_lessons(
                        id, title, video_url, is_preview, order_index,
                        lesson_resources(id, title, file_url),
                        quizzes(*)
                    )
                )
            `)
            .eq('id', courseId)
            .maybeSingle();

        if (error && error.code !== 'PGRST116') throw error;
        return data;
    },

    /** Comprehensive fetch for learning interface */
    async getCourseFull(courseId) {
        const { data, error } = await supabase
            .from('courses')
            .select(`
                *,
                serial_id,
                instructor:profiles(full_name, avatar_url, professional_title, short_bio, expertise_list),
                course_coupons(*),
                course_sections(
                    id, title, order_index,
                    course_lessons(
                        id, title, description, video_url, content_type, is_preview, order_index,
                        lesson_resources(id, title, file_url, file_type),
                        quizzes(
                            id, title, description,
                            questions:quiz_questions(
                                id, question_text, order_index,
                                options:quiz_options(id, option_text, is_correct, order_index)
                            )
                        )
                    )
                )
            `)
            .eq('id', courseId)
            .maybeSingle();

        if (error) throw error;

        // Sort all nested data on the frontend for reliable ordering
        if (data && data.course_sections) {
            data.course_sections.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
            data.course_sections.forEach(section => {
                if (section.course_lessons) {
                    section.course_lessons.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
                    section.course_lessons.forEach(lesson => {
                        if (lesson.quizzes) {
                            const quizArray = Array.isArray(lesson.quizzes) ? lesson.quizzes : [lesson.quizzes];
                            quizArray.forEach(quiz => {
                                if (quiz.questions) {
                                    quiz.questions.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
                                    quiz.questions.forEach(q => {
                                        if (q.options) {
                                            q.options.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
                                        }
                                    });
                                }
                            });
                            lesson.quizzes = quizArray;
                        }
                        if (lesson.lesson_resources) {
                            lesson.lesson_resources = Array.isArray(lesson.lesson_resources)
                                ? lesson.lesson_resources
                                : [lesson.lesson_resources];
                        }
                    });
                }
            });
        }

        return data;
    },

    /** FOR MARKETPLACE */
    async getPublishedCourses(filters = {}) {
        let query = supabase
            .from('course_marketplace_view')
            .select('*')
            .eq('is_public', true);

        // Apply filters if provided
        if (filters.categories && filters.categories.length > 0) {
            query = query.in('category_id', filters.categories);
        }

        if (filters.levels && filters.levels.length > 0) {
            query = query.in('level', filters.levels);
        }

        if (filters.price_types && filters.price_types.length > 0) {
            const types = filters.price_types.map(t => t.toLowerCase());
            if (types.includes('free') && !types.includes('paid')) {
                query = query.eq('price_type', 'free');
            } else if (types.includes('paid') && !types.includes('free')) {
                query = query.eq('price_type', 'paid');
            }
        }

        if (filters.search) {
            query = query.ilike('title', `%${filters.search}%`);
        }

        // Apply sorting
        switch (filters.sort) {
            case 'Most Popular':
                query = query.order('enrollments_count', { ascending: false });
                break;
            case 'Highest Rated':
                query = query.order('average_rating', { ascending: false });
                break;
            case 'Price: Low to High':
                query = query.order('price', { ascending: true });
                break;
            case 'Newest':
            default:
                query = query.order('created_at', { ascending: false });
                break;
        }

        const { data, error } = await query;
        if (error) throw error;
        return data;
    },

    async saveDraft(courseData) {
        const session = await AuthService.getSession();
        if (!session) throw new Error("Not authenticated");

        let courseId = courseData.id;

        // Ensure slug exists and is URL-safe
        const slugIsInvalid = !courseData.slug || /\s/.test(courseData.slug);
        if (slugIsInvalid && courseData.title) {
            courseData.slug = this.generateSlug(courseData.title);
        }

        const payload = { ...courseData, instructor_id: session.user.id };
        delete payload.id;
        delete payload.sections;
        delete payload.coupons;
        delete payload.category;

        // Keep price as null if not set — do NOT default to 0
        if (payload.price === undefined || payload.price === '' || isNaN(payload.price)) {
            payload.price = null;
        }

        if (courseId) {
            const { data, error } = await supabase.from('courses').update(payload).eq('id', courseId).select().maybeSingle();
            if (error) throw error;
            return data;
        } else {
            const { data, error } = await supabase.from('courses').insert([payload]).select().maybeSingle();
            if (error) throw error;
            return data;
        }
    },

    /**
     * Submit a draft or revision for admin review.
     * Sets status to 'pending_review' — picked up by the admin review dashboard.
     */
    async submitForReview(courseId) {
        const { error } = await supabase
            .from('courses')
            .update({ status: 'pending_review', version_status: 'pending_review' })
            .eq('id', courseId);
        if (error) throw error;
    },

    /**
     * Acknowledge a course rejection and return it to draft status
     * for the instructor to fix issues and resubmit.
     */
    async confirmRejection(courseId) {
        const { error } = await supabase
            .from('courses')
            .update({ status: 'draft', version_status: 'draft' }) // Reset both just in case
            .eq('id', courseId)
            .eq('status', 'rejected'); // Safety guard
        if (error) throw error;
    },

    /** COUPON MANAGEMENT */
    async saveCoupon(courseId, code, discountPercent, expiresAt = null, startsAt = null) {
        const { data, error } = await supabase
            .from('course_coupons')
            .insert([
                {
                    course_id: courseId,
                    code: code.toUpperCase().trim(),
                    discount_percent: discountPercent,
                    expires_at: expiresAt || null,
                    starts_at: startsAt || new Date().toISOString(),
                    is_active: true
                }
            ])
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async deleteCoupon(courseId, couponCode = null) {
        // If couponCode is provided, delete that specific coupon.
        // Otherwise, delete ALL coupons for this course (used before a full-rebuild).
        let query = supabase.from('course_coupons').delete().eq('course_id', courseId);
        if (couponCode) {
            query = query.eq('code', couponCode.toUpperCase().trim());
        }
        const { error } = await query;
        if (error) throw error;
    },

    async getCourseCoupons(courseId) {
        const { data, error } = await supabase.from('course_coupons')
            .select('*')
            .eq('course_id', courseId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    async validateCoupon(courseId, code) {
        if (!courseId || !code) return null;
        const { data, error } = await supabase.rpc('validate_course_coupon', {
            p_course_id: courseId,
            p_code: code.trim()
        });

        if (error) throw error;

        // RPC returns { discount_percent, valid, message }
        // The endpoint may return an array of 1 element.
        const result = Array.isArray(data) ? data[0] : data;

        if (!result || !result.valid) {
            throw new Error(result?.message || 'Invalid coupon code');
        }

        return result;
    },

    async publishCourse(courseId) {
        const { data, error } = await supabase.from('courses').update({ status: 'pending_review' }).eq('id', courseId).select().maybeSingle();
        if (error) throw error;
        return data;
    },

    async deleteCourse(courseId) {
        const session = await AuthService.getSession();
        if (!session) throw new Error("Not authenticated");

        // Delete the course — DB cascade handles sections, lessons, quizzes, coupons, etc.
        const { error } = await supabase
            .from('courses')
            .delete()
            .eq('id', courseId)
            .eq('instructor_id', session.user.id); // Safety: only own courses

        if (error) throw error;
        return true;
    },

    /** CURRICULUM */
    /** 
     * NEW: Transactional Curriculum Sync
     * Replaces sequential saveSection/saveLesson logic with a single atomic RPC call.
     */
    async syncCurriculum(courseId, curriculumData) {
        console.log('CourseService.syncCurriculum initiated:', { courseId, count: curriculumData?.length });

        if (!courseId) throw new Error("Course ID is required for sync");
        if (!Array.isArray(curriculumData)) throw new Error("Curriculum data must be an array of sections");

        // Use the production-grade RPC
        const { data, error } = await supabase.rpc('sync_course_curriculum', {
            p_course_id: courseId,
            p_curriculum: curriculumData
        });

        if (error) {
            console.error('RPC Sync Failure:', error);
            throw new Error(`Failed to sync curriculum: ${error.message}`);
        }

        console.log('RPC Sync Success:', data);
        return data;
    },

    async saveSection(courseId, sectionData) {
        console.log('CourseService.saveSection:', { courseId, sectionData });
        try {
            const dbPayload = {
                course_id: courseId,
                title: sectionData.title || 'Untitled Section',
                order_index: sectionData.order_index ?? 0
            };

            // If we have an ID (even a client-generated UUID), use upsert.
            // This avoids the false-positive where a client UUID passes length checks
            // but doesn't yet exist in the DB, causing .update().single() to fail.
            if (sectionData.id) {
                dbPayload.id = sectionData.id;
            }

            const { data, error } = await supabase
                .from('course_sections')
                .upsert(dbPayload, { onConflict: 'id' })
                .select()
                .maybeSingle();
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error in saveSection:', error);
            throw error;
        }
    },

    async deleteSection(sectionId) {
        console.log('CourseService.deleteSection:', sectionId);
        try {
            const { error } = await supabase.from('course_sections').delete().eq('id', sectionId);
            if (error) throw error;
        } catch (error) {
            console.error('Error in deleteSection:', error);
            throw error;
        }
    },

    async saveLesson(sectionId, lessonData) {
        console.log('CourseService.saveLesson:', { sectionId, lessonData });
        try {
            const resources = lessonData.resources;
            const quiz = lessonData.quiz;

            // Build a clean payload with ONLY known DB columns
            const dbPayload = {
                section_id: sectionId,
                title: lessonData.title || 'Untitled Lesson',
                content_type: lessonData.content_type || 'text',
                description: lessonData.description || '',
                is_preview: lessonData.is_preview || false,
                order_index: lessonData.order_index ?? 0
            };

            // SAFE VIDEO PERSISTENCE: 
            // 1. Check for lessonData.video.url (Wizard shape) 
            // 2. Check for lessonData.video_url (DB/Service shape)
            // 3. ONLY update if a valid URL exists to prevent accidental NULL overwrites
            const videoUrl = lessonData.video?.url || lessonData.video_url;
            if (videoUrl) {
                dbPayload.video_url = videoUrl;
                // Auto-resolve media_asset_id from the catalog if it's a platform upload
                const { data: assetData } = await supabase
                    .from('course_media_assets')
                    .select('id')
                    .eq('public_url', videoUrl)
                    .maybeSingle();
                if (assetData) {
                    dbPayload.media_asset_id = assetData.id;
                }
            }


            // Include the ID (even client-generated UUIDs) so upsert can match
            // existing rows. This avoids the false-positive where a client UUID passes
            // length checks but doesn't exist in the DB, causing .update().single() to
            // throw 'cannot coerce result to a single JSON object'.
            if (lessonData.id) {
                dbPayload.id = lessonData.id;
            }

            const { data, error } = await supabase
                .from('course_lessons')
                .upsert(dbPayload, { onConflict: 'id' })
                .select()
                .maybeSingle();
            if (error) throw error;
            let savedLesson = data;

            // Handle resources for this lesson (always clear and rebuild for simplicity in wizard)
            await supabase.from('lesson_resources').delete().eq('lesson_id', savedLesson.id);
            if (resources && resources.length > 0) {
                const resourcePayloads = resources.map(r => ({
                    lesson_id: savedLesson.id,
                    title: r.title,
                    file_url: r.file_url || '',
                    file_type: r.file_type || 'unknown'
                }));
                await supabase.from('lesson_resources').insert(resourcePayloads);
            }

            // Handle quizzes (Standardized JSON-Sync System - Supports Multiple Quizzes)
            if (lessonData.quiz && lessonData.quiz.length > 0) {
                console.log(`Syncing ${lessonData.quiz.length} quizzes for lesson:`, savedLesson.id);

                // Track IDs of quizzes that should stay
                const activeQuizIds = [];

                for (const [qzIdx, qz] of lessonData.quiz.entries()) {
                    let quizId = qz.id;

                    const quizPayload = {
                        lesson_id: savedLesson.id,
                        title: qz.title || `Quiz ${qzIdx + 1}`,
                        description: qz.description || '',
                        passing_score_percentage: qz.passing_score_percentage ?? 70
                    };

                    if (quizId) {
                        const { error: qErr } = await supabase.from('quizzes').update(quizPayload).eq('id', quizId);
                        if (qErr) throw qErr;
                        activeQuizIds.push(quizId);
                    } else {
                        const { data: newQuiz, error: qErr } = await supabase.from('quizzes').insert([quizPayload]).select().maybeSingle();
                        if (qErr) throw qErr;
                        quizId = newQuiz.id;
                        qz.id = quizId;
                        activeQuizIds.push(quizId);
                    }

                    if (qz.questions && qz.questions.length > 0) {
                        const activeQuestionIds = [];

                        for (const [index, q] of qz.questions.entries()) {
                            // Normalize question text
                            const qText = q.text || q.question_text || 'Question?';

                            const { data: qnData, error: qnErr } = await supabase.from('quiz_questions').upsert({
                                id: q.id || undefined,
                                quiz_id: quizId,
                                question_text: qText,
                                order_index: q.order_index ?? index
                            }).select().maybeSingle();

                            if (qnErr) throw qnErr;
                            if (qnData) {
                                q.id = qnData.id;
                                activeQuestionIds.push(qnData.id);

                                if (q.options && q.options.length > 0) {
                                    // Full wipe and rebuild of options for this question (cleanest for wizard)
                                    await supabase.from('quiz_options').delete().eq('question_id', qnData.id);

                                    const optPayloads = q.options.map((op, oIdx) => ({
                                        question_id: qnData.id,
                                        option_text: op.text || op.option_text || `Option ${oIdx + 1}`,
                                        is_correct: op.correct !== undefined ? op.correct : (op.is_correct || false),
                                        order_index: op.order_index ?? oIdx
                                    }));
                                    await supabase.from('quiz_options').insert(optPayloads);
                                }
                            }
                        }

                        // Cleanup removed questions for THIS quiz
                        if (activeQuestionIds.length > 0) {
                            await supabase.from('quiz_questions')
                                .delete()
                                .eq('quiz_id', quizId)
                                .not('id', 'in', `(${activeQuestionIds.join(',')})`);
                        }
                    }
                }

                // Cleanup removed quizzes for THIS lesson
                if (activeQuizIds.length > 0) {
                    await supabase.from('quizzes')
                        .delete()
                        .eq('lesson_id', savedLesson.id)
                        .not('id', 'in', `(${activeQuizIds.join(',')})`);
                }
            } else {
                // If lesson has no quizzes, ensure they are all deleted
                await supabase.from('quizzes').delete().eq('lesson_id', savedLesson.id);
            }


            return savedLesson;
        } catch (error) {
            console.error('Error in saveLesson:', error);
            throw error;
        }
    },

    async deleteLesson(lessonId) {
        console.log('CourseService.deleteLesson:', lessonId);
        try {
            const { error } = await supabase.from('course_lessons').delete().eq('id', lessonId);
            if (error) throw error;
        } catch (error) {
            console.error('Error in deleteLesson:', error);
            throw error;
        }
    },

    /** File Uploads */
    async uploadFile(bucket, path, file) {
        const { data, error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
        if (error) throw error;

        const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(data.path);
        return urlData.publicUrl;
    },

    async uploadCourseThumbnail(courseId, file) {
        const fileName = `${courseId ? courseId : 'new'}/thumb_${Date.now()}`;
        return await this.uploadFile('course_thumbnails', fileName, file);
    },

    async uploadCourseVideo(courseId, file) {
        const fileName = `${courseId ? courseId : 'new'}/video_${Date.now()}`;
        return await this.uploadFile('intro_videos', fileName, file);
    },

    async uploadLessonVideo(lessonId, file) {
        const fileName = `lessons/${lessonId ? lessonId : 'new'}/video_${Date.now()}`;
        const publicUrl = await this.uploadFile('course_videos', fileName, file);

        // Register in media assets
        await supabase.from('course_media_assets').insert([{
            storage_provider: 'supabase',
            storage_path: fileName,
            public_url: publicUrl,
            file_size_bytes: file.size || null
        }]);

        return publicUrl;
    },

    async uploadLessonResource(lessonId, file) {
        const fileName = `resources/${lessonId ? lessonId : 'new'}/${Date.now()}_${file.name}`;
        return await this.uploadFile('course_resources', fileName, file);
    },



    /** INSTRUCTOR COURSES */
    async getInstructorCourses() {
        const session = await AuthService.getSession();
        if (!session) throw new Error("Not authenticated");

        const { data, error } = await supabase
            .from('courses')
            .select(`
                *,
                serial_id,
                category:course_categories(name),
                enrollments(count),
                course_reviews(rating)
            `)
            .eq('instructor_id', session.user.id)
            .order('created_at', { ascending: false });
        if (error) throw error;

        // Normalize counts into flat fields for the dashboard
        return (data || []).map(course => {
            const enrollCount = course.enrollments?.[0]?.count ?? 0;
            const reviews = course.course_reviews || [];
            const reviewCount = reviews.length;
            const avgRating = reviewCount > 0
                ? reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviewCount
                : 0;
            return {
                ...course,
                enrolled_count: enrollCount,
                review_count: reviewCount,
                avg_rating: avgRating > 0 ? avgRating.toFixed(1) : '0.0'
            };
        });
    },

    /** ADMIN / MODERATION */
    async getPendingCourses() {
        try {
            const { data, error } = await supabase.rpc('get_pending_courses_admin');
            if (error) throw error;
            return data || [];
        } catch (e) {
            console.error("RPC Error fetching pending courses:", e);
            // Fallback to standard fetch (might be blocked by RLS)
            const { data, error } = await supabase
                .from('courses')
                .select(`
                    id, serial_id, title, subtitle, thumbnail_url, category_id, level, created_at,
                    instructor:profiles(id, full_name, email, avatar_url),
                    category:course_categories(name)
                `)
                .eq('status', 'pending_review')
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        }
    },

    async getCourseForReview(courseId) {
        // Includes instructor info and full curriculum
        try {
            const { data, error } = await supabase.rpc('get_course_details_admin', { p_course_id: courseId });
            if (error) throw error;
            return data;
        } catch (e) {
            console.error("RPC Error fetching course for review:", e);
            // Fallback
            const { data, error } = await supabase
                .from('courses')
                .select(`
                    *,
                    instructor:profiles(id, full_name, email, avatar_url),
                    category:course_categories(name),
                    sections:course_sections(
                        *,
                        lessons:course_lessons(*)
                    ),
                    coupons:course_coupons(*)
                `)
                .eq('id', courseId)
                .maybeSingle();

            if (error) throw error;
            return data;
        }
    },

    async approveCourse(courseId, instructorId, notes = "Approved by Admin") {
        const session = await AuthService.getSession();
        const moderatorId = session ? session.user.id : null;

        // Use RPC with SECURITY DEFINER to bypass RLS
        const { error } = await supabase.rpc('approve_course_admin', {
            p_course_id: courseId,
            p_instructor_id: instructorId,
            p_moderator_id: moderatorId,
            p_notes: notes
        });

        if (error) throw error;
    },

    async rejectCourse(courseId, instructorId, notes = "Rejected based on review.") {
        const session = await AuthService.getSession();
        const moderatorId = session ? session.user.id : null;

        // Use RPC with SECURITY DEFINER to bypass RLS
        const { error } = await supabase.rpc('reject_course_admin', {
            p_course_id: courseId,
            p_instructor_id: instructorId,
            p_moderator_id: moderatorId,
            p_notes: notes
        });

        if (error) throw error;
    },

    /** STUDENT ENROLLMENT & WISHLIST */
    async checkEnrollment(courseId, studentId) {
        const { data, error } = await supabase
            .from('enrollments')
            .select('id')
            .eq('course_id', courseId)
            .eq('student_id', studentId)
            .maybeSingle();
        if (error) throw error;
        return !!data;
    },

    async enrollCourse(courseId, studentId, paymentData = null) {
        // NEW: Check student account status
        const { data: profile, error: pErr } = await supabase
            .from('profiles')
            .select('account_status')
            .eq('id', studentId)
            .single();

        if (pErr) throw pErr;
        if (profile.account_status === 'suspended') {
            throw new Error("Your account is currently suspended. You cannot join new courses at this time.");
        }
        if (profile.account_status === 'blocked') {
            throw new Error("Your account is blocked. Access denied.");
        }

        // 1. Create Enrollment
        const { data: enrollment, error } = await supabase
            .from('enrollments')
            .insert([{ course_id: courseId, student_id: studentId }])
            .select()
            .single();
        if (error) throw error;

        // 2. Create Payment Record if paymentData is provided
        let paymentSerialId = null;
        if (paymentData) {
            let finalAmount = paymentData.amount || 0;

            // 🔥 APPLY COUPON DISCOUNT IF PROVIDED
            if (paymentData.couponCode) {
                const coupon = await this.validateCoupon(courseId, paymentData.couponCode);
                if (coupon && coupon.discount_percent) {
                    finalAmount = finalAmount * (1 - (coupon.discount_percent / 100));
                }
            }

            const { data: payRecord, error: payError } = await supabase
                .from('payments')
                .insert([{
                    student_id: studentId,
                    course_id: courseId,
                    amount: finalAmount,
                    currency: paymentData.currency || 'USD',
                    payment_provider: paymentData.provider || 'unknown',
                    payment_status: 'paid'
                }])
                .select('serial_id')
                .single();

            if (!payError && payRecord) {
                paymentSerialId = payRecord.serial_id;
            } else if (payError) {
                console.error("Optional payment record creation failed:", payError);
            }
        }

        // 3. Remove from wishlist
        await supabase.from('wishlist').delete().eq('course_id', courseId).eq('student_id', studentId);

        return { enrollment, paymentSerialId };
    },

    async checkWishlist(courseId, studentId) {
        const { data, error } = await supabase
            .from('wishlist')
            .select('id')
            .eq('course_id', courseId)
            .eq('student_id', studentId)
            .maybeSingle();
        if (error) throw error;
        return !!data;
    },

    async toggleWishlist(courseId, studentId) {
        // NEW: Check student account status
        const { data: profile, error: pErr } = await supabase
            .from('profiles')
            .select('account_status')
            .eq('id', studentId)
            .single();

        if (pErr) throw pErr;
        if (profile.account_status === 'suspended') {
            throw new Error("Your account is currently suspended.");
        }

        const isWishlisted = await this.checkWishlist(courseId, studentId);

        if (isWishlisted) {
            const { error } = await supabase
                .from('wishlist')
                .delete()
                .eq('course_id', courseId)
                .eq('student_id', studentId);
            if (error) throw error;
            return false;
        } else {
            const { error } = await supabase
                .from('wishlist')
                .insert([{ course_id: courseId, student_id: studentId }]);
            if (error) throw error;
            return true;
        }
    },

    /** REVIEWS */
    async getCourseReviews(courseId) {
        const { data, error } = await supabase
            .from('course_reviews')
            .select(`
                id,
                student_id,
                rating,
                review_text,
                created_at,
                reviewer:profiles(full_name, avatar_url)
            `)
            .eq('course_id', courseId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },

    async submitReview(courseId, studentId, rating, reviewText) {
        // Upsert so a student can update their review
        const { data, error } = await supabase
            .from('course_reviews')
            .upsert(
                [{ course_id: courseId, student_id: studentId, rating, review_text: reviewText }],
                { onConflict: 'course_id,student_id' }
            )
            .select()
            .maybeSingle();
        if (error) throw error;
        return data;
    },

    async hasReviewed(courseId, studentId) {
        const { data } = await supabase
            .from('course_reviews')
            .select('id')
            .eq('course_id', courseId)
            .eq('student_id', studentId)
            .maybeSingle();
        return !!data;
    },

    /** STATS */
    async getCourseStats(courseId) {
        const { data, error } = await supabase
            .from('enrollments')
            .select('id', { count: 'exact', head: true })
            .eq('course_id', courseId);
        const enrolledCount = error ? 0 : (data?.length ?? 0);

        // Count directly
        const { count: totalEnrolled } = await supabase
            .from('enrollments')
            .select('*', { count: 'exact', head: true })
            .eq('course_id', courseId);

        return { enrolledCount: totalEnrolled || 0 };
    },

    async getInstructorStats(instructorId) {
        try {
            // 1. Get ALL Courses for this instructor
            const { data: allCourses, error: cErr } = await supabase
                .from('courses')
                .select('id, status')
                .eq('instructor_id', instructorId);

            if (cErr) throw cErr;

            const allCourseIds = allCourses?.map(c => c.id) || [];
            const publishedCoursesCount = allCourses?.filter(c => c.status === 'published').length || 0;

            // 2. Get student count from enrollments for ALL these courses
            let studentCount = 0;
            if (allCourseIds.length > 0) {
                const { count, error: sErr } = await supabase
                    .from('enrollments')
                    .select('*', { count: 'exact', head: true })
                    .in('course_id', allCourseIds);
                if (!sErr && count) studentCount = count;
            }

            // 3. Get Mentor feedback rating
            let avgRating = '0.0';
            try {
                const { data: reviews } = await supabase
                    .from('mentorship_reviews')
                    .select('rating')
                    .eq('mentor_id', instructorId);

                if (reviews && reviews.length > 0) {
                    const total = reviews.reduce((sum, r) => sum + (r.rating || 0), 0);
                    avgRating = (total / reviews.length).toFixed(1);
                }
            } catch (err) {
                console.warn("Could not fetch mentor rating for stats:", err);
            }

            return {
                totalCourses: publishedCoursesCount,
                totalStudents: studentCount,
                avgRating: avgRating
            };
        } catch (e) {
            console.error('Error fetching instructor stats:', e);
            return { totalCourses: 0, totalStudents: 0, avgRating: '0.0' };
        }
    },

    async getInstructorExpertise(instructorId) {
        const { data } = await supabase
            .from('expertise_areas')
            .select('expertise_name')
            .eq('instructor_id', instructorId);
        return data?.map(e => e.expertise_name) || [];
    },

    /** COURSE APPEALS */
    async appealCourse(courseId, reason) {
        console.log('CourseService.appealCourse:', { courseId, reason });
        const { data, error } = await supabase.rpc('appeal_course_rejection_instructor', {
            p_course_id: courseId,
            p_appeal_reason: reason
        });

        if (error) {
            console.error('Appeal RPC Error:', error);
            throw error;
        }
        return data;
    },

    /** ADMIN APPEAL HANDLING */
    async handleAppeal(courseId, decision, notes = "") {
        console.log('CourseService.handleAppeal:', { courseId, decision, notes });
        const session = await AuthService.getSession();
        const moderatorId = session ? session.user.id : null;

        const { data, error } = await supabase.rpc('handle_course_appeal_admin', {
            p_course_id: courseId,
            p_decision: decision,
            p_moderator_id: moderatorId,
            p_notes: notes
        });

        if (error) {
            console.error('Handle Appeal RPC Error:', error);
            throw error;
        }
        return data;
    },

    // =========================================================================
    // COURSE REVISION WORKFLOW
    // =========================================================================

    /**
     * For a published course: returns an existing uncommitted revision, or
     * creates a deep clone (copy-on-write video assets) and returns its ID.
     * Safe to call repeatedly — idempotent.
     */
    async getOrCreateCourseRevision(courseId) {
        const { data, error } = await supabase.rpc('get_or_create_course_revision', {
            p_course_id: courseId
        });
        if (error) throw error;
        return data; // UUID of the draft revision
    },

    /**
     * Fetch all course versions in a family grouped by root_course_id.
     * Returns the published version + any pending revision.
     */
    async getInstructorCourseFamily(rootCourseId) {
        if (!rootCourseId || rootCourseId === 'null') return [];
        const { data, error } = await supabase
            .from('courses')
            .select('id, title, status, version_status, version_number, is_latest_published, root_course_id, created_at, rejection_reason, thumbnail_url')
            .or(`id.eq.${rootCourseId},root_course_id.eq.${rootCourseId}`)
            .order('version_number', { ascending: false });
        if (error) throw error;
        return data;
    },

    /**
     * Fetch all instructor courses grouped by family (one entry per family).
     * Returns the latest published or pending revision per family.
     */
    async getInstructorCoursesGrouped(instructorId = null) {
        let authId = instructorId;
        if (!authId) {
            const session = await AuthService.getSession();
            if (!session) throw new Error("Not authenticated");
            authId = session.user.id;
        }

        const { data, error } = await supabase
            .from('courses')
            .select(`
                id, title, status, version_status, version_number, is_latest_published, 
                root_course_id, created_at, rejection_reason, thumbnail_url, subtitle, 
                price, price_type, is_public, serial_id,
                category:course_categories(name),
                enrollments(count),
                course_reviews(rating),
                course_sections(course_lessons(id, quizzes(id), lesson_resources(id)))
            `)
            .eq('instructor_id', authId)
            .is('deleted_at', null)
            .order('created_at', { ascending: false });
        if (error) throw error;

        // Group by family: COALESCE(root_course_id, id)
        const families = {};
        for (const course of data) {
            const familyId = course.root_course_id || course.id;
            if (!families[familyId]) families[familyId] = [];
            families[familyId].push(course);
        }
        // Return one object per family with both the published version and any pending revision, computing family-wide metrics
        return Object.values(families).map(versions => {
            
            // Compute module counts directly for all versions returned
            versions.forEach(course => {
                let lessonsCount = 0;
                let quizzesCount = 0;
                let resourcesCount = 0;
                if (course.course_sections) {
                    for (const section of course.course_sections) {
                        if (section.course_lessons) {
                            lessonsCount += section.course_lessons.length;
                            for (const lesson of section.course_lessons) {
                                if (lesson.quizzes) quizzesCount += Array.isArray(lesson.quizzes) ? lesson.quizzes.length : (lesson.quizzes ? 1 : 0);
                                if (lesson.lesson_resources) resourcesCount += Array.isArray(lesson.lesson_resources) ? lesson.lesson_resources.length : (lesson.lesson_resources ? 1 : 0);
                            }
                        }
                    }
                }
                course.total_lessons = lessonsCount;
                course.total_quizzes = quizzesCount;
                course.total_resources = resourcesCount;
                delete course.course_sections;
            });

            const published = versions.find(v => v.status === 'published') || versions.find(v => v.is_latest_published) || versions[0];
            const revision = versions.find(v => v.id !== published.id && v.version_status !== 'archived');

            // Aggregate metrics across all versions in the family
            let familyEnrollCount = 0;
            let familyReviews = [];

            for (const v of versions) {
                familyEnrollCount += v.enrollments?.[0]?.count ?? 0;
                if (v.course_reviews && v.course_reviews.length > 0) {
                    familyReviews.push(...v.course_reviews);
                }
            }

            const reviewCount = familyReviews.length;
            const avgRating = reviewCount > 0
                ? familyReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviewCount
                : 0;

            if (revision) {
                // Ensure pending_edit maps correctly to 'draft' in our UI rendering layer if db returned pending_edit
                if (revision.status === 'pending_edit' || revision.version_status === 'pending_edit') {
                    revision.status = 'draft';
                }
            }

            return {
                ...published,
                pendingRevision: revision || null,
                enrolled_count: familyEnrollCount,
                review_count: reviewCount,
                avg_rating: avgRating > 0 ? avgRating.toFixed(1) : '0.0'
            };
        });
    },

    /**
     * Unified Dashboard & My Courses Display Service
     * Fetches grouped courses and explicitly unfolds revisions into separate physical entries
     * ensuring proper lifecycle routing.
     */
    async getInstructorCoursesForDisplay(instructorId = null) {
        const grouped = await this.getInstructorCoursesGrouped(instructorId);
        const displayList = [];

        for (const family of grouped) {
            // 1. The base course
            displayList.push(family);

            // 2. The pending revision (if any)
            if (family.pendingRevision) {
                const rev = { ...family.pendingRevision };
                
                // Transfer view metrics to the revision row so analytics match root_course_id
                rev.enrolled_count = family.enrolled_count;
                rev.avg_rating = family.avg_rating;
                rev.review_count = family.review_count;
                rev.is_revision = true;
                
                // Add revision to the display list distinctly
                displayList.push(rev);
            }
        }
        
        return displayList;
    },

    /** Withdraw a pending review back to a raw draft state */
    async withdrawCourseReview(courseId) {
        const { data, error } = await supabase
            .from('courses')
            .update({ status: 'draft' })
            .eq('id', courseId)
            .eq('status', 'pending_review')
            .select()
            .single();
            
        if (error) throw error;
        return data;
    },

    /**
     * Notify enrolled students (on older versions) that a new approved version
     * of the course is available. Optionally attaches an update_migration coupon.
     * Returns count of students notified.
     */
    async createUpdateOffer(rootCourseId, toVersionId, couponId = null, notify = true) {
        const { data, error } = await supabase.rpc('create_update_offer', {
            p_root_course_id: rootCourseId,
            p_to_version_id: toVersionId,
            p_coupon_id: couponId,
            p_notify: notify
        });
        if (error) throw error;
        return data; // number of students offered
    },

    /**
     * Fetch all unredeemed update offers for the currently authenticated student.
     */
    async getUpdateOffersForStudent() {
        const { data, error } = await supabase
            .from('course_update_offers')
            .select(`
                id, root_course_id, to_version_id, from_version_id, notified_at, redeemed_at,
                coupon:course_coupons!coupon_id (id, code, discount_percent),
                to_version:courses!to_version_id(id, title, thumbnail_url, slug, version_number, price, price_type, course_sections(title, course_lessons(title))),
                from_version:courses!from_version_id(id, title, course_sections(title, course_lessons(title)))
            `)
            .is('redeemed_at', null)
            .not('notified_at', 'is', null);
        if (error) throw error;
        return data;
    },

    /**
     * Mark a course update offer as redeemed (called after successful re-enrollment).
     */
    async markOfferRedeemed(offerId) {
        // Fetch the offer to get root_course_id, to_version_id, and student_id
        const { data: offer, error: getErr } = await supabase
            .from('course_update_offers')
            .select('student_id, root_course_id, to_version_id')
            .eq('id', offerId)
            .single();

        if (offer && offer.root_course_id) {
            // Find all courses with the same root_course_id
            const { data: coursesInFamily } = await supabase
                .from('courses')
                .select('id')
                .eq('root_course_id', offer.root_course_id);

            if (coursesInFamily) {
                // Preserve the new version, supersede the rest
                const oldCourseIds = coursesInFamily.map(c => c.id).filter(id => id !== offer.to_version_id);
                if (oldCourseIds.length > 0) {
                    const { error: updErr } = await supabase
                        .from('enrollments')
                        .update({ status: 'superseded' })
                        .eq('student_id', offer.student_id)
                        .in('course_id', oldCourseIds);
                    
                    if (updErr) console.warn("Could not archive old enrollments:", updErr);
                }
            }
        }

        const { error } = await supabase
            .from('course_update_offers')
            .update({ redeemed_at: new Date().toISOString() })
            .eq('id', offerId);
        if (error) throw error;
    }
};

