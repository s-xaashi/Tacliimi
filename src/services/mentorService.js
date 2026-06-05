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
            .single();

        const { data: teachingProfile, error: tErr } = await supabase
            .from('teaching_profiles')
            .select('*')
            .eq('instructor_id', userId)
            .single();

        if (pErr || tErr) throw new Error("Incomplete profile data preventing mentorship publishing.");

        // Upsert into Mentorship Table directly syncing data
        const { error } = await supabase
            .from('mentorship_profiles')
            .upsert({
                instructor_id: userId,
                headline: globalProfile.professional_title,
                bio: globalProfile.short_bio, // Changed from short_bio to bio
                is_public: true // Setting to public allows the marketplace to detect
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
            .single();

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
            // Join with profiles, teaching_profiles, and expertise_areas
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
                    profile:profiles (
                        full_name,
                        avatar_url,
                        short_bio,
                        professional_title,
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
                .eq('is_public', true)
                .is('deleted_at', null);

            if (error) throw error;

            // Fetch reviews for rating averages
            const { data: reviews, error: rErr } = await supabase
                .from('mentorship_reviews')
                .select('mentor_id, rating');

            if (rErr) throw rErr;

            // Map the data
            return data.map(mentor => {
                const mentorReviews = reviews.filter(r => r.mentor_id === mentor.instructor_id);
                const avgRating = mentorReviews.length > 0 
                    ? mentorReviews.reduce((sum, r) => sum + r.rating, 0) / mentorReviews.length 
                    : 0;

                return {
                    id: mentor.id,
                    instructor_id: mentor.instructor_id,
                    full_name: mentor.profile?.full_name || 'Anonymous Mentor',
                    avatar_url: mentor.profile?.avatar_url,
                    short_bio: mentor.profile?.short_bio || mentor.bio || 'No bio available.',
                    expertise: mentor.profile?.expertise?.map(e => e.expertise_name) || [],
                    introduction_video: mentor.introduction_video_url || mentor.profile?.teaching?.[0]?.introduction_video_url,
                    teaching_experience: mentor.profile?.teaching?.[0]?.teaching_experience,
                    experience: mentor.profile?.teaching?.[0]?.teaching_experience,
                    education: mentor.profile?.teaching?.[0]?.educational_background,
                    education_list: mentor.profile?.teaching?.[0]?.educational_background ? 
                        (() => {
                            try {
                                const edu = mentor.profile.teaching[0].educational_background;
                                return typeof edu === 'string' ? JSON.parse(edu) : edu;
                            } catch (e) {
                                console.warn("Failed to parse education JSON:", e);
                                return [];
                            }
                        })() : [],
                    languages: mentor.profile?.teaching?.[0]?.languages_spoken,
                    hourly_rate: mentor.hourly_rate || 0,
                    monthly_rate: mentor.monthly_rate || (mentor.hourly_rate * 20),
                    currency: mentor.currency || 'USD',
                    total_sessions: mentor.total_sessions || 0,
                    avg_response_time: mentor.avg_response_time_hours || 0,
                    country: mentor.mentorship_country,
                    city: mentor.mentorship_city,
                    headline: mentor.headline,
                    rating: avgRating.toFixed(1),
                    review_count: mentorReviews.length,
                    meeting_types: mentor.meeting_types
                };
            });
        } catch (error) {
            console.error('Error in getActiveMentors:', error);
            throw error;
        }
    },

    async getMentorById(mentorId) {
        try {
            const { data, error } = await supabase
                .from('mentorship_profiles')
                .select(`
                    *,
                    profile:profiles (
                        full_name,
                        avatar_url,
                        short_bio,
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
                .single();

            if (error) throw error;

            // Fetch reviews for rating averages
            const { data: reviews, error: rErr } = await supabase
                .from('mentorship_reviews')
                .select('rating, comment, created_at, student:profiles!student_id(full_name, avatar_url)')
                .eq('mentor_id', mentorId);

            if (rErr) throw rErr;

            const avgRating = reviews.length > 0 
                ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length 
                : 0;

            return {
                id: data.id,
                instructor_id: data.instructor_id,
                full_name: data.profile?.full_name,
                avatar_url: data.profile?.avatar_url,
                short_bio: data.profile?.short_bio || data.bio,
                gender: data.profile?.gender,
                expertise: data.profile?.expertise?.map(e => e.expertise_name) || [],
                introduction_video: data.introduction_video_url || data.profile?.teaching?.[0]?.introduction_video_url,
                teaching_experience: data.profile?.teaching?.[0]?.teaching_experience,
                experience: data.profile?.teaching?.[0]?.teaching_experience,
                education: data.profile?.teaching?.[0]?.educational_background,
                education_list: data.profile?.teaching?.[0]?.educational_background ? 
                    (() => {
                        try {
                            const edu = data.profile.teaching[0].educational_background;
                            return typeof edu === 'string' ? JSON.parse(edu) : edu;
                        } catch (e) {
                            console.warn("Failed to parse education JSON:", e);
                            return [];
                        }
                    })() : [],
                languages: data.profile?.teaching?.[0]?.languages_spoken,
                hourly_rate: data.hourly_rate || 0,
                monthly_rate: data.monthly_rate || (data.hourly_rate * 20),
                currency: data.currency || 'USD',
                total_sessions: data.total_sessions || 0,
                avg_response_time: data.avg_response_time_hours || 0,
                country: data.mentorship_country,
                city: data.mentorship_city,
                headline: data.headline,
                rating: avgRating.toFixed(1),
                review_count: reviews.length,
                reviews: reviews,
                meeting_types: data.meeting_types
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
            .single();

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
                .single();

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
    }
};
