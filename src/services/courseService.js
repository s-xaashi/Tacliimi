import { supabase } from './supabaseClient.js';
import { AuthService } from './authService.js';
import { uploadPublicImage } from './r2ImageUpload.js';

// ── File Validation Constants ───────────────────────────────────────────────
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const MAX_LESSON_VIDEO_BYTES = 500 * 1024 * 1024; // 500 MB
const MAX_COURSE_VIDEO_BYTES = 500 * 1024 * 1024; // 500 MB
const ALLOWED_RESOURCE_TYPES = [
    'application/pdf', 'application/zip', 'application/x-zip-compressed',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
    'application/vnd.ms-powerpoint', // ppt
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
    'text/plain', 'text/csv'
];
const MAX_RESOURCE_BYTES = 50 * 1024 * 1024; // 50 MB

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
                        id, title, description, video_url, video_storage_key, video_provider, content_type, is_preview, order_index,
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

    /** Increment views count for a course */
    async incrementCourseViews(courseId) {
        if (!courseId) return;
        try {
            await supabase.rpc('increment_course_views', { p_course_id: courseId });
        } catch (err) {
            console.warn("Failed to increment course views:", err);
        }
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
        
        // Always annotate every course with _boost_order so the sort is always applied.
        // If the RPC fails, boostedIds defaults to [] and all courses stay at 999999,
        // preserving the original DB order gracefully.
        let boostedIds = [];
        let banners = [];
        try {
            const { BoostService } = await import('./boostService.js');
            [boostedIds, banners] = await Promise.all([
                BoostService.getBoostedEntityIds('course'),
                BoostService.getActivePromoBanners('course')
            ]);
        } catch (err) {
            console.warn("Boost/banner fetch failed, falling back to DB order:", err);
        }

        const bannerMap = {};
        banners.forEach(b => bannerMap[b.entity_id] = b.banner_text);

        data.forEach((course, i) => {
            const matchId = course.family_id;
            if (bannerMap[matchId]) course.banner_text = bannerMap[matchId];
            const bIdx = boostedIds.indexOf(matchId);
            // boosted courses: 0, 1, 2... (rotation order from RPC)
            // un-boosted courses: 999999 (stable secondary sort by original DB index)
            course._boost_order = bIdx !== -1 ? bIdx : 999999;
            course._original_idx = i;
        });

        // Boosted courses first (rotation order), then non-boosted in original DB order
        data.sort((a, b) => {
            if (a._boost_order !== b._boost_order) {
                return a._boost_order - b._boost_order;
            }
            return a._original_idx - b._original_idx;
        });

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

        // 🔴 SECURITY FIX: Strict Field Allowlist
        // Prevent mass assignment (e.g., injecting status, version_status, is_latest_published, etc.)
        const allowedFields = [
            'title', 'subtitle', 'description', 'thumbnail_url', 'intro_video_url',
            'intro_video_provider', 'intro_video_storage_key',
            'category_id', 'level', 'price', 'price_type', 'currency', 'is_public',
            'language', 'total_duration_minutes', 'what_you_learn', 'requirements',
            'slug', 'certificate_enabled'
        ];

        const payload = {};
        for (const field of allowedFields) {
            if (courseData[field] !== undefined) {
                payload[field] = courseData[field];
            }
        }
        // Force the instructor ID to the authenticated user on every save
        payload.instructor_id = session.user.id;

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
     * SECURITY: Only the owning instructor can submit their course.
     */
    async submitForReview(courseId) {
        // SECURITY: Use a server-authoritative SECURITY DEFINER RPC instead of a
        // direct PATCH. The RPC validates ownership and allowed state transitions
        // server-side, so instructors cannot bypass status guards.
        const { error } = await supabase.rpc('submit_course_for_review', {
            p_course_id: courseId
        });
        if (error) throw new Error(error.message);
    },

    /**
     * Acknowledge a course rejection and return it to draft status.
     * SECURITY: Only the owning instructor can ack their rejection.
     */
    async confirmRejection(courseId) {
        if (!courseId) throw new Error('Course ID is required');

        // Course workflow fields are protected by the database trigger. Use the
        // authenticated RPC so ownership and rejected-state checks remain server-side.
        const { data, error } = await supabase.rpc('confirm_course_rejection', {
            p_course_id: courseId
        });

        if (error) throw new Error(error.message || 'Failed to acknowledge course rejection');
        return data;
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

    /**
     * Delete an entire course family, not just the visible version.
     * Keep the root row until all revisions have been processed so a partial failure
     * can be retried without losing the family relationship.
     */
    async deleteCourse(courseId, onProgress = () => {}, options = {}) {
        if (!courseId) throw new Error("Course ID is required");
        if (options.deleteFamily === false) {
            const result = await this.deleteCourseRecord(courseId, onProgress);
            return { ...result, deletedCourseIds: [courseId] };
        }
        const session = await AuthService.getSession();
        if (!session?.access_token || !session.user?.id) throw new Error("Not authenticated");

        const { data: selectedCourse, error: selectedError } = await supabase
            .from('courses')
            .select('id, root_course_id, instructor_id')
            .eq('id', courseId)
            .maybeSingle();
        if (selectedError) throw selectedError;
        if (!selectedCourse) throw new Error("Course not found");
        if (selectedCourse.instructor_id !== session.user.id) throw new Error("You are not authorized to delete this course");

        const rootId = selectedCourse.root_course_id || selectedCourse.id;
        const { data: family, error: familyError } = await supabase
            .from('courses')
            .select('id, root_course_id, version_number, instructor_id')
            .eq('instructor_id', session.user.id)
            .or(`id.eq.${rootId},root_course_id.eq.${rootId}`)
            .order('version_number', { ascending: false });
        if (familyError) throw familyError;
        if (!family?.length || !family.some(version => version.id === selectedCourse.id)) {
            throw new Error("The course versions could not be safely identified. No deletion was started.");
        }

        // Delete newer revisions first and the root last. If a revision fails,
        // the root remains available to identify the family on retry.
        const orderedFamily = [...family].sort((a, b) => {
            if (a.id === rootId) return 1;
            if (b.id === rootId) return -1;
            return (b.version_number || 0) - (a.version_number || 0);
        });
        const results = [];
        for (let index = 0; index < orderedFamily.length; index++) {
            const version = orderedFamily[index];
            const result = await this.deleteCourseRecord(version.id, progress => {
                const localPercent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
                const percent = Math.round(((index + localPercent / 100) / orderedFamily.length) * 100);
                onProgress({
                    ...progress,
                    percent,
                    message: `Version ${index + 1} of ${orderedFamily.length}: ${progress.message || 'Removing course version…'}`
                });
            });
            results.push(result);
        }

        return {
            deleted: true,
            softDeleted: results.some(result => result.softDeleted),
            deletedCourseIds: orderedFamily.map(version => version.id),
            deletedVideoCount: results.reduce((sum, result) => sum + (result.deletedVideoCount || 0), 0),
            preservedSharedVideoCount: results.reduce((sum, result) => sum + (result.preservedSharedVideoCount || 0), 0)
        };
    },

    async deleteCourseRecord(courseId, onProgress = () => {}) {
        const session = await AuthService.getSession();
        if (!session?.access_token) throw new Error("Not authenticated");
        if (!courseId) throw new Error("Course ID is required");

        // The server owns the R2 credentials and validates course ownership.
        // Stream progress events so the instructor sees real storage-cleanup progress.
        const response = await fetch(`${supabase.supabaseUrl}/functions/v1/delete-course-with-r2`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${session.access_token}`,
                apikey: supabase.supabaseKey,
                'Content-Type': 'application/json',
                Accept: 'application/x-ndjson'
            },
            body: JSON.stringify({ course_id: courseId })
        });

        if (!response.ok) {
            const body = await response.text();
            let message = body;
            try { message = JSON.parse(body).error || body; } catch (_) {}
            throw new Error(message || 'Course deletion could not be started.');
        }
        if (!response.body) throw new Error('Deletion progress stream is unavailable. Please retry.');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalEvent = null;
        let streamError = null;

        const handleLine = (line) => {
            if (!line.trim()) return;
            let event;
            try { event = JSON.parse(line); } catch (_) { return; }
            if (event.type === 'progress') onProgress(event);
            if (event.type === 'done') finalEvent = event;
            if (event.type === 'error') streamError = new Error(event.message || 'Course deletion failed.');
        };

        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                lines.forEach(handleLine);
            }
            buffer += decoder.decode();
            if (buffer.trim()) handleLine(buffer);
        } finally {
            reader.releaseLock();
        }

        if (streamError) throw streamError;
        if (!finalEvent?.result?.deleted) {
            throw new Error('The server did not confirm course deletion. Please refresh and retry.');
        }
        onProgress({ type: 'progress', phase: 'complete', percent: 100, message: finalEvent.message });
        return {
            ...finalEvent.result,
            deletedVideoCount: finalEvent.deletedVideoCount ?? 0,
            preservedSharedVideoCount: finalEvent.preservedSharedVideoCount ?? 0
        };
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

    /**
     * Remove persisted sections/lessons that the instructor removed from the
     * current wizard draft. Saving/upserting current items alone cannot delete
     * rows omitted from the payload, which is why deleted content reappeared
     * in review/published course pages.
     */
    async pruneRemovedCurriculum(courseId, keptSectionIds, keptLessonIds) {
        if (!courseId) throw new Error('Course ID is required to sync curriculum deletions');
        const keepSections = new Set((keptSectionIds || []).filter(Boolean));
        const keepLessons = new Set((keptLessonIds || []).filter(Boolean));

        const { data: sections, error: fetchError } = await supabase
            .from('course_sections')
            .select('id, course_lessons(id, video_storage_key)')
            .eq('course_id', courseId);
        if (fetchError) throw fetchError;

        const allSections = sections || [];
        const removedLessons = allSections.flatMap(section =>
            (section.course_lessons || []).filter(lesson => !keepLessons.has(lesson.id))
        );

        // Remove stored R2 objects before deleting their lesson rows. If cleanup
        // fails, stop here so the object metadata isn't lost and can be retried.
        for (const lesson of removedLessons) {
            if (lesson.video_storage_key) {
                await this.deleteR2Video(courseId, lesson.id, 'lesson');
            }
        }

        const removedLessonIds = removedLessons.map(lesson => lesson.id);
        if (removedLessonIds.length) {
            const { error: lessonsDeleteError } = await supabase
                .from('course_lessons')
                .delete()
                .in('id', removedLessonIds);
            if (lessonsDeleteError) throw lessonsDeleteError;
        }

        const removedSectionIds = allSections
            .filter(section => !keepSections.has(section.id))
            .map(section => section.id);
        if (removedSectionIds.length) {
            const { error: sectionsDeleteError } = await supabase
                .from('course_sections')
                .delete()
                .eq('course_id', courseId)
                .in('id', removedSectionIds);
            if (sectionsDeleteError) throw sectionsDeleteError;
        }

        return { removedSections: removedSectionIds.length, removedLessons: removedLessonIds.length };
    },

    async saveLesson(sectionId, lessonData) {
        console.log('CourseService.saveLesson:', { sectionId, lessonData });
        try {
            const resources = lessonData.resources;

            // Build a clean payload with ONLY known DB columns
            const dbPayload = {
                section_id: sectionId,
                title: lessonData.title || 'Untitled Lesson',
                content_type: lessonData.content_type || 'text',
                description: lessonData.description || '',
                is_preview: lessonData.is_preview || false,
                order_index: lessonData.order_index ?? 0
            };

            // Persist the current video's fields explicitly for this lesson.
            // An empty URL is meaningful: it clears a previously saved URL instead of
            // silently retaining stale data from an earlier video/provider.
            const hasVideoObject = Object.prototype.hasOwnProperty.call(lessonData, 'video');
            const hasVideoUrlField = Object.prototype.hasOwnProperty.call(lessonData, 'video_url');
            const videoUrl = hasVideoObject
                ? (lessonData.video?.url ?? null)
                : (lessonData.video_url ?? null);
            const videoProvider = lessonData.video_provider || lessonData.video?.provider || null;
            const isYouTubeUrl = typeof videoUrl === 'string'
                && /(^|\/\/)(www\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)(\/|$)/i.test(videoUrl);

            if (hasVideoObject || hasVideoUrlField) {
                dbPayload.video_url = videoUrl;
                // Clear stale media references whenever the URL is absent or changed.
                dbPayload.media_asset_id = null;
                // YouTube videos are not registered in course_media_assets. Looking them
                // up for every lesson adds a needless RLS-protected query during saves.
                if (videoUrl && videoProvider !== 'youtube' && !isYouTubeUrl) {
                    const { data: assetData, error: assetLookupError } = await supabase
                        .from('course_media_assets')
                        .select('id')
                        .eq('public_url', videoUrl)
                        .maybeSingle();
                    if (assetLookupError) throw assetLookupError;
                    if (assetData) dbPayload.media_asset_id = assetData.id;
                }
            }

            // Explicit nulls are needed when switching providers; truthy-only writes
            // leave the old provider/key attached to the lesson in the database.
            if (Object.prototype.hasOwnProperty.call(lessonData, 'video_storage_key')) {
                dbPayload.video_storage_key = lessonData.video_storage_key || null;
            }
            if (Object.prototype.hasOwnProperty.call(lessonData, 'video_provider')) {
                dbPayload.video_provider = lessonData.video_provider || null;
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
            const savedLesson = data;
            if (!savedLesson?.id) throw new Error('Lesson save returned no record.');

            // Resources are replaced only after the lesson row has saved successfully.
            const { error: resourceDeleteError } = await supabase
                .from('lesson_resources')
                .delete()
                .eq('lesson_id', savedLesson.id);
            if (resourceDeleteError) throw resourceDeleteError;
            if (resources && resources.length > 0) {
                const resourcePayloads = resources.map(r => ({
                    lesson_id: savedLesson.id,
                    title: r.title,
                    file_url: r.file_url || '',
                    file_type: r.file_type || 'unknown'
                }));
                const { error: resourceInsertError } = await supabase
                    .from('lesson_resources')
                    .insert(resourcePayloads);
                if (resourceInsertError) throw resourceInsertError;
            }

            // Persist quiz content with batched question/option upserts. Only issue
            // deletion statements for IDs explicitly removed in the editor; the former
            // full replacement issued delete+insert requests for every option on every save.
            if (lessonData.quiz && lessonData.quiz.length > 0) {
                console.log(`Syncing ${lessonData.quiz.length} quizzes for lesson:`, savedLesson.id);

                for (const [qzIdx, qz] of lessonData.quiz.entries()) {
                    const quizPayload = {
                        ...(qz.id ? { id: qz.id } : {}),
                        lesson_id: savedLesson.id,
                        title: qz.title || `Quiz ${qzIdx + 1}`,
                        description: qz.description || '',
                        passing_score_percentage: qz.passing_score_percentage ?? 70
                    };

                    // Upsert supports both stable client-generated IDs for new quizzes
                    // and existing database IDs, avoiding a create/edit race in the modal.
                    const { data: savedQuiz, error: quizUpsertError } = await supabase
                        .from('quizzes')
                        .upsert(quizPayload, { onConflict: 'id' })
                        .select('id')
                        .maybeSingle();
                    if (quizUpsertError) throw quizUpsertError;
                    if (!savedQuiz?.id) throw new Error(`Quiz ${qzIdx + 1} save returned no record.`);
                    const quizId = savedQuiz.id;
                    qz.id = quizId;

                    const questions = Array.isArray(qz.questions) ? qz.questions : [];
                    if (questions.length > 0) {
                        const questionPayloads = questions.map((question, index) => ({
                            ...(question.id ? { id: question.id } : {}),
                            quiz_id: quizId,
                            question_text: question.text || question.question_text || 'Question?',
                            order_index: index
                        }));
                        const { data: savedQuestions, error: questionUpsertError } = await supabase
                            .from('quiz_questions')
                            .upsert(questionPayloads, { onConflict: 'id' })
                            .select('id, order_index');
                        if (questionUpsertError) throw questionUpsertError;
                        if (!savedQuestions || savedQuestions.length !== questions.length) {
                            throw new Error(`Quiz "${qz.title || qzIdx + 1}" did not save every question.`);
                        }

                        const questionByOrder = new Map(savedQuestions.map(question => [question.order_index, question]));
                        for (const [index, question] of questions.entries()) {
                            const savedQuestion = questionByOrder.get(index);
                            if (!savedQuestion?.id) throw new Error(`Question ${index + 1} save returned no record.`);
                            question.id = savedQuestion.id;
                            question.order_index = index;
                        }
                    }

                    for (const question of questions) {
                        const options = Array.isArray(question.options) ? question.options : [];
                        if (options.length > 0) {
                            const optionPayloads = options.map((option, index) => ({
                                ...(option.id ? { id: option.id } : {}),
                                question_id: question.id,
                                option_text: option.text || option.option_text || `Option ${index + 1}`,
                                is_correct: option.correct !== undefined ? option.correct : (option.is_correct || false),
                                order_index: index
                            }));
                            const { data: savedOptions, error: optionUpsertError } = await supabase
                                .from('quiz_options')
                                .upsert(optionPayloads, { onConflict: 'id' })
                                .select('id, order_index');
                            if (optionUpsertError) throw optionUpsertError;
                            if (!savedOptions || savedOptions.length !== options.length) {
                                throw new Error(`Question "${question.text || question.question_text || 'Untitled'}" did not save every answer option.`);
                            }

                            savedOptions.forEach(option => {
                                const target = options[option.order_index];
                                if (target) {
                                    target.id = option.id;
                                    target.order_index = option.order_index;
                                }
                            });
                        }

                        const deletedOptionIds = [...new Set((question._deletedOptionIds || []).filter(Boolean))];
                        if (deletedOptionIds.length > 0) {
                            const { error: optionDeleteError } = await supabase
                                .from('quiz_options')
                                .delete()
                                .eq('question_id', question.id)
                                .in('id', deletedOptionIds);
                            if (optionDeleteError) throw optionDeleteError;
                            delete question._deletedOptionIds;
                        }
                    }

                    const deletedQuestionIds = [...new Set((qz._deletedQuestionIds || []).filter(Boolean))];
                    if (deletedQuestionIds.length > 0) {
                        const { error: questionDeleteError } = await supabase
                            .from('quiz_questions')
                            .delete()
                            .eq('quiz_id', quizId)
                            .in('id', deletedQuestionIds);
                        if (questionDeleteError) throw questionDeleteError;
                        delete qz._deletedQuestionIds;
                    }
                }

                const deletedQuizIds = [...new Set((lessonData._deletedQuizIds || []).filter(Boolean))];
                if (deletedQuizIds.length > 0) {
                    const { error: quizDeleteError } = await supabase
                        .from('quizzes')
                        .delete()
                        .eq('lesson_id', savedLesson.id)
                        .in('id', deletedQuizIds);
                    if (quizDeleteError) throw quizDeleteError;
                    // The wizard passes a shallow copy of the lesson, so clear the
                    // shared deletion queue in place after confirmed success.
                    if (Array.isArray(lessonData._deletedQuizIds)) lessonData._deletedQuizIds.length = 0;
                }
            } else {
                // Switching a lesson away from quizzes intentionally removes all its quizzes.
                const { error: quizDeleteError } = await supabase
                    .from('quizzes')
                    .delete()
                    .eq('lesson_id', savedLesson.id);
                if (quizDeleteError) throw quizDeleteError;
                if (Array.isArray(lessonData._deletedQuizIds)) lessonData._deletedQuizIds.length = 0;
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
    /**
     * SECURITY: Validates file type and size before uploading.
     * @param {string} bucket - Supabase storage bucket name
     * @param {string} path - Target path within the bucket
     * @param {File} file - File object to upload
     * @param {string[]} allowedTypes - Allowed MIME types
     * @param {number} maxBytes - Maximum allowed file size in bytes
     */
    async uploadFile(bucket, path, file, allowedTypes, maxBytes) {
        // SECURITY: Validate file type and size if constraints are provided
        if (allowedTypes && !allowedTypes.includes(file.type)) {
            throw new Error(`Invalid file type "${file.type}". Allowed: ${allowedTypes.join(', ')}`);
        }
        if (maxBytes && file.size > maxBytes) {
            const maxMB = (maxBytes / (1024 * 1024)).toFixed(0);
            throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed: ${maxMB} MB.`);
        }

        // These upload paths are versioned/unique, so long-lived CDN caching is safe.
        const { data, error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true, cacheControl: '31536000' });
        if (error) throw error;

        const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(data.path);
        return urlData.publicUrl;
    },

    async uploadCourseThumbnail(courseId, file) {
        const session = await AuthService.getSession();
        if (!session?.user?.id) throw new Error("Not authenticated");
        if (!ALLOWED_IMAGE_TYPES.includes(file?.type)) {
            throw new Error(`Invalid image type "${file?.type}". Allowed: ${ALLOWED_IMAGE_TYPES.join(', ')}`);
        }
        if (file.size > MAX_IMAGE_BYTES) {
            throw new Error(`Image too large. Maximum allowed: ${(MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(0)} MB.`);
        }

        return await uploadPublicImage({ file, purpose: 'thumbnail', courseId: courseId || null });
    },

    async uploadCourseVideo(courseId, file) {
        const session = await AuthService.getSession();
        if (!session?.user?.id) throw new Error("Not authenticated");

        // SERVICE-LAYER GUARD: blocks the UI and direct calls to this service function.
        // Note: this does not enforce at the Supabase Storage RLS level — a caller
        // that bypasses this service and calls the Supabase storage client directly
        // would not be blocked. Acceptable for a cost-control toggle.
        const { data: settingsRow } = await supabase
            .from('platform_settings')
            .select('self_hosted_video_uploads_enabled')
            .limit(1)
            .maybeSingle();
        if (settingsRow && settingsRow.self_hosted_video_uploads_enabled === false) {
            throw new Error('Self-hosted video uploads are currently disabled. Please use a YouTube URL instead.');
        }
        const fileName = `${session.user.id}/${courseId ? courseId : 'new'}/video_${Date.now()}`;
        return await this.uploadFile('intro_videos', fileName, file, ALLOWED_VIDEO_TYPES, MAX_COURSE_VIDEO_BYTES);
    },

    async uploadLessonVideo(lessonId, file) {
        const session = await AuthService.getSession();
        if (!session?.user?.id) throw new Error("Not authenticated");

        // SERVICE-LAYER GUARD (same boundary as uploadCourseVideo — see note above)
        const { data: settingsRow } = await supabase
            .from('platform_settings')
            .select('self_hosted_video_uploads_enabled')
            .limit(1)
            .maybeSingle();
        if (settingsRow && settingsRow.self_hosted_video_uploads_enabled === false) {
            throw new Error('Self-hosted video uploads are currently disabled. Please use a YouTube URL instead.');
        }
        const fileName = `${session.user.id}/${lessonId ? lessonId : 'new'}/video_${Date.now()}`;
        const publicUrl = await this.uploadFile('course_videos', fileName, file, ALLOWED_VIDEO_TYPES, MAX_LESSON_VIDEO_BYTES);

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
        const session = await AuthService.getSession();
        if (!session?.user?.id) throw new Error("Not authenticated");

        const fileName = `${session.user.id}/${lessonId ? lessonId : 'new'}/${Date.now()}_${file.name}`;
        return await this.uploadFile('course_resources', fileName, file, ALLOWED_RESOURCE_TYPES, MAX_RESOURCE_BYTES);
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
            
            // Patch missing field from older RPC definition
            if (data && data.certificate_enabled === undefined) {
                 const { data: certData } = await supabase
                     .from('courses')
                     .select('certificate_enabled')
                     .eq('id', courseId)
                     .maybeSingle();
                 if (certData) data.certificate_enabled = certData.certificate_enabled;
            }

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
    async getCertificate(studentId, courseId) {
        const { data, error } = await supabase
            .from('certificates')
            .select('*')
            .eq('student_id', studentId)
            .eq('course_id', courseId)
            .maybeSingle();
        if (error) throw error;
        return data;
    },

    async getCertificateGenerationStatus(studentId, courseId) {
        const { data, error } = await supabase
            .rpc('get_certificate_generation_status', {
                p_student_id: studentId,
                p_course_id: courseId
            });
        if (error) throw error;
        return data;
    },

    async generateCertificate(studentId, courseId) {
        const { data, error } = await supabase
            .rpc('generate_certificate', { p_student_id: studentId, p_course_id: courseId })
            .single();
        if (error) throw error;
        return data;
    },

    async verifyCertificate(code) {
        const { data, error } = await supabase
            .rpc('verify_certificate', { p_code: code });
        if (error) throw error;
        return { valid: !!(data && data.length > 0), certificate: data?.[0] || null };
    },

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

    async enrollCourseWithFreeCoupon(courseId, studentId, couponCode) {
        if (!couponCode || !String(couponCode).trim()) {
            throw new Error('Apply a valid 100% coupon before enrolling for free.');
        }
        const { data: enrollment, error } = await supabase.rpc('enroll_course_with_free_coupon', {
            p_course_id: courseId,
            p_coupon_code: String(couponCode).trim().toUpperCase()
        });
        if (error) throw error;

        const result = Array.isArray(enrollment) ? enrollment[0] : enrollment;
        if (!result) throw new Error('Enrollment could not be completed. Please try again.');

        // The RPC removes the wishlist entry atomically after successful enrollment.
        return { enrollment: result, paymentSerialId: null };
    },

    async enrollCourse(courseId, studentId, paymentData = null) {
        // Free courses use the database's authenticated, server-validated enrollment path.
        // Paid-course handling remains on its existing path so checkout behavior is unchanged.
        if (!paymentData) {
            const { data: enrollment, error } = await supabase.rpc('enroll_free_course', {
                p_course_id: courseId
            });
            if (error) throw error;

            // The RPC is idempotent and returns the existing enrollment if already enrolled.
            const result = Array.isArray(enrollment) ? enrollment[0] : enrollment;
            if (!result) throw new Error('Enrollment could not be completed. Please try again.');

            // Preserve the existing wishlist cleanup after successful enrollment.
            await supabase.from('wishlist').delete().eq('course_id', courseId).eq('student_id', studentId);
            return { enrollment: result, paymentSerialId: null };
        }

        // Existing post-checkout enrollment path for paid courses (unchanged).
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

    async getStudentWishlist(studentId) {
        const { data, error } = await supabase
            .from('wishlist')
            .select('course_id')
            .eq('student_id', studentId);
        if (error) throw error;
        return data || [];
    },

    /** REVIEWS */
    async getCourseReviews(courseId) {
        const { data: reviews, error } = await supabase
            .from('course_reviews')
            .select('id, student_id, rating, review_text, created_at')
            .eq('course_id', courseId)
            .order('created_at', { ascending: false });
        if (error) throw error;

        if (!reviews?.length) return [];

        // This view exposes only the name/avatar needed to display reviews
        // on public published courses, without making private profiles public.
        const { data: reviewerDetails, error: reviewerError } = await supabase
            .from('public_course_review_display')
            .select('review_id, full_name, avatar_url')
            .eq('course_id', courseId);

        if (reviewerError) throw reviewerError;

        const reviewerByReviewId = new Map(
            (reviewerDetails || []).map(reviewer => [reviewer.review_id, {
                full_name: reviewer.full_name,
                avatar_url: reviewer.avatar_url
            }])
        );

        return reviews.map(review => ({
            ...review,
            reviewer: reviewerByReviewId.get(review.id) || {}
        }));
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
        if (!courseId) return { enrolledCount: 0 };

        // Use a narrow public aggregate RPC so RLS on enrollment rows does not
        // make the displayed count differ between anonymous and signed-in users.
        // The RPC returns only a count and only for published public course versions.
        const { data, error } = await supabase.rpc('get_public_course_enrollment_count', {
            p_course_id: courseId
        });

        if (error) throw error;

        const enrolledCount = Array.isArray(data) ? (data[0] ?? 0) : (data ?? 0);
        return { enrolledCount: Number(enrolledCount) || 0 };
    },

    async getInstructorStats(instructorId) {
        try {
            // Public profile stats are calculated by a narrow aggregate RPC so
            // student-facing pages do not depend on direct access to enrollment rows.
            // The RPC counts only latest, published, non-deleted public course families.
            const { data: publicStats, error: statsError } = await supabase.rpc(
                'get_public_instructor_course_stats',
                { p_instructor_id: instructorId }
            );

            if (statsError) throw statsError;
            const stats = Array.isArray(publicStats) ? publicStats[0] : publicStats;

            // Get mentor feedback rating separately; preserve the existing rating behavior.
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
                totalCourses: Number(stats?.total_courses || 0),
                totalStudents: Number(stats?.total_students || 0),
                avgRating
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

    /** Withdraw a pending review back to draft using the trusted workflow RPC. */
    async withdrawCourseReview(courseId) {
        if (!courseId) throw new Error('Course ID is required');

        const { data, error } = await supabase.rpc('withdraw_course_review', {
            p_course_id: courseId
        });

        if (error) throw new Error(error.message || 'Failed to withdraw course review');
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
        if (!offerId) throw new Error('Course update offer ID is required.');

        // Load and validate the offer before changing enrollment history.
        const { data: offer, error: getErr } = await supabase
            .from('course_update_offers')
            .select('id, student_id, root_course_id, to_version_id, redeemed_at')
            .eq('id', offerId)
            .single();
        if (getErr) throw getErr;
        if (!offer) throw new Error('Course update offer was not found.');

        // Redeeming an offer is idempotent. Mark it first so the enrollment
        // success flow is not blocked by optional history cleanup.
        const { error: redeemError } = await supabase
            .from('course_update_offers')
            .update({ redeemed_at: new Date().toISOString() })
            .eq('id', offerId);
        if (redeemError) throw redeemError;

        if (offer.root_course_id) {
            const { data: coursesInFamily, error: familyError } = await supabase
                .from('courses')
                .select('id')
                .or(`id.eq.${offer.root_course_id},root_course_id.eq.${offer.root_course_id}`);
            if (familyError) {
                console.warn('Offer redeemed, but course-family lookup failed:', familyError);
                return;
            }

            const oldCourseIds = (coursesInFamily || [])
                .map(course => course.id)
                .filter(id => id !== offer.to_version_id);
            if (oldCourseIds.length > 0) {
                const { error: updErr } = await supabase
                    .from('enrollments')
                    .update({ status: 'superseded' })
                    .eq('student_id', offer.student_id)
                    .in('course_id', oldCourseIds);
                if (updErr) {
                    // Offer is already redeemed; keep enrollment success intact and
                    // log cleanup failure for later diagnosis.
                    console.warn('Offer redeemed, but old enrollment cleanup failed:', updErr);
                }
            }
        }
    },

    /** CLOUDFLARE R2 VIDEO INTEGRATION */

    async uploadToR2(courseId, lessonId, type, file, onProgress, signal) {
        const session = await AuthService.getSession();
        if (!session) throw new Error("Not authenticated");

        // Telemetry instrumentation
        const telemetry = {
            fileSize: file.size,
            startTime: performance.now(),
            createAuthDuration: 0,
            createDuration: 0,
            presignTimings: [],
            partUploadTimings: [],
            completeDuration: 0,
            partCount: 0,
            partSize: 0,
            firstPartUploadStart: null,
            lastPartUploadFinish: null,
            concurrency: 0,
            clientProcessingNote: "No client-side video processing, hashing, converting or compressing is performed before/during upload. Raw file object from input is uploaded."
        };

        const t0_create = performance.now();
        // 1. Create Multipart Upload
        const createRes = await supabase.functions.invoke('r2-multipart-create', {
            body: { 
                course_id: courseId, 
                lesson_id: lessonId, 
                type: type, 
                content_type: file.type,
                file_size: file.size
            }
        });
        telemetry.createDuration = performance.now() - t0_create;
        
        if (createRes.error) throw new Error(`Init upload failed: ${createRes.error.message}`);
        
        const { uploadId, objectKey, partCount, partSize } = createRes.data;
        telemetry.partCount = partCount;
        telemetry.partSize = partSize;

        // Configuration
        const MAX_RETRIES = 3;
        const CONCURRENCY_LIMIT = 4;
        telemetry.concurrency = Math.min(CONCURRENCY_LIMIT, partCount);
        const parts = [];
        let totalUploadedBytes = 0;

        // Exponential Backoff Delay
        const delay = (ms) => new Promise(res => setTimeout(res, ms));

        // Part uploader function
        const uploadPart = async (partNumber) => {
            const startByte = (partNumber - 1) * partSize;
            const endByte = Math.min(partNumber * partSize, file.size);
            const chunk = file.slice(startByte, endByte);
            const chunkSize = endByte - startByte;
            let attempt = 0;

            const partTelemetry = {
                partNumber,
                size: chunkSize,
                presignDuration: 0,
                uploadStart: null,
                uploadEnd: null,
                duration: 0,
                retryCount: 0,
                httpStatus: null,
                errs: []
            };

            while (attempt <= MAX_RETRIES) {
                if (signal && signal.aborted) throw new Error('Upload cancelled');
                partTelemetry.retryCount = attempt;
                
                try {
                    const t0_presign = performance.now();
                    // Get presigned URL for this part
                    const preRes = await supabase.functions.invoke('r2-multipart-presign', {
                        body: {
                            course_id: courseId,
                            upload_id: uploadId,
                            object_key: objectKey,
                            part_numbers: [partNumber]
                        }
                    });
                    const t1_presign = performance.now();
                    partTelemetry.presignDuration += (t1_presign - t0_presign);

                    if (preRes.error) throw new Error(`Presign failed: ${preRes.error.message}`);
                    const presignedUrl = preRes.data.presignedUrls[0].url;

                    // Upload chunk
                    const partResult = await new Promise((resolve, reject) => {
                        const xhr = new XMLHttpRequest();
                        xhr.open('PUT', presignedUrl, true);
                        
                        partTelemetry.uploadStart = performance.now();
                        if (!telemetry.firstPartUploadStart || partTelemetry.uploadStart < telemetry.firstPartUploadStart) {
                            telemetry.firstPartUploadStart = partTelemetry.uploadStart;
                        }

                        const handleAbort = () => {
                            xhr.abort();
                            reject(new Error('Upload cancelled'));
                        };
                        
                        if (signal) signal.addEventListener('abort', handleAbort);
                        
                        let currentLoaded = 0;
                        
                        xhr.upload.onprogress = (e) => {
                            if (e.lengthComputable && onProgress) {
                                const delta = e.loaded - currentLoaded;
                                currentLoaded = e.loaded;
                                totalUploadedBytes += delta;
                                const percentComplete = (totalUploadedBytes / file.size) * 100;
                                onProgress(Math.min(percentComplete, 99.9));
                            }
                        };
                        
                        xhr.onload = () => {
                            partTelemetry.uploadEnd = performance.now();
                            partTelemetry.duration = partTelemetry.uploadEnd - partTelemetry.uploadStart;
                            partTelemetry.httpStatus = xhr.status;
                            if (signal) signal.removeEventListener('abort', handleAbort);
                            
                            if (!telemetry.lastPartUploadFinish || partTelemetry.uploadEnd > telemetry.lastPartUploadFinish) {
                                telemetry.lastPartUploadFinish = partTelemetry.uploadEnd;
                            }

                            if (xhr.status >= 200 && xhr.status < 300) {
                                const etag = xhr.getResponseHeader('ETag') || xhr.getResponseHeader('etag');
                                if (!etag) {
                                    reject(new Error('R2 did not expose the uploaded part ETag. Check the bucket CORS ExposeHeaders configuration.'));
                                    return;
                                }
                                resolve({ PartNumber: partNumber, ETag: etag });
                            } else {
                                reject(new Error(`Chunk upload failed: ${xhr.statusText}`));
                            }
                        };
                        xhr.onerror = () => {
                            if (signal) signal.removeEventListener('abort', handleAbort);
                            reject(new Error('Network error during chunk upload'));
                        };
                        xhr.send(chunk);
                    });

                    telemetry.partUploadTimings.push(partTelemetry);
                    return partResult;
                } catch (err) {
                    partTelemetry.errs.push(err.message);
                    attempt++;
                    if (attempt > MAX_RETRIES) {
                        telemetry.partUploadTimings.push(partTelemetry);
                        throw err;
                    }
                    await delay(Math.pow(2, attempt) * 1000); // 2s, 4s, 8s
                }
            }
        };

        // Queue processing
        let currentIndex = 1;
        let hasError = false;
        let globalError = null;

        const worker = async () => {
            while (currentIndex <= partCount && !hasError) {
                if (signal && signal.aborted) {
                    hasError = true;
                    globalError = new Error('Upload cancelled');
                    return;
                }
                const partNumber = currentIndex++;
                try {
                    const result = await uploadPart(partNumber);
                    parts.push(result);
                } catch (err) {
                    hasError = true;
                    globalError = err;
                }
            }
        };

        try {
            // Start workers
            const workers = Array(Math.min(CONCURRENCY_LIMIT, partCount)).fill(null).map(() => worker());
            await Promise.all(workers);

            if (hasError) throw globalError;

            // Complete the multipart object and attach it to its validated course target.
            const t0_complete = performance.now();
            const completeRes = await supabase.functions.invoke('r2-multipart-complete', {
                body: {
                    course_id: courseId,
                    lesson_id: lessonId || null,
                    type,
                    upload_id: uploadId,
                    object_key: objectKey,
                    parts,
                    file_size: file.size
                }
            });
            const t1_complete = performance.now();
            telemetry.completeDuration = t1_complete - t0_complete;

            if (completeRes.error) throw new Error(`Completion failed: ${completeRes.error.message}`);
            
            if (onProgress) onProgress(100);
            
            const totalEndTime = performance.now();
            telemetry.totalDuration = totalEndTime - telemetry.startTime;
            
            const actualR2TransferMs = telemetry.lastPartUploadFinish - telemetry.firstPartUploadStart;
            const fileSizeMb = telemetry.fileSize / (1024 * 1024);
            const actualR2TransferSecs = actualR2TransferMs / 1000;
            const avgThroughput = fileSizeMb / actualR2TransferSecs;
            const uiDelay = totalEndTime - t1_complete;

            console.group('=== TEMPORARY R2 MULTIPART UPLOAD TELEMETRY ===');
            console.log(`File size: ${fileSizeMb.toFixed(2)} MB`);
            console.log(`Parts: ${telemetry.partCount}`);
            console.log(`Part size: ${(telemetry.partSize / (1024*1024)).toFixed(2)} MB`);
            console.log(`Concurrency requested/actual: ${CONCURRENCY_LIMIT} / ${telemetry.concurrency}`);
            console.log(`Total Upload Duration: ${(telemetry.totalDuration / 1000).toFixed(2)} sec`);
            console.log(`r2-multipart-create: ${telemetry.createDuration.toFixed(2)} ms`);
            console.log(`r2-multipart-complete: ${telemetry.completeDuration.toFixed(2)} ms`);
            
            let totalPresignDuration = 0;
            telemetry.partUploadTimings.forEach(p => totalPresignDuration += p.presignDuration);
            console.log(`Avg Presign per part: ${(totalPresignDuration / telemetry.partUploadTimings.length).toFixed(2)} ms`);
            
            console.log(`Time from first part upload starting to last part finishing (Actual R2 Transfer): ${actualR2TransferSecs.toFixed(2)} sec`);
            console.log(`Effective upload speed (R2 Transfer only): ${avgThroughput.toFixed(2)} MB/s`);
            console.log(`Time between upload completion and UI return (UI Delay): ${uiDelay.toFixed(2)} ms`);
            console.log(`Client Processing Note: ${telemetry.clientProcessingNote}`);
            
            console.groupCollapsed('Individual Part Timings');
            telemetry.partUploadTimings.sort((a,b) => a.partNumber - b.partNumber).forEach(p => {
                console.log(`Part ${p.partNumber}: Size ${(p.size / (1024*1024)).toFixed(2)} MB | Presign: ${p.presignDuration.toFixed(2)} ms | Upload Transfer: ${p.duration.toFixed(2)} ms | Retries: ${p.retryCount} | Status: ${p.httpStatus}`);
            });
            console.groupEnd();
            console.groupEnd();

            return { objectKey: objectKey };

        } catch (err) {
            // Abort the multipart upload logic (if in progress)
            await supabase.functions.invoke('r2-multipart-abort', {
                body: { course_id: courseId, upload_id: uploadId, object_key: objectKey }
            });
            throw err;
        }
    },

    async commitR2Upload(courseId, lessonId, type, objectKey, fileSize) {
        const session = await AuthService.getSession();
        if (!session) throw new Error("Not authenticated");

        const { data, error } = await supabase.rpc('commit_r2_video_upload', {
            p_course_id: courseId,
            p_lesson_id: lessonId,
            p_upload_type: type,
            p_object_key: objectKey,
            p_file_size: fileSize
        });

        if (error) throw new Error(`Commit failed: ${error.message}`);
        return data;
    },

    async discardStagedUpload(courseId, objectKey, uploadId = null) {
        const session = await AuthService.getSession();
        if (!session) throw new Error("Not authenticated");

        // If we have an uploadId, it means it was still in progress (multipart abort)
        if (uploadId) {
            await supabase.functions.invoke('r2-multipart-abort', {
                body: { course_id: courseId, upload_id: uploadId, object_key: objectKey }
            });
        }

        // Always attempt to delete the object in case Complete was called before Cancel hit
        // The endpoint is idempotent if the object doesn't exist
        const { error } = await supabase.functions.invoke('r2-discard-staged', {
            body: { course_id: courseId, object_key: objectKey }
        });

        if (error) {
            console.error('Failed to discard staged upload:', error);
            // Non-critical, cleanup worker will catch it later if it really failed
        }
        return true;
    },

    async getR2PlaybackUrl(courseId, lessonId, playbackType = 'lesson') {
        const session = await AuthService.getSession();
        if (!session) throw new Error("Not authenticated");

        const { data, error } = await supabase.functions.invoke('r2-video-playback', {
            body: { 
                course_id: courseId,
                lesson_id: lessonId,
                playback_type: playbackType
            }
        });

        if (error) throw error;
        return data.playbackUrl;
    },

    async deleteR2Video(courseId, lessonId, deleteType = 'lesson') {
        const session = await AuthService.getSession();
        if (!session) throw new Error("Not authenticated");

        const { data, error } = await supabase.functions.invoke('r2-delete-video', {
            body: { 
                course_id: courseId, 
                lesson_id: lessonId,
                delete_type: deleteType
            }
        });

        if (error) throw error;
        return data;
    }
};

