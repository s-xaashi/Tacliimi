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
            payload.phone_mobile_money = details.mm_phone;
            payload.country = details.country || null;
            payload.city = details.city || null;
            payload.address = details.address || null;
            payload.phone_cash_on_delivery = details.cod_phone || null;
        } else if (methodType === 'cash_on_delivery') {
            payload.address = details.address;
            payload.city = details.city;
            payload.country = details.country;
            payload.phone_cash_on_delivery = details.cod_phone;
            payload.provider_name = details.provider || null;
            payload.phone_mobile_money = details.mm_phone || null;
        }

        // Check for uniqueness for whatever phone numbers they provided
        const getCoreNumber = (num) => {
            if (!num) return '';
            const digits = num.replace(/\D/g, '');
            // Remove leading country codes or zeros
            return digits.replace(/^(252|254|253|256|250|255|0+)/, '');
        };

        const coreMM = getCoreNumber(payload.phone_mobile_money);
        const coreCOD = getCoreNumber(payload.phone_cash_on_delivery);

        if (coreMM.length >= 6 || coreCOD.length >= 6) { 
            // Call the RPC function to bypass RLS and check globally
            let isDuplicate = false;
            
            if (coreMM.length >= 6) {
                const { data: mmDup, error: errMM } = await supabase.rpc('check_phone_unique', { p_phone: coreMM, p_user_id: userId });
                if (errMM) {
                    console.error('RPC Error (Mobile Money):', errMM);
                    throw new Error('Failed to validate phone number uniqueness. Please try again.');
                }
                if (mmDup) isDuplicate = true;
            }
            
            if (!isDuplicate && coreCOD.length >= 6) {
                const { data: codDup, error: errCOD } = await supabase.rpc('check_phone_unique', { p_phone: coreCOD, p_user_id: userId });
                if (errCOD) {
                    console.error('RPC Error (COD):', errCOD);
                    throw new Error('Failed to validate phone number uniqueness. Please try again.');
                }
                if (codDup) isDuplicate = true;
            }

            if (isDuplicate) {
                throw new Error('One of your provided phone numbers is already registered to another instructor account.');
            }
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
            .from('payout_transactions')
            .select('*')
            .eq('instructor_id', userId)
            .order('requested_at', { ascending: false });

        if (error) throw error;
        return data || [];
    },

    /**
     * Get all transactions linked to instructor
     */
    async getTransactions(userId) {
        const { data, error } = await supabase
            .from('payout_transactions')
            .select('*')
            .eq('instructor_id', userId)
            .order('requested_at', { ascending: false });

        if (error) throw error;
        return data || [];
    }
};
