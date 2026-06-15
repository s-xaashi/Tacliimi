import { supabase } from './supabaseClient.js';

export const PayoutService = {
    /**
     * Store Mobile Money or COD payout structure as an UPSERT per instructor
     */
    async savePayoutMethod(userId, methodType, details) {

        let payload = {
            instructor_id: userId,
            method_type: methodType
        };

        if (methodType === 'mobile_money') {
            payload.provider_name = details.provider;
            payload.phone_number = details.phone;
            payload.country = null;
            payload.city = null;
            payload.address = null;
        } else if (methodType === 'cod') {
            payload.address = details.address;
            payload.city = details.city;
            payload.country = details.country;
            payload.phone_number = details.phone;
            payload.provider_name = null;
        }

        // We clean old methods first so they only ever have 1 primary method, or we could just rely on the UI.
        // Easiest is to delete existing for that instructor and insert new.
        await supabase.from('payout_methods').delete().eq('instructor_id', userId);

        const { error } = await supabase
            .from('payout_methods')
            .insert(payload);

        if (error) throw error;
        return true;
    },

    /**
     * Get instructors payout methods
     */
    async getMyPayoutMethod(userId) {
        const { data, error } = await supabase
            .from('payout_methods')
            .select('*')
            .eq('instructor_id', userId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error && error.code !== 'PGRST116') throw error;
        return data || null;
    },

    /**
     * Get payout history
     */
    async getPayoutHistory(userId) {
        const { data, error } = await supabase
            .from('payout_history')
            .select('*')
            .eq('instructor_id', userId)
            .order('date', { ascending: false });

        if (error) throw error;
        return data || [];
    },

    /**
     * Get all transactions linked to instructor
     */
    async getTransactions(userId) {
        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('instructor_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    }
};
