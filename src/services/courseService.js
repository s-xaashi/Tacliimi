import { supabase } from './supabaseClient.js';
import { AuthService } from './authService.js';

export const CourseService = {

    /** Generate a slug from a title */
    generateSlug(title) {
        return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '') + '-' + Math.random().toString(36).substring(2, 6);
    },

    /** CATEGORIES */
    async getCategories() {
        const { data, error } = await supabase.from('course_categories').select('*').order('name');
        if (error) throw error;
        return data;
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
        // (Guard against old bug where subtitle text was written to slug column)
        const slugIsInvalid = !courseData.slug || /\s/.test(courseData.slug);
        if (slugIsInvalid && courseData.title) {
            courseData.slug = this.generateSlug(courseData.title);
        }

        const payload = { ...courseData, instructor_id: session.user.id };
        delete payload.id;
        delete payload.sections;
        delete payload.coupons;
        delete payload.category;

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
        return await this.uploadFile('course_videos', fileName, file);
    },

    async uploadLessonResource(lessonId, file) {
        const fileName = `resources/${lessonId ? lessonId : 'new'}/${Date.now()}_${file.name}`;
        return await this.uploadFile('course_resources', fileName, file);
    },

    /** COUPONS */
    async saveCoupon(courseId, code, discountPercent, expiresAt, startsAt = null) {
        const payload = {
            course_id: courseId,
            code: code,
            discount_percent: discountPercent,
            expires_at: expiresAt,
            starts_at: startsAt || new Date().toISOString(),
            is_active: true
        };
        const { data, error } = await supabase.from('course_coupons').insert([payload]).select().maybeSingle();
        if (error) throw error;
        return data;
    },

    /** COUPON VALIDATION */
    async validateCoupon(courseId, code) {
        if (!code) return null;
        
        const now = new Date().toISOString();
        const { data, error } = await supabase
            .from('course_coupons')
            .select('*')
            .eq('course_id', courseId)
            .eq('code', code.trim().toUpperCase())
            .eq('is_active', true)
            .lte('starts_at', now)
            .gte('expires_at', now)
            .maybeSingle();

        if (error) {
            console.error('Coupon validation error:', error);
            return null;
        }
        return data; // Returns coupon object { discount_percent, etc } or null
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
                category:course_categories(name)
            `)
            .eq('instructor_id', session.user.id)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
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
        const [coursesRes, studentsRes] = await Promise.all([
            supabase
                .from('courses')
                .select('id', { count: 'exact', head: true })
                .eq('instructor_id', instructorId),
            supabase
                .from('enrollments')
                .select('course_id', { count: 'exact', head: false })
                .in('course_id',
                    (await supabase.from('courses').select('id').eq('instructor_id', instructorId)).data?.map(c => c.id) || []
                )
        ]);
        return {
            totalCourses: coursesRes.count || 0,
            totalStudents: studentsRes.data?.length || 0,
        };
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
        const { data, error } = await supabase
            .from('courses')
            .update({
                status: 'appealed',
                rejection_reason: reason,
                updated_at: new Date().toISOString()
            })
            .eq('id', courseId)
            .select()
            .single();

        if (error) throw error;
        return data;
    }
};
