import { supabase } from './supabaseClient.js';
import { PayoutService } from './payoutService.js';

export const ProfileService = {
    /**
     * Get the completely structured profile including teaching and payout data
     */
    async getFullProfile(userId) {
        // 1. Base Profile
        const { data: profile, error: pErr } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .maybeSingle();

        if (pErr && pErr.code !== 'PGRST116') throw pErr;
        if (!profile) return null;

        // 2. Teaching Profile
        const { data: teachingProfile } = await supabase
            .from('teaching_profiles')
            .select('*')
            .eq('instructor_id', userId)
            .maybeSingle();

        // 3. Expertise
        const { data: expertise } = await supabase
            .from('expertise_areas')
            .select('*')
            .eq('instructor_id', userId);

        let expertiseList = expertise ? expertise.map(e => e.expertise_name) : [];

        // 4. Payout
        const payoutMethod = await PayoutService.getMyPayoutMethod(userId);

        // Map back to the legacy object structure expected by the UI for easy transition
        return {
            ...profile,
            teaching_experience: teachingProfile?.teaching_experience || "",
            experience: teachingProfile?.teaching_experience || "",
            introVideo: teachingProfile?.introduction_video_url || "",
            mentorship_style: teachingProfile?.mentorship_style || "",
            education_list: teachingProfile?.educational_background ? JSON.parse(teachingProfile.educational_background) : [],
            language_list: teachingProfile?.languages_spoken ? JSON.parse(teachingProfile.languages_spoken) : [],
            expertise_list: expertiseList,
            payout_method: payoutMethod ? (payoutMethod.method_type === 'cod' ? 'Cash on Delivery' : 'Mobile Money') : null,
            payout_details: payoutMethod ? {
                provider: payoutMethod.provider_name,
                phone: payoutMethod.phone_number,
                address: payoutMethod.address,
                city: payoutMethod.city,
                country: payoutMethod.country
            } : {}
        };
    },

    /**
     * Updates the main instructor profiles table
     */
    async updatePersonalInfo(userId, profileData) {
        const { data, error } = await supabase
            .from('profiles')
            .update({
                full_name: profileData.full_name,
                professional_title: profileData.professional_title,
                short_bio: profileData.short_bio,
                social_links: profileData.social_links,
                country: profileData.country,
                city: profileData.city,
                updated_at: new Date()
            })
            .eq('id', userId)
            .select()
            .maybeSingle();

        if (error) throw error;
        return data;
    },

    /**
     * Upserts teaching profile data
     */
    async saveTeachingProfile(userId, teachingData, expertiseList) {
        // 1. Save Teaching Profile
        const { error: teachingErr } = await supabase
            .from('teaching_profiles')
            .upsert({
                instructor_id: userId,
                introduction_video_url: teachingData.introVideo,
                teaching_experience: teachingData.experience,
                mentorship_style: teachingData.mentorship_style,
                educational_background: teachingData.education,
                languages_spoken: teachingData.languages
            }, { onConflict: 'instructor_id' });

        if (teachingErr) throw teachingErr;

        // Sync video and experience to mentorship_profiles if it exists
        const mentorUpdates = {};
        if (teachingData.introVideo) mentorUpdates.introduction_video_url = teachingData.introVideo;
        if (teachingData.experience) mentorUpdates.experience_years = teachingData.experience;

        if (Object.keys(mentorUpdates).length > 0) {
            await supabase
                .from('mentorship_profiles')
                .update(mentorUpdates)
                .eq('instructor_id', userId);
        }

        // 2. Clear old expertise and insert new
        // WE ALWAYS DELETE FIRST to ensure a fresh sync
        await supabase.from('expertise_areas').delete().eq('instructor_id', userId);

        if (expertiseList && expertiseList.length > 0) {
            // Resolve expertise names against centralized mentor_categories table
            // to get the proper mentor_category_id foreign key reference
            const { data: allCats } = await supabase
                .from('mentor_categories')
                .select('id, name, slug');

            const catMap = {};
            (allCats || []).forEach(c => { catMap[c.name.toLowerCase()] = c; });

            const expertisePayload = [];
            for (const expert of expertiseList) {
                const normalizedName = expert.trim();
                const searchKey = normalizedName.toLowerCase();
                let catEntry = catMap[searchKey];

                // Auto-create category if not found (instructor entered new expertise)
                if (!catEntry) {
                    const newSlug = searchKey.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                    const { data: newCat, error: catErr } = await supabase
                        .from('mentor_categories')
                        .insert([{ name: normalizedName, slug: newSlug }])
                        .select()
                        .single();
                    if (!catErr && newCat) {
                        catEntry = newCat;
                        catMap[searchKey] = newCat; // Cache for duplicates in same save
                    }
                }

                if (catEntry) {
                    expertisePayload.push({
                        instructor_id: userId,
                        expertise_name: catEntry.name, // Use canonical name from category
                        mentor_category_id: catEntry.id
                    });
                }
            }

            if (expertisePayload.length > 0) {
                const { error: expertErr } = await supabase.from('expertise_areas').insert(expertisePayload);
                if (expertErr) throw expertErr;
            }
        }

        return true;
    },

    /**
     * Mark onboarding as complete to drop dashboard locks
     */
    async markProfileCompleted(userId) {
        const { data, error } = await supabase
            .from('profiles')
            .update({ profile_completed: true, updated_at: new Date() })
            .eq('id', userId)
            .select()
            .maybeSingle();

        if (error) throw error;
        return data;
    },

    /**
     * Upload Avatar to Storage and update Profile
     */
    async uploadAvatar(userId, fileObject) {
        // FileObject should be a File/Blob, not base64
        const fileExt = fileObject.name.split('.').pop();
        const filePath = `${userId}/profile_${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(filePath, fileObject, { upsert: true });

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(filePath);

        // Update profile
        const { data, error } = await supabase
            .from('profiles')
            .update({ avatar_url: publicUrlData.publicUrl, updated_at: new Date() })
            .eq('id', userId)
            .select()
            .maybeSingle();

        if (error) throw error;
        return data;
    },

    /**
     * Upload Intro Video to Storage
     */
    async uploadVideo(userId, fileObject) {
        const fileExt = fileObject.name.split('.').pop();
        const filePath = `${userId}/intro_${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
            .from('intro_videos') // Correct bucket name
            .upload(filePath, fileObject, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage.from('intro_videos').getPublicUrl(filePath);
        return publicUrlData.publicUrl;
    }
};
