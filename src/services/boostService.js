import { supabase } from './supabaseClient.js';

export const boostService = {
    /**
     * Get platform boost settings
     */
    getBoostSettings: async () => {
        try {
            const { data, error } = await supabase
                .from('platform_settings')
                .select('course_boost_price_per_day, mentor_boost_price_per_day, course_banner_price_per_day, mentor_banner_price_per_day, boost_min_days, boost_max_days, boost_rotation_window_minutes')
                .single();
            if (error) {
                // Return defaults
                return {
                    course_boost_price_per_day: 5,
                    mentor_boost_price_per_day: 5,
                    course_banner_price_per_day: 3,
                    mentor_banner_price_per_day: 3,
                    boost_min_days: 1,
                    boost_max_days: 90,
                    boost_rotation_window_minutes: 3
                };
            }
            return data;
        } catch (error) {
            console.error('Err in getBoostSettings:', error);
            return null;
        }
    },

    /**
     * Get rotation-ordered boosted entity IDs
     */
    getBoostedEntityIds: async (entityType) => {
        const { data, error } = await supabase.rpc('get_boosted_entity_ids', { p_entity_type: entityType });
        if (error) {
            console.error('Error fetching boosted entities:', error);
            return [];
        }
        // Depending on Postgres version, it could return array of objects or direct values
        return data.map(item => item.get_boosted_entity_ids || item.entity_id || item.id || item);
    },

    /**
     * Get active promo banners
     */
    getActivePromoBanners: async (entityType) => {
        const { data, error } = await supabase.rpc('get_active_promo_banners', { p_entity_type: entityType });
        if (error) {
            console.error('Error fetching promo banners:', error);
            return [];
        }
        return data; // returns array of { entity_id, banner_text }
    },

    /**
     * Purchase a boost
     */
    purchaseBoost: async ({ entityType, entityId, planDays, amountPaid, courseId = null, mentorshipId = null }) => {
        const { data, error } = await supabase.rpc('purchase_boost', {
            p_entity_type: entityType,
            p_entity_id: entityId,
            p_plan_days: planDays,
            p_amount_paid: amountPaid,
            p_course_id: courseId,
            p_mentorship_id: mentorshipId
        });
        if (error) throw error;
        return data;
    },

    /**
     * Purchase a promo banner
     */
    purchasePromoBanner: async ({ entityType, entityId, bannerText, planDays, amountPaid, courseId = null, mentorshipId = null }) => {
        const { data, error } = await supabase.rpc('purchase_promo_banner', {
            p_entity_type: entityType,
            p_entity_id: entityId,
            p_banner_text: bannerText,
            p_plan_days: planDays,
            p_amount_paid: amountPaid,
            p_course_id: courseId,
            p_mentorship_id: mentorshipId
        });
        if (error) throw error;
        return data;
    },

    /**
     * Cancel a boost
     */
    cancelBoost: async (boostId) => {
        const { error } = await supabase.rpc('cancel_boost', {
            p_boost_id: boostId
        });
        if (error) throw error;
        return true;
    },

    /**
     * Cancel a promo banner
     */
    cancelBanner: async (bannerId) => {
        const { error } = await supabase.rpc('cancel_promo_banner', {
            p_banner_id: bannerId
        });
        if (error) throw error;
        return true;
    },

    /**
     * Admin: Cancel a boost
     */
    adminCancelBoost: async (boostId, note = null) => {
        const { error } = await supabase.rpc('admin_cancel_boost', {
            p_boost_id: boostId,
            p_note: note
        });
        if (error) throw error;
        return true;
    },

    /**
     * Admin: Cancel a banner
     */
    adminCancelBanner: async (bannerId, note = null) => {
        const { error } = await supabase.rpc('admin_cancel_promo_banner', {
            p_banner_id: bannerId,
            p_note: note
        });
        if (error) throw error;
        return true;
    },

    /**
     * Get instructor's own boosts and banners (for a specific entity) combined
     */
    getMyBoosts: async (entityId) => {
        // Fetch active/scheduled boosts
        const { data: boosts, error: bError } = await supabase
            .from('boosts')
            .select('*')
            .eq('entity_id', entityId)
            .order('created_at', { ascending: false });
            
        // Fetch active/scheduled banners
        const { data: banners, error: pbError } = await supabase
            .from('promo_banners')
            .select('*')
            .eq('entity_id', entityId)
            .order('created_at', { ascending: false });

        return { 
            boosts: bError ? [] : boosts, 
            banners: pbError ? [] : banners 
        };
    },

    /**
     * Get all boosts + banners for admin
     */
    getAllBoostsAdmin: async () => {
        const { data: boosts, error: bError } = await supabase
            .from('boosts')
            .select('*')
            .order('created_at', { ascending: false });
            
        const { data: banners, error: pbError } = await supabase
            .from('promo_banners')
            .select('*')
            .order('created_at', { ascending: false });

        if (bError || pbError) throw new Error("Error fetching admin boosts");
        
        // Fetch profiles separately to map names
        const instructorIds = [...new Set([
            ...boosts.map(b => b.instructor_id),
            ...banners.map(b => b.instructor_id)
        ])];
        
        let profileMap = {};
        if (instructorIds.length > 0) {
            const { data: profiles } = await supabase
                .from('profiles')
                .select('id, full_name, email, avatar_url')
                .in('id', instructorIds);
            if (profiles) {
                profiles.forEach(p => profileMap[p.id] = p);
            }
        }
        
        // Flatten into a unified list with extra display fields
        const allItems = [
            ...boosts.map(b => ({
                ...b,
                entity_type: b.entity_type || 'course',
                instructor_name: profileMap[b.instructor_id]?.full_name || 'Unknown',
                instructor_avatar: profileMap[b.instructor_id]?.avatar_url || null
            })),
            ...banners.map(b => ({
                ...b,
                entity_type: 'banner',
                instructor_name: profileMap[b.instructor_id]?.full_name || 'Unknown',
                instructor_avatar: profileMap[b.instructor_id]?.avatar_url || null
            }))
        ];
        
        // Sort: newest first
        allItems.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return allItems;
    }
};

// Named export for destructured import
export const BoostService = boostService;
