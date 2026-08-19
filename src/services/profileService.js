import { supabase } from './supabaseClient.js';
import { AuthService } from './authService.js';
import { PayoutService } from './payoutService.js';

// File validation constants
const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm'];
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB

export const ProfileService = {
    /**
     * Get the completely structured profile including teaching and payout data
     */
    async getFullProfile(userId) {
        // Helper: safely parse a JSON string field
        const safeJson = (raw, fallback = []) => {
            if (!raw) return fallback;
            if (Array.isArray(raw)) return raw; // already parsed
            try { return JSON.parse(raw); } catch { return fallback; }
        };

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

        // 3. Expertise (deduplicated by name, case-insensitive)
        const { data: expertise } = await supabase
            .from('expertise_areas')
            .select('expertise_name')
            .eq('instructor_id', userId);

        const seenExp = new Set();
        const expertiseList = (expertise || []).reduce((acc, e) => {
            const key = (e.expertise_name || '').toLowerCase();
            if (key && !seenExp.has(key)) { seenExp.add(key); acc.push(e.expertise_name); }
            return acc;
        }, []);

        // 4. Payout
        const payoutMethod = await PayoutService.getMyPayoutMethod(userId);

        return {
            ...profile,
            teaching_experience: teachingProfile?.teaching_experience || "",
            experience: teachingProfile?.teaching_experience || "",
            introVideo: teachingProfile?.introduction_video_url || "",
            mentorship_style: teachingProfile?.mentorship_style || "",
            education_list: safeJson(teachingProfile?.educational_background),
            language_list: safeJson(teachingProfile?.languages_spoken),
            expertise_list: expertiseList,
            payout_method: payoutMethod ? (payoutMethod.method_type === 'cash_on_delivery' ? 'Cash on Delivery' : 'Mobile Money') : null,
            payout_details: payoutMethod ? {
                provider: payoutMethod.provider_name,
                mm_phone: payoutMethod.phone_mobile_money,
                cod_phone: payoutMethod.phone_cash_on_delivery,
                address: payoutMethod.address,
                city: payoutMethod.city,
                country: payoutMethod.country
            } : {}
        };
    },

    /**
     * Updates the main instructor profiles table.
     * SECURITY: userId is sourced from the authenticated session — not from caller.
     */
    async updatePersonalInfo(profileData) {
        const session = await AuthService.getSession();
        if (!session) throw new Error('Unauthorized: No active session');

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
            .eq('id', session.user.id)
            .select()
            .maybeSingle();

        if (error) throw error;
        return data;
    },

    /**
     * Upserts teaching profile data.
     * SECURITY: userId is sourced from the authenticated session — not from caller.
     */
    async saveTeachingProfile(teachingData, expertiseList) {
        const session = await AuthService.getSession();
        if (!session) throw new Error('Unauthorized: No active session');
        const userId = session.user.id;
        // 1. Save Teaching Profile row
        const { error: teachingErr } = await supabase
            .from('teaching_profiles')
            .upsert({
                instructor_id: userId,
                introduction_video_url: teachingData.introVideo || '',
                teaching_experience: teachingData.experience || '',
                mentorship_style: teachingData.mentorship_style || null,
                educational_background: teachingData.education || '[]',
                languages_spoken: teachingData.languages || '[]'
            }, { onConflict: 'instructor_id' });

        if (teachingErr) throw teachingErr;

        // Sync video to mentorship_profiles (non-blocking)
        if (teachingData.introVideo) {
            await supabase
                .from('mentorship_profiles')
                .update({ introduction_video_url: teachingData.introVideo })
                .eq('instructor_id', userId);
        }

        // 2. Deduplicate incoming expertise list before processing
        const uniqueExpertise = [...new Set(
            (expertiseList || []).map(e => e.trim()).filter(Boolean)
        )];

        // 3. Clear old expertise and insert fresh set
        await supabase.from('expertise_areas').delete().eq('instructor_id', userId);

        if (uniqueExpertise.length > 0) {
            // Resolve names against mentor_categories
            const { data: allCats } = await supabase
                .from('mentor_categories')
                .select('id, name, slug');

            const catMap = {};
            (allCats || []).forEach(c => { catMap[c.name.toLowerCase()] = c; });

            const expertisePayload = [];
            for (const expert of uniqueExpertise) {
                const searchKey = expert.toLowerCase();
                let catEntry = catMap[searchKey];

                // Auto-create a new category if not found
                if (!catEntry) {
                    const newSlug = searchKey.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                    // Check if a slug collision exists first
                    const { data: existingCat } = await supabase
                        .from('mentor_categories')
                        .select('id, name')
                        .ilike('name', expert)
                        .maybeSingle();

                    if (existingCat) {
                        catEntry = existingCat;
                        catMap[searchKey] = existingCat;
                    } else {
                        const { data: newCat, error: catErr } = await supabase
                            .from('mentor_categories')
                            .insert([{ name: expert, slug: newSlug, domain_name: 'General' }])
                            .select()
                            .single();
                        if (!catErr && newCat) {
                            catEntry = newCat;
                            catMap[searchKey] = newCat;
                        } else {
                            console.warn('[ProfileService] Could not create category for:', expert, catErr?.message);
                        }
                    }
                }

                if (catEntry) {
                    expertisePayload.push({
                        instructor_id: userId,
                        expertise_name: catEntry.name,
                        mentor_category_id: catEntry.id
                    });
                }
            }

            if (expertisePayload.length > 0) {
                const { error: expertErr } = await supabase
                    .from('expertise_areas')
                    .insert(expertisePayload);
                if (expertErr) {
                    console.error('[ProfileService] Failed to insert expertise_areas:', expertErr);
                    throw expertErr;
                }
            }
        }

        return true;
    },

    /**
     * Mark onboarding as complete to drop dashboard locks.
     * SECURITY: userId is sourced from the authenticated session — not from caller.
     */
    async markProfileCompleted() {
        const session = await AuthService.getSession();
        if (!session) throw new Error('Unauthorized: No active session');

        const { data, error } = await supabase
            .from('profiles')
            .update({ profile_completed: true, updated_at: new Date() })
            .eq('id', session.user.id)
            .select()
            .maybeSingle();

        if (error) throw error;
        return data;
    },

    /**
     * Upload Avatar to Storage and update Profile.
     * SECURITY: userId from session. File type and size validated before upload.
     */
    async uploadAvatar(fileObject) {
        const session = await AuthService.getSession();
        if (!session) throw new Error('Unauthorized: No active session');
        const userId = session.user.id;

        // SECURITY: Validate file type and size
        if (!ALLOWED_AVATAR_TYPES.includes(fileObject.type)) {
            throw new Error('Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.');
        }
        if (fileObject.size > MAX_AVATAR_BYTES) {
            throw new Error('File too large. Maximum avatar size is 5MB.');
        }

        const fileExt = fileObject.name.split('.').pop().toLowerCase();
        const filePath = `${userId}/profile_${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(filePath, fileObject, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(filePath);

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
     * Upload Intro Video to Storage.
     * SECURITY: userId from session. File type and size validated before upload.
     */
    async uploadVideo(fileObject) {
        const session = await AuthService.getSession();
        if (!session) throw new Error('Unauthorized: No active session');
        const userId = session.user.id;

        // SECURITY: Validate file type and size
        if (!ALLOWED_VIDEO_TYPES.includes(fileObject.type)) {
            throw new Error('Invalid video type. Only MP4 and WebM are allowed.');
        }
        if (fileObject.size > MAX_VIDEO_BYTES) {
            throw new Error('Video file too large. Maximum size is 200MB.');
        }

        const fileExt = fileObject.name.split('.').pop().toLowerCase();
        const filePath = `${userId}/intro_${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
            .from('intro_videos')
            .upload(filePath, fileObject, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage.from('intro_videos').getPublicUrl(filePath);
        return publicUrlData.publicUrl;
    }
};
