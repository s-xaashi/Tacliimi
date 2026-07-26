import { supabase } from './supabaseClient.js';

export const financeSettingsService = {
    /**
     * Get platform monetization settings
     * Calls public RPC get_platform_settings
     * @returns {Promise<Object>} Settings object
     */
    getSettings: async () => {
        try {
            const { data, error } = await supabase.rpc('get_platform_settings');
            
            if (error) {
                console.error('Error fetching platform settings:', error);
                // Fallback to defaults to prevent crashes
                return {
                    commission_enabled: false,
                    instructor_percentage: 100,
                    platform_percentage: 0,
                    min_withdrawal_amount: 10,
                    show_refund_request: true,
                    course_boost_price_per_day: 5,
                    mentor_boost_price_per_day: 5,
                    course_banner_price_per_day: 3,
                    mentor_banner_price_per_day: 3,
                    boost_min_days: 1,
                    boost_max_days: 90,
                    boost_rotation_window_minutes: 3,
                    course_boost_enabled: true,
                    course_banner_enabled: true,
                    mentor_boost_enabled: true,
                    mentor_banner_enabled: true
                };
            }
            
            return data;
        } catch (error) {
            console.error('Err in getSettings:', error);
            // Fallback
            return {
                commission_enabled: false,
                instructor_percentage: 100,
                platform_percentage: 0,
                min_withdrawal_amount: 10,
                show_refund_request: true,
                course_boost_price_per_day: 5,
                mentor_boost_price_per_day: 5,
                course_banner_price_per_day: 3,
                mentor_banner_price_per_day: 3,
                boost_min_days: 1,
                boost_max_days: 90,
                boost_rotation_window_minutes: 3,
                course_boost_enabled: true,
                course_banner_enabled: true,
                mentor_boost_enabled: true,
                mentor_banner_enabled: true
            };
        }
    },

    /**
     * Update platform monetization settings (Admin Only)
     * @param {Object} settings
     * @returns {Promise<Object>} Updated settings
     */
    updateSettings: async (settings) => {
        try {
            const { data: user } = await supabase.auth.getUser();
            if (!user?.user) throw new Error("Not authenticated");

            // We update the single row (id is mostly irrelevant because it's single row, but we use an update without where that updates everything, or delete and insert, or update all)
            // Let's just update all rows
            const { data, error } = await supabase
                .from('platform_settings')
                .update({
                    commission_enabled: settings.commission_enabled,
                    instructor_percentage: settings.instructor_percentage,
                    platform_percentage: settings.platform_percentage,
                    min_withdrawal_amount: settings.min_withdrawal_amount,
                    show_refund_request: settings.show_refund_request,
                    course_boost_price_per_day: settings.course_boost_price_per_day,
                    mentor_boost_price_per_day: settings.mentor_boost_price_per_day,
                    course_banner_price_per_day: settings.course_banner_price_per_day,
                    mentor_banner_price_per_day: settings.mentor_banner_price_per_day,
                    boost_min_days: settings.boost_min_days,
                    boost_max_days: settings.boost_max_days,
                    boost_rotation_window_minutes: settings.boost_rotation_window_minutes,
                    course_boost_enabled: settings.course_boost_enabled,
                    course_banner_enabled: settings.course_banner_enabled,
                    mentor_boost_enabled: settings.mentor_boost_enabled,
                    mentor_banner_enabled: settings.mentor_banner_enabled,
                    updated_by: user.user.id,
                    updated_at: new Date().toISOString()
                })
                .neq('id', '00000000-0000-0000-0000-000000000000') // dummy filter to update all matching
                .select();
            
            if (error) throw error;
            return { success: true, data: data[0] };
        } catch (error) {
            console.error('Err in updateSettings:', error);
            return { success: false, error: error.message };
        }
    },

    /**
     * Get Admin Finance Analytics
     * @returns {Promise<Object>} Analytics data
     */
    getAdminAnalytics: async () => {
        try {
            const { data, error } = await supabase.rpc('get_finance_analytics');
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Err in getAdminAnalytics:', error);
            return null;
        }
    }
};
