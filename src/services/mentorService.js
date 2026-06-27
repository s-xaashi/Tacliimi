import { supabase } from './supabaseClient.js';
import { ProfileService } from './profileService.js';

export const MentorService = {
    /**
     * Push normal setup profile data to the Mentorship Profiles index
     * Makes the user available in generic Marketplace scans
     */
    async publishMentorshipProfile(userId) {
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
                introduction_video_url: teachingProfile?.introduction_video_url, // Synchronize video URL
                is_public: true
            }, { onConflict: 'instructor_id' });

        if (error) throw error;
        return true;
    },

    /**
     * Hide completely from Marketplace
     */
    async hideProfile(userId) {
        const { error } = await supabase
            .from('mentorship_profiles')
            .update({ is_public: false })
            .eq('instructor_id', userId);

        if (error) throw error;
        return true;
    },

    /**
     * Apply for mentorship program
     * Saves application data and publishes the profile
     */
    async applyForMentorship(userId, applicationData) {
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
     */
    async saveAvailability(userId, { slots, meetingTypes }) {
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
     */
    async updatePricing(userId, rate, monthlyRate, currency = 'USD') {
        const { error } = await supabase
            .from('mentorship_profiles')
            .update({ 
                hourly_rate: rate,
                monthly_rate: monthlyRate,
                currency: currency
            })
            .eq('instructor_id', userId);

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
                    is_public,
                    meeting_types,
                    currency,
                    profile:profiles!inner (
                        full_name,
                        avatar_url,
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
                        .select('instructor_id, avg_rating, review_count');
                    if (vRatings) {
                        vRatings.forEach(r => {
                            ratingMap[r.instructor_id] = { 
                                avg: r.avg_rating ?? '0.0', 
                                count: r.review_count ?? 0 
                            };
                        });
                    }
                } catch (vErr) {
                    console.warn('[Marketplace] View fallback also failed:', vErr.message);
                }
            }

            // ── Merge and map ────────────────────────────────────────────────
            return data.map(mentor => {
                const teachingData = Array.isArray(mentor.profile?.teaching) 
                    ? mentor.profile.teaching[0] 
                    : mentor.profile?.teaching;

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
                    introduction_video: mentor.introduction_video_url || teachingData?.introduction_video_url,
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
                    total_sessions: mentor.total_sessions || 0,
                    avg_response_time: mentor.avg_response_time_hours || 0,
                    country: mentor.profile?.country || mentor.mentorship_country,
                    city: mentor.profile?.city || mentor.mentorship_city,
                    headline: mentor.headline,
                    rating: finalRating,
                    review_count: finalCount,
                    meeting_types: mentor.meeting_types,
                    serial_id: mentor.profile?.serial_id
                };
            });
        } catch (error) {
            console.error('Error in getActiveMentors:', error);
            throw error;
        }
    },


    async getMentorById(mentorId) {
        try {
            // ── Query 1: Core profile (required) ────────────────────────────
            const { data, error } = await supabase
                .from('mentorship_profiles')
                .select(`
                    *,
                    profile:profiles (
                        full_name,
                        avatar_url,
                        short_bio,
                        serial_id,
                        gender,
                        teaching:teaching_profiles (
                            introduction_video_url,
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
                .maybeSingle();

            if (error) throw error;
            if (!data) return null;

            // ── Query 2: Rating stats (optional) ────────────────────────────
            let ratingStats = null;
            try {
                const { data: rs } = await supabase
                    .from('mentor_rating_stats')
                    .select('avg_rating, review_count')
                    .eq('instructor_id', mentorId)
                    .maybeSingle();
                ratingStats = rs || null;
            } catch (ratingErr) {
                console.warn('[MentorProfile] Could not load rating stats:', ratingErr.message);
            }
            
            const teachingData = Array.isArray(data.profile?.teaching) 
                ? data.profile.teaching[0] 
                : data.profile?.teaching;

            // Fetch full reviews with comments (for display)
            const { data: reviews, error: rErr } = await supabase
                .from('mentorship_reviews')
                .select('rating, comment, created_at, student:profiles!mentorship_reviews_student_id_fkey(full_name, avatar_url)')
                .eq('mentor_id', mentorId);

            if (rErr) {
                console.warn("Failed to fetch mentorship reviews:", rErr);
            }

            const activeReviews = reviews || [];

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

            const { data: availability, error: aErr } = await supabase
                .from('mentor_availability')
                .select('*')
                .eq('mentor_id', mentorId)
                .is('is_enabled', true)
                .order('day_of_week', { ascending: true })
                .order('start_time', { ascending: true });

            if (aErr) {
                console.warn("Failed to fetch mentor availability:", aErr);
            }

            return {
                id: data.id,
                instructor_id: data.instructor_id,
                full_name: data.profile?.full_name,
                avatar_url: data.profile?.avatar_url,
                short_bio: data.profile?.short_bio || data.bio,
                gender: data.profile?.gender,
                expertise: data.profile?.expertise?.map(e => e.expertise_name) || [],
                introduction_video: data.introduction_video_url || teachingData?.introduction_video_url,
                teaching_experience: teachingData?.teaching_experience,
                mentorship_style: teachingData?.mentorship_style,
                experience: teachingData?.teaching_experience,
                education: teachingData?.educational_background,
                education_list: teachingData?.educational_background
                    ? (() => { try { const e = teachingData.educational_background; return typeof e === 'string' ? JSON.parse(e) : e; } catch { return []; } })()
                    : [],
                languages: teachingData?.languages_spoken,
                hourly_rate: data.hourly_rate || 0,
                monthly_rate: data.monthly_rate || (data.hourly_rate * 20),
                currency: data.currency || 'USD',
                total_sessions: data.total_sessions || 0,
                avg_response_time: data.avg_response_time_hours || 0,
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

    async updatePrivacy(userId, isPublic) {
        const { error } = await supabase
            .from('mentorship_profiles')
            .update({ is_public: isPublic })
            .eq('instructor_id', userId);

        if (error) throw error;
        return true;
    },

    async submitReview(mentorId, studentId, rating, comment) {
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
                .eq('code', code.toUpperCase())
                .maybeSingle();

            if (error) {
                if (error.code === 'PGRST116') return { valid: false, message: 'Invalid coupon code' };
                if (error.message?.includes('relation "public.mentorship_coupons" does not exist')) {
                    return { valid: false, message: 'Coupon system not yet initialized. Please contact the administrator (SQL migration needed).' };
                }
                throw error;
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

        const { data, error } = await supabase
            .from('mentorship_sessions')
            .insert({
                student_id: sessionData.studentId,
                mentor_id: sessionData.mentorId,
                scheduled_at: sessionData.scheduledAt,
                status: 'pending', // Keep legacy for compat
                booking_status: 'pending_review',
                notes: sessionData.notes || '',
                topic: sessionData.topic,
                meeting_type: sessionData.meetingType,
                meeting_location: sessionData.meetingLocation,
                student_phone: sessionData.studentPhone,
                duration_minutes: sessionData.durationMinutes || 60
            })
            .select()
            .single();

        if (error) throw error;

        return data;
    },

    /**
     * Fetch sessions for a student
     */
    async getStudentSessions(studentId) {
        const { data, error } = await supabase
            .from('mentorship_sessions')
            .select(`
                *,
                mentor:profiles!mentorship_sessions_mentor_id_fkey (
                    full_name,
                    avatar_url,
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
                .select('id, full_name, avatar_url, email, phone_number, country, city, professional_title, short_bio, gender, learning_interests, social_links')
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
            .eq('id', sessionId);

        if (error) throw error;

        return true;
    },

    /**
     * Delete a mentorship session
     */
    async deleteSession(sessionId) {
        const { error } = await supabase
            .from('mentorship_sessions')
            .delete()
            .eq('id', sessionId);

        if (error) throw error;
        return true;
    },

    /**
     * Update session meeting link and mark as confirmed
     */
    async updateMeetingLink(sessionId, link) {
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
                sender:profiles(full_name, avatar_url)
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
    }
};
