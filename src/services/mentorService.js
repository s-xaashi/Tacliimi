import { supabase } from './supabaseClient.js';
import { AuthService } from './authService.js';
import { ProfileService } from './profileService.js';

export const MentorService = {
    /**
     * Push normal setup profile data to the Mentorship Profiles index
     * Makes the user available in generic Marketplace scans
     * SECURITY: userId sourced from session, not caller.
     */
    async publishMentorshipProfile() {
        const session = await AuthService.getSession();
        if (!session) throw new Error('Unauthorized: No active session');
        const userId = session.user.id;

        // Fetch source of truth data needed for mentoring
        const { data: globalProfile, error: pErr } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .maybeSingle();

        const { data: teachingProfile, error: tErr } = await supabase
            .from('teaching_profiles')
            .select('*')
            .eq('instructor_id', userId)
            .maybeSingle();

        if (pErr || tErr) throw new Error("Incomplete profile data preventing mentorship publishing.");

        const { error } = await supabase
            .from('mentorship_profiles')
            .upsert({
                instructor_id: userId,
                headline: globalProfile.professional_title,
                bio: globalProfile.short_bio,
                introduction_video_url: teachingProfile?.introduction_video_url,
                is_public: true
            }, { onConflict: 'instructor_id' });

        if (error) throw error;
        return true;
    },

    /**
     * Hide completely from Marketplace
     * SECURITY: userId sourced from session, not caller.
     */
    async hideProfile() {
        const session = await AuthService.getSession();
        if (!session) throw new Error('Unauthorized: No active session');

        const { error } = await supabase
            .from('mentorship_profiles')
            .update({ is_public: false })
            .eq('instructor_id', session.user.id);

        if (error) throw error;
        return true;
    },

    /**
     * Apply for mentorship program
     * SECURITY: userId sourced from session, not caller.
     */
    async applyForMentorship(applicationData) {
        const session = await AuthService.getSession();
        if (!session) throw new Error('Unauthorized: No active session');
        const userId = session.user.id;
        // 1. Update the global profile with name and gender
        const { error: pErr } = await supabase
            .from('profiles')
            .update({
                full_name: applicationData.fullName,
                gender: applicationData.gender,
                phone_number: applicationData.phone,
                country: applicationData.country,
                city: applicationData.city
            })
            .eq('id', userId);

        if (pErr) throw pErr;

        // 2. Upsert into mentorship_profiles with application details
        const { error: mErr } = await supabase
            .from('mentorship_profiles')
            .upsert({
                instructor_id: userId,
                mentorship_email: applicationData.email,
                mentorship_phone: applicationData.phone,
                mentorship_country: applicationData.country,
                mentorship_city: applicationData.city,
                is_public: true,
                total_sessions: 0,
                avg_response_time_hours: 0,
                hourly_rate: 0
            }, { onConflict: 'instructor_id' });

        if (mErr) throw mErr;

        return true;
    },

    /**
     * Save availability slots and meeting type preferences for a mentor
     * SECURITY: userId sourced from session, not caller.
     */
    async saveAvailability({ slots, meetingTypes }) {
        const session = await AuthService.getSession();
        if (!session) throw new Error('Unauthorized: No active session');
        const userId = session.user.id;
        // 1. Update meeting types in mentorship_profiles
        const { error: mErr } = await supabase
            .from('mentorship_profiles')
            .update({ meeting_types: meetingTypes })
            .eq('instructor_id', userId);

        if (mErr) throw mErr;

        // 2. Delete existing slots
        const { error: dErr } = await supabase
            .from('mentor_availability')
            .delete()
            .eq('mentor_id', userId);

        if (dErr) throw dErr;

        if (!slots || slots.length === 0) return true;

        // 3. Insert new slots
        const { error: iErr } = await supabase
            .from('mentor_availability')
            .insert(slots.map(slot => ({
                mentor_id: userId,
                day_of_week: slot.dayOfWeek,
                start_time: slot.startTime,
                end_time: slot.endTime,
                is_enabled: slot.isEnabled
            })));

        if (iErr) throw iErr;
        return true;
    },

    /**
     * Fetch availability and meeting types for a mentor
     */
    async getAvailability(userId) {
        const { data: slots, error: sErr } = await supabase
            .from('mentor_availability')
            .select('*')
            .eq('mentor_id', userId)
            .order('day_of_week', { ascending: true })
            .order('start_time', { ascending: true });

        if (sErr) throw sErr;

        const { data: profile, error: pErr } = await supabase
            .from('mentorship_profiles')
            .select('meeting_types')
            .eq('instructor_id', userId)
            .maybeSingle();

        if (pErr && pErr.code !== 'PGRST116') throw pErr;

        return {
            slots: slots || [],
            meetingTypes: profile?.meeting_types || { online: true, in_person: false }
        };
    },

    /**
     * Update mentorship pricing
     * SECURITY: userId sourced from session, not caller.
     */
    async updatePricing(rate, monthlyRate, currency = 'USD') {
        const session = await AuthService.getSession();
        if (!session) throw new Error('Unauthorized: No active session');

        const { error } = await supabase
            .from('mentorship_profiles')
            .update({ 
                hourly_rate: rate,
                monthly_rate: monthlyRate,
                currency: currency
            })
            .eq('instructor_id', session.user.id);

        if (error) throw error;
        return true;
    },

    /**
     * Fetch all public mentors (Student Side or Search)
     */
    async getActiveMentors() {
        try {
            // ── Query 1: Core mentor + profile data (required) ──────────────
            const { data, error } = await supabase
                .from('mentorship_profiles')
                .select(`
                    id, 
                    instructor_id,
                    hourly_rate,
                    total_sessions,
                    avg_response_time_hours,
                    mentorship_country,
                    mentorship_city,
                    headline,
                    bio,
                    introduction_video_url,
                    introduction_video_storage_key,
                    is_public,
                    meeting_types,
                    currency,
                    profile:profiles!inner (
                        full_name,
                        avatar_url,
                        avatar_storage_key,
                        short_bio,
                        professional_title,
                        country,
                        city,
                        serial_id,
                        account_status,
                        instructor:instructors!inner (
                            approval_status
                        ),
                        teaching:teaching_profiles (
                            introduction_video_url,
                            introduction_video_storage_key,
                            teaching_experience,
                            educational_background,
                            languages_spoken,
                            mentorship_style
                        ),
                        expertise:expertise_areas (
                            expertise_name
                        )
                    )
                `)
                .eq('is_public', true)
                .is('deleted_at', null)
                .eq('profile.account_status', 'active')
                .eq('profile.instructor.approval_status', 'approved');

            if (error) throw error;
            if (!data) return [];

            // ── Query 2: Rating stats (Aggregated from source table) ──────
            // This bypasses the unreliable mentor_rating_stats view.
            let ratingMap = {};
            try {
                // Fetch all ratings to aggregate in JS (efficient for marketplace)
                const { data: reviews } = await supabase
                    .from('mentorship_reviews')
                    .select('mentor_id, rating');

                if (reviews) {
                    reviews.forEach(r => {
                        if (!ratingMap[r.mentor_id]) {
                            ratingMap[r.mentor_id] = { total: 0, count: 0 };
                        }
                        ratingMap[r.mentor_id].total += (r.rating || 0);
                        ratingMap[r.mentor_id].count += 1;
                    });
                }
            } catch (ratingErr) {
                console.warn('[Marketplace] Could not load raw reviews for ratings:', ratingErr.message);
                
                // Tertiary fallback: Try the view if raw table fetch fails
                try {
                    const { data: vRatings } = await supabase
                        .from('mentor_rating_stats')
                        .select('mentor_id, avg_rating, review_count');
                    if (vRatings) {
                        vRatings.forEach(r => {
                            ratingMap[r.mentor_id] = { 
                                avg: r.avg_rating ?? '0.0', 
                                count: r.review_count ?? 0 
                            };
                        });
                    }
                } catch (vErr) {
                    console.warn('[Marketplace] View fallback also failed:', vErr.message);
                }
            }

            // ── Query 3: Aggregated confirmed-session counts (RLS-safe view) ──
            let sessionCountMap = {};
            try {
                const { data: sessionStats, error: sessionStatsError } = await supabase
                    .from('mentor_session_stats_view')
                    .select('mentor_id, confirmed_session_count');
                if (sessionStatsError) throw sessionStatsError;
                (sessionStats || []).forEach(row => {
                    sessionCountMap[row.mentor_id] = Number(row.confirmed_session_count) || 0;
                });
            } catch (sessErr) {
                console.warn('[Marketplace] Could not load session counts:', sessErr.message);
            }

            // ── Query 4: Median first-reply time, in seconds ──────────────────
            let responseTimeMap = {};
            try {
                const { data: responseTimes, error: responseTimesError } = await supabase
                    .from('mentor_response_metrics_view')
                    .select('mentor_id, typical_response_time_seconds, response_sample_count');
                if (responseTimesError) throw responseTimesError;
                (responseTimes || []).forEach(row => {
                    const seconds = Number(row.typical_response_time_seconds);
                    const sampleCount = Number(row.response_sample_count) || 0;
                    // Only show a typical reply time when enough conversations exist.
                    if (sampleCount >= 3 && Number.isFinite(seconds) && seconds >= 0) {
                        responseTimeMap[row.mentor_id] = seconds;
                    }
                });
            } catch (rtErr) {
                console.warn('[Marketplace] Could not load response times:', rtErr.message);
            }

            // ── Merge and map ────────────────────────────────────────────────
            return Promise.all(data.map(async (mentor) => {
                const teachingData = Array.isArray(mentor.profile?.teaching) 
                    ? mentor.profile.teaching[0] 
                    : mentor.profile?.teaching;

                const videoStorageKey = mentor.introduction_video_storage_key || teachingData?.introduction_video_storage_key;
                let introVideoUrl = mentor.introduction_video_url || teachingData?.introduction_video_url || '';

                if (videoStorageKey) {
                    try {
                        const signedUrl = await ProfileService.getIntroVideoPlaybackUrl(videoStorageKey);
                        if (signedUrl) introVideoUrl = signedUrl;
                    } catch (vErr) {
                        console.warn("Failed to fetch R2 playback URL for active mentor intro video:", vErr);
                    }
                }

                // Priority: (1) JS-aggregated raw reviews, (2) View fallback, (3) 0.0
                const stats = ratingMap[mentor.instructor_id];
                let finalRating = '0.0';
                let finalCount = 0;

                if (stats) {
                    if (stats.avg !== undefined) {
                        // From View
                        finalRating = stats.avg;
                        finalCount = stats.count;
                    } else if (stats.count > 0) {
                        // From JS aggregation
                        finalRating = (stats.total / stats.count).toFixed(1);
                        finalCount = stats.count;
                    }
                }

                return {
                    id: mentor.id,
                    instructor_id: mentor.instructor_id,
                    full_name: mentor.profile?.full_name || 'Anonymous Mentor',
                    avatar_url: mentor.profile?.avatar_url,
                    short_bio: mentor.profile?.short_bio || mentor.bio || 'No bio available.',
                    expertise: mentor.profile?.expertise?.map(e => e.expertise_name) || [],
                    introduction_video: introVideoUrl,
                    introduction_video_storage_key: videoStorageKey,
                    languages: teachingData?.languages_spoken || [],
                    educational_background: teachingData?.educational_background || [],
                    teaching_experience: teachingData?.teaching_experience,
                    experience: teachingData?.teaching_experience,
                    education: teachingData?.educational_background,
                    education_list: teachingData?.educational_background
                        ? (() => { try { const e = teachingData.educational_background; return typeof e === 'string' ? JSON.parse(e) : e; } catch { return []; } })()
                        : [],
                    hourly_rate: mentor.hourly_rate || 0,
                    monthly_rate: mentor.monthly_rate || (mentor.hourly_rate * 20),
                    currency: mentor.currency || 'USD',
                    // Shared aggregate keeps marketplace and profile counts consistent.
                    completed_sessions: sessionCountMap[mentor.instructor_id] || 0,
                    total_sessions: sessionCountMap[mentor.instructor_id] || 0,
                    avg_response_time_seconds: responseTimeMap[mentor.instructor_id] ?? null,
                    // Preserve the legacy hours field for existing consumers.
                    avg_response_time: responseTimeMap[mentor.instructor_id] != null
                        ? responseTimeMap[mentor.instructor_id] / 3600
                        : (mentor.avg_response_time_hours || 0),
                    country: mentor.profile?.country || mentor.mentorship_country,
                    city: mentor.profile?.city || mentor.mentorship_city,
                    headline: mentor.headline,
                    rating: finalRating,
                    review_count: finalCount,
                    meeting_types: mentor.meeting_types,
                    serial_id: mentor.profile?.serial_id
                };
            }));
        } catch (error) {
            console.error('Error in getActiveMentors:', error);
            throw error;
        }
    },


    async getMentorById(mentorId) {
        try {
            // ── Fire all queries in parallel for maximum speed ────────────────────────────
            const [profileRes, statsRes, reviewsRes, availRes] = await Promise.all([
                supabase
                    .from('mentorship_profiles')
                    .select(`
                        *,
                        profile:profiles (
                            full_name,
                            avatar_url,
                            avatar_storage_key,
                            short_bio,
                            serial_id,
                            gender,
                            teaching:teaching_profiles (
                                introduction_video_url,
                                introduction_video_storage_key,
                                introduction_video_provider,
                                teaching_experience,
                                educational_background,
                                languages_spoken
                            ),
                            expertise:expertise_areas (
                                expertise_name
                            )
                        )
                    `)
                    .eq('instructor_id', mentorId)
                    .maybeSingle(),
                supabase
                    .from('mentor_rating_stats')
                    .select('avg_rating, review_count')
                    .eq('mentor_id', mentorId)
                    .maybeSingle(),
                supabase
                    .from('mentor_profile_reviews_view')
                    .select('rating, comment, created_at, full_name, avatar_url')
                    .eq('mentor_id', mentorId),
                supabase
                    .from('mentor_availability')
                    .select('*')
                    .eq('mentor_id', mentorId)
                    .is('is_enabled', true)
                    .order('day_of_week', { ascending: true })
                    .order('start_time', { ascending: true })
            ]);

            const { data, error } = profileRes;
            if (error) throw error;
            if (!data) return null;

            let ratingStats = null;
            if (!statsRes.error) ratingStats = statsRes.data || null;
            
            const teachingData = Array.isArray(data.profile?.teaching) 
                ? data.profile.teaching[0] 
                : data.profile?.teaching;

            // Resolve video URL (support both R2 storage key and legacy Supabase URL)
            const videoStorageKey = data.introduction_video_storage_key || teachingData?.introduction_video_storage_key;
            let introVideoUrl = data.introduction_video_url || teachingData?.introduction_video_url || '';

            if (videoStorageKey) {
                try {
                    const signedUrl = await ProfileService.getIntroVideoPlaybackUrl(videoStorageKey);
                    if (signedUrl) introVideoUrl = signedUrl;
                } catch (vErr) {
                    console.warn("Failed to fetch R2 playback URL for mentor intro video:", vErr);
                }
            }

            // Fetch full reviews with comments (for display) using the secure view
            const reviews = reviewsRes.data;
            const rErr = reviewsRes.error;

            if (rErr) {
                console.warn("Failed to fetch mentorship reviews:", rErr);
            }

            // Map the view fields to the expected nested structure 'student'
            const activeReviews = (reviews || []).map(r => ({
                rating: r.rating,
                comment: r.comment,
                created_at: r.created_at,
                student: {
                    full_name: r.full_name,
                    avatar_url: r.avatar_url
                }
            }));

            // ── Compute rating from actual reviews (source of truth) ─────────
            // This ensures the header always matches the reviews section.
            // The ratingStats view is only used as fallback when no reviews exist.
            let computedRating = '0.0';
            let computedReviewCount = 0;
            if (activeReviews.length > 0) {
                const avg = activeReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / activeReviews.length;
                computedRating = avg.toFixed(1);
                computedReviewCount = activeReviews.length;
            } else if (ratingStats) {
                computedRating = ratingStats.avg_rating ?? '0.0';
                computedReviewCount = ratingStats.review_count ?? 0;
            }

            const availability = availRes.data;
            const aErr = availRes.error;

            if (aErr) {
                console.warn("Failed to fetch mentor availability:", aErr);
            }

            // ── Live aggregate stats shared with the marketplace ─────────────
            let completedSessions = 0;
            try {
                const { data: sessionStats, error: sessionStatsError } = await supabase
                    .from('mentor_session_stats_view')
                    .select('confirmed_session_count')
                    .eq('mentor_id', mentorId)
                    .maybeSingle();
                if (sessionStatsError) throw sessionStatsError;
                completedSessions = Number(sessionStats?.confirmed_session_count) || 0;
            } catch (err) {
                console.warn("Failed to fetch session count:", err);
            }

            let typicalResponseTimeSeconds = null;
            try {
                const { data: rt, error: rtError } = await supabase
                    .from('mentor_response_metrics_view')
                    .select('typical_response_time_seconds, response_sample_count')
                    .eq('mentor_id', mentorId)
                    .maybeSingle();
                if (rtError) throw rtError;
                const seconds = Number(rt?.typical_response_time_seconds);
                const sampleCount = Number(rt?.response_sample_count) || 0;
                if (rt?.typical_response_time_seconds != null && sampleCount >= 3 && Number.isFinite(seconds) && seconds >= 0) {
                    typicalResponseTimeSeconds = seconds;
                }
            } catch (err) {
                console.warn("Failed to fetch typical response time:", err);
            }

            const safeJsonMentor = (raw, fallback = []) => {
                if (!raw) return fallback;
                if (Array.isArray(raw)) return raw;
                try { return JSON.parse(raw); } catch { return fallback; }
            };

            return {
                id: data.id,
                instructor_id: data.instructor_id,
                full_name: data.profile?.full_name,
                avatar_url: data.profile?.avatar_url,
                short_bio: data.profile?.short_bio || data.bio,
                gender: data.profile?.gender,
                expertise: data.profile?.expertise?.map(e => e.expertise_name) || [],
                introduction_video: introVideoUrl,
                introduction_video_storage_key: videoStorageKey,
                teaching_experience: teachingData?.teaching_experience,
                mentorship_style: teachingData?.mentorship_style,
                experience: teachingData?.teaching_experience,
                education: teachingData?.educational_background,
                education_list: safeJsonMentor(teachingData?.educational_background),
                languages: teachingData?.languages_spoken,
                language_list: safeJsonMentor(teachingData?.languages_spoken),
                hourly_rate: data.hourly_rate || 0,
                monthly_rate: data.monthly_rate || (data.hourly_rate * 20),
                currency: data.currency || 'USD',
                completed_sessions: completedSessions,
                total_sessions: completedSessions,
                avg_response_time_seconds: typicalResponseTimeSeconds,
                avg_response_time: typicalResponseTimeSeconds != null
                    ? typicalResponseTimeSeconds / 3600
                    : (data.avg_response_time_hours || 0),
                country: data.mentorship_country,
                city: data.mentorship_city,
                headline: data.headline,
                rating: computedRating,
                review_count: computedReviewCount,
                reviews: activeReviews,
                meeting_types: data.meeting_types,
                availability: availability || [],
                serial_id: data.profile?.serial_id
            };
        } catch (error) {

            console.error('Error in getMentorById:', error);
            throw error;
        }
    },

    async updatePrivacy(isPublic) {
        const session = await AuthService.getSession();
        if (!session) throw new Error("Not authenticated");
        
        const { error } = await supabase
            .from('mentorship_profiles')
            .update({ is_public: isPublic })
            .eq('instructor_id', session.user.id);

        if (error) throw error;
        return true;
    },

    async submitReview(mentorId, rating, comment) {
        const session = await AuthService.getSession();
        if (!session) throw new Error("Not authenticated");
        const studentId = session.user.id;

        // Double check role even if UI hides the button
        const { data: profile, error: pErr } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', studentId)
            .single();

        if (pErr || !profile || profile.role !== 'student') {
            throw new Error("Only student accounts can leave reviews.");
        }

        const { error } = await supabase
            .from('mentorship_reviews')
            .insert({
                mentor_id: mentorId,
                student_id: studentId,
                rating: rating,
                comment: comment
            });

        if (error) throw error;
        return true;
    },

    async createCoupon(mentorId, { code, discountPercentage, expiresAt }) {
        const { data, error } = await supabase
            .from('mentorship_coupons')
            .insert({
                mentor_id: mentorId,
                code: code,
                discount_percentage: discountPercentage,
                expires_at: expiresAt
            })
            .select()
            .maybeSingle();

        if (error) throw error;
        return data;
    },

    async getCoupons(mentorId) {
        const { data, error } = await supabase
            .from('mentorship_coupons')
            .select('*')
            .eq('mentor_id', mentorId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    },

    async deleteCoupon(couponId) {
        const { error } = await supabase
            .from('mentorship_coupons')
            .delete()
            .eq('id', couponId);

        if (error) throw error;
        return true;
    },

    async validateCoupon(mentorId, code) {
        try {
            const { data, error } = await supabase
                .from('mentorship_coupons')
                .select('*')
                .eq('mentor_id', mentorId)
                .ilike('code', code)
                .maybeSingle();

            if (error) {
                if (error.code === 'PGRST116') return { valid: false, message: 'Invalid coupon code' };
                if (error.message?.includes('relation "public.mentorship_coupons" does not exist')) {
                    return { valid: false, message: 'Coupon system not yet initialized. Please contact the administrator (SQL migration needed).' };
                }
                throw error;
            }

            if (!data) {
                return { valid: false, message: 'Invalid coupon code' };
            }

            const now = new Date();
            const expiry = new Date(data.expires_at);

            // Set expiry time to end of day
            expiry.setHours(23, 59, 59, 999);

            if (now > expiry) {
                return { valid: false, message: 'Coupon has expired' };
            }

            return { 
                valid: true, 
                discountPercentage: data.discount_percentage,
                couponId: data.id
            };
        } catch (err) {
            console.error('Coupon validation error:', err);
            return { valid: false, message: 'Error validating coupon. Make sure the database table exists.' };
        }
    },

    /**
     * Create a new mentorship session record
     */
    async createSession(sessionData) {
        // NEW: Check student account status
        const { data: profile, error: pErr } = await supabase
            .from('profiles')
            .select('account_status')
            .eq('id', sessionData.studentId)
            .single();

        if (pErr) throw pErr;
        if (profile.account_status === 'suspended') {
            throw new Error("Your account is currently suspended. You cannot book new sessions at this time.");
        }
        if (profile.account_status === 'blocked') {
            throw new Error("Your account is blocked. Access denied.");
        }

        // Compute end_date for program mentorships
        const mentorshipType = sessionData.mentorshipType || 'single';
        const durationDays = mentorshipType === 'program' ? (sessionData.durationDays || 30) : 1;
        const totalSessions = mentorshipType === 'program' ? (sessionData.totalSessions || durationDays) : 1;

        // program_start_date may be set explicitly or default to scheduled_at
        const programStartDate = sessionData.programStartDate || (mentorshipType === 'program' ? sessionData.scheduledAt : null);
        const endDate = programStartDate
            ? new Date(new Date(programStartDate).getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString()
            : null;

        const sessionPayload = {
            student_id: sessionData.studentId,
            mentor_id: sessionData.mentorId,
            scheduled_at: sessionData.scheduledAt,
            status: 'pending', // Keep legacy for compat
            booking_status: 'pending_payment', // Fix: DO NOT use pending_review before payment
            notes: sessionData.notes || '',
            topic: sessionData.topic,
            meeting_type: sessionData.meetingType,
            meeting_location: sessionData.meetingLocation,
            student_phone: sessionData.studentPhone,
            duration_minutes: sessionData.durationMinutes || 60,
            mentorship_type: mentorshipType,
            total_sessions: totalSessions,
            completed_sessions_count: 0,
            duration_days: durationDays,
            program_start_date: programStartDate,
            end_date: endDate
        };

        // FIND existing unpaid cart row for this student + mentor combination
        const { data: existingSession, error: checkErr } = await supabase
            .from('mentorship_sessions')
            .select('id')
            .eq('student_id', sessionData.studentId)
            .eq('mentor_id', sessionData.mentorId)
            .in('booking_status', ['pending_payment', 'draft'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (checkErr) throw checkErr;

        let resultData;
        if (existingSession) {
            // Upsert / Update the existing unpaid row instead of duplicating
            const { data, error } = await supabase
                .from('mentorship_sessions')
                .update(sessionPayload)
                .eq('id', existingSession.id)
                .select()
                .single();
            if (error) throw error;
            resultData = data;
        } else {
            // Insert a brand new row
            const { data, error } = await supabase
                .from('mentorship_sessions')
                .insert(sessionPayload)
                .select()
                .single();
            if (error) throw error;
            resultData = data;
        }

        return resultData;
    },

    /**
     * Fetch sessions for a student
     */
    async getStudentSessions(studentId) {
        const { data, error } = await supabase
            .from('mentorship_sessions')
            .select(`
                *,
                mentorship_type,
                total_sessions,
                completed_sessions_count,
                duration_days,
                program_start_date,
                end_date,
                mentor:profiles!mentorship_sessions_mentor_id_fkey (
                    full_name,
                    avatar_url,
                    avatar_storage_key,
                    professional_title
                )
            `)
            .eq('student_id', studentId)
            .order('scheduled_at', { ascending: true });

        if (error) throw error;
        return data || [];
    },

    /**
     * Fetch sessions for a mentor
     */
    async getMentorSessions(mentorId, status = null) {
        let query = supabase
            .from('mentorship_sessions')
            .select('*')
            .eq('mentor_id', mentorId);

        if (status) {
            query = query.or(`status.eq.${status},booking_status.eq.${status}`);
        }

        const { data: sessions, error } = await query.order('scheduled_at', { ascending: true });
        if (error) throw error;
        
        if (!sessions || sessions.length === 0) return [];

        // Collect unique student IDs and fetch their profiles separately
        const studentIds = [...new Set(sessions.map(s => s.student_id).filter(Boolean))];
        
        let profileMap = {};

        if (studentIds.length > 0) {
            const { data: profiles, error: pErr } = await supabase
                .from('profiles')
                .select('id, full_name, avatar_url, avatar_storage_key, email, phone_number, country, city, professional_title, short_bio, gender, learning_interests, social_links')
                .in('id', studentIds);

            if (pErr) throw pErr;

            if (profiles) {
                profiles.forEach(p => { profileMap[p.id] = p; });
            }
        }

        // Attach student profile to each session
        const mappedSessions = sessions.map(s => ({
            ...s,
            student: profileMap[s.student_id] || null
        }));
        
        return mappedSessions;
    },


    /**
     * Update session status
     */
    async updateSessionStatus(sessionId, status, rejectionNote = null) {
        const session = await AuthService.getSession();
        if (!session) throw new Error("Not authenticated");

        // Map new booking_status values to legacy status column values
        // The legacy status column only accepts: pending, confirmed, negotiating, upcoming, completed, cancelled
        const legacyStatusMap = {
            'pending_review':           'pending',
            'pending_rejection_review': 'pending',   // Added for admin review
            'awaiting_meeting_link':    'confirmed',   // Mentor accepted, so treat as confirmed
            'location_negotiation':     'negotiating',
            'confirmed':                'confirmed',
            'completed':                'completed',
            'cancelled':                'cancelled',
        };
        const legacyStatus = legacyStatusMap[status] || 'upcoming'; // safe fallback

        const updateData = { 
            booking_status: status,
            status: legacyStatus
        };

        if (rejectionNote !== null) {
            updateData.rejection_note = rejectionNote;
        }

        const { error } = await supabase
            .from('mentorship_sessions')
            .update(updateData)
            .eq('id', sessionId)
            .eq('mentor_id', session.user.id);

        if (error) throw error;

        return true;
    },

    /**
     * Reschedule a session as a mentor
     */
    async rescheduleSession(sessionId, newScheduledAt, newDurationMinutes, note) {
        const { data: { user }, error: authErr } = await supabase.auth.getUser();
        if (authErr || !user) throw new Error("Unauthorized: Could not verify mentor identity.");
        
        const { error } = await supabase.rpc('mentor_reschedule_session', {
            p_mentor_id: user.id,
            p_session_id: sessionId,
            p_new_scheduled_at: newScheduledAt,
            p_new_duration_minutes: newDurationMinutes,
            p_note: note || null
        });

        if (error) throw error;
        return true;
    },

    /**
     * Delete a mentorship session
     */
    async deleteSession(sessionId) {
        const session = await AuthService.getSession();
        if (!session) throw new Error("Not authenticated");

        const { error } = await supabase
            .from('mentorship_sessions')
            .delete()
            .eq('id', sessionId)
            .or(`mentor_id.eq.${session.user.id},student_id.eq.${session.user.id}`);

        if (error) throw error;
        return true;
    },

    /**
     * Increment completed_sessions_count for a program mentorship.
     * SOURCE OF TRUTH: Only the mentor explicitly calls this action.
     * Ensures count never auto-increments and is always authoritative.
     */
    async markProgramSessionComplete(sessionId) {
        // First fetch current count
        const { data: current, error: fetchErr } = await supabase
            .from('mentorship_sessions')
            .select('completed_sessions_count, mentorship_type')
            .eq('id', sessionId)
            .single();

        if (fetchErr) throw fetchErr;
        if (current.mentorship_type !== 'program') {
            throw new Error('markProgramSessionComplete can only be called on program mentorship sessions.');
        }

        // Increment count only. Never auto-complete the program from session count.
        // Program completion is lifecycle-driven (end_date) or explicitly triggered by mentor/admin.
        const newCount = (current.completed_sessions_count || 0) + 1;

        const { error: updateErr } = await supabase
            .from('mentorship_sessions')
            .update({ completed_sessions_count: newCount })
            .eq('id', sessionId);

        if (updateErr) throw updateErr;
        return { newCount };
    },

    /**
     * Set program_start_date and compute end_date for a program mentorship.
     * Called when mentor confirms meeting setup (Action Required -> Active).
     */
    async setProgramStartDate(sessionId, startDate) {
        const { data: current, error: fetchErr } = await supabase
            .from('mentorship_sessions')
            .select('duration_days')
            .eq('id', sessionId)
            .single();

        if (fetchErr) throw fetchErr;

        const durationDays = current.duration_days || 30;
        const endDate = new Date(new Date(startDate).getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();

        const { error } = await supabase
            .from('mentorship_sessions')
            .update({ program_start_date: startDate, end_date: endDate })
            .eq('id', sessionId);

        if (error) throw error;
        return { startDate, endDate };
    },

    /**
     * Helper to validate allowed meeting links
     */
    isValidMeetingLink(link) {
        if (!link) return false;
        try {
            const url = new URL(link);
            const patterns = [
                /^.*\.zoom\.us$/,
                /^meet\.google\.com$/,
                /^teams\.microsoft\.com$/
            ];
            return patterns.some(p => p.test(url.hostname));
        } catch {
            return false;
        }
    },

    /**
     * Update session meeting link and mark as confirmed
     */
    async updateMeetingLink(sessionId, link) {
        if (!this.isValidMeetingLink(link)) {
            throw new Error("Invalid meeting link. Only Zoom, Google Meet, or Microsoft Teams links are allowed.");
        }

        const { error } = await supabase
            .from('mentorship_sessions')
            .update({ 
                meeting_link: link,
                booking_status: 'confirmed',
                status: 'confirmed'
            })
            .eq('id', sessionId);

        if (error) throw error;

        return true;
    },

    /**
     * Add a message to a booking
     */
    async sendMessage(bookingId, senderId, message, role = 'mentor') {
        if (!bookingId || !senderId || !message) {
            console.error("MentorService.sendMessage: Missing required arguments", { bookingId, senderId, message });
            throw new Error("Missing required fields for sending message.");
        }

        const { error } = await supabase
            .from('mentorship_booking_messages')
            .insert({
                booking_id: bookingId,
                sender_id: senderId,
                message_text: message,
                sender_role: role
            });

        if (error) throw error;

        return true;
    },

    /**
     * Get messages for a booking
     */
    async getMessages(bookingId) {
        const { data, error } = await supabase
            .from('mentorship_booking_messages')
            .select(`
                *,
                sender:profiles(full_name, avatar_url, avatar_storage_key)
            `)
            .eq('booking_id', bookingId)
            .order('created_at', { ascending: true });

        if (error) throw error;
        return data || [];
    },

    /**
     * Propose a location for in-person meetings
     */
    async proposeLocation(sessionId, location) {
        const { error } = await supabase
            .from('mentorship_sessions')
            .update({ 
                meeting_location: location,
                booking_status: 'location_negotiation'
            })
            .eq('id', sessionId);

        if (error) throw error;

        return true;
    },

    /** MENTOR CATEGORY MANAGEMENT */
    async getMentorCategories() {
        // Public-facing: only return active categories, ordered by domain then name for grouping
        const { data, error } = await supabase
            .from('mentor_categories')
            .select('id, name, slug, domain_name')
            .eq('is_active', true)
            .order('domain_name')
            .order('name');
        if (error) throw error;
        return data;
    },

    /** Returns categories grouped by domain_name for hierarchical filter UI */
    async getGroupedMentorCategories() {
        const categories = await this.getMentorCategories();
        const groups = {};
        for (const cat of categories) {
            const domain = cat.domain_name || 'General';
            if (!groups[domain]) groups[domain] = [];
            groups[domain].push(cat);
        }
        // Return as sorted array of { domain, categories[] }
        return Object.entries(groups)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([domain, cats]) => ({ domain, categories: cats }));
    },

    async getAllMentorCategoriesAdmin() {
        const { data, error } = await supabase
            .from('mentor_categories')
            .select('*, expertise_areas(id)')
            .order('name');
        if (error) throw error;
        return data;
    },

    async createMentorCategory(name, slug, isActive = true) {
        const { data, error } = await supabase
            .from('mentor_categories')
            .insert([{ name, slug, is_active: isActive }])
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async updateMentorCategory(id, updates) {
        const { data, error } = await supabase
            .from('mentor_categories')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async deleteMentorCategory(id) {
        const { error } = await supabase
            .from('mentor_categories')
            .delete()
            .eq('id', id);
        if (error) throw error;
    },

    /** SEARCH TRACKING */
    async trackSearch(keyword, resultsCount) {
        const { error } = await supabase.rpc('track_search', {
            p_keyword: keyword,
            p_marketplace_type: 'mentor',
            p_results_count: resultsCount
        });
        if (error) console.warn('Mentor search tracking failed:', error.message);
    },

    /** WISHLIST */
    async toggleWishlist(mentorId, studentId) {
        const { data: profile, error: pErr } = await supabase
            .from('profiles')
            .select('account_status')
            .eq('id', studentId)
            .single();

        if (pErr) throw pErr;
        if (profile.account_status === 'suspended') {
            throw new Error("Your account is currently suspended. You cannot modify your wishlist.");
        }

        const { data: existing } = await supabase
            .from('mentor_wishlist')
            .select('id')
            .eq('mentor_id', mentorId)
            .eq('student_id', studentId)
            .maybeSingle();

        if (existing) {
            await supabase.from('mentor_wishlist').delete().eq('id', existing.id);
            return false;
        } else {
            await supabase.from('mentor_wishlist').insert({
                mentor_id: mentorId,
                student_id: studentId
            });
            return true;
        }
    },

    async getWishlistStatus(mentorId, studentId) {
        if (!studentId) return false;
        const { data } = await supabase
            .from('mentor_wishlist')
            .select('id')
            .eq('mentor_id', mentorId)
            .eq('student_id', studentId)
            .maybeSingle();
        return !!data;
    },

    async getStudentWishlist(studentId) {
        const { data: wishlisted, error } = await supabase
            .from('mentor_wishlist')
            .select('mentor_id, added_at')
            .eq('student_id', studentId);
            
        if (error) throw error;
        if (!wishlisted || wishlisted.length === 0) return [];
        
        const mentorIds = wishlisted.map(w => w.mentor_id);
        const allActive = await this.getActiveMentors();
        return allActive.filter(m => mentorIds.includes(m.instructor_id));
    }
};
