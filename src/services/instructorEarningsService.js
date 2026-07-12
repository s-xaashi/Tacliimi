import { supabase } from './supabaseClient.js';

export const instructorEarningsService = {
    /**
     * Get aggregated earnings summary for the instructor dashboard
     * @param {string} instructorId 
     * @returns {Promise<Object>} Summary object
     */
    getSummary: async (instructorId) => {
        try {
            const { data, error } = await supabase.rpc('get_instructor_earnings_summary', {
                p_instructor_id: instructorId
            });
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error fetching earnings summary:', error);
            return null;
        }
    },

    /**
     * Get withdrawal request history for the instructor
     * @param {string} instructorId 
     * @returns {Promise<Array>} List of withdrawals
     */
    getWithdrawalHistory: async (instructorId) => {
        try {
            const { data, error } = await supabase
                .from('withdrawal_requests')
                .select('*')
                .eq('instructor_id', instructorId)
                .order('created_at', { ascending: false });
                
            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error fetching withdrawal history:', error);
            return [];
        }
    },

    /**
     * Request a new withdrawal
     * @param {number} amount 
     * @param {string} payoutMethodId 
     * @returns {Promise<Object>} Success or error
     */
    requestWithdrawal: async (amount, payoutMethodId) => {
        try {
            const { data, error } = await supabase.rpc('request_withdrawal', {
                p_amount: parseFloat(amount),
                p_payout_method_id: payoutMethodId
            });
            
            if (error) throw error;
            if (!data.success) throw new Error(data.error || "Withdrawal request failed");
            
            return data;
        } catch (error) {
            console.error('Error requesting withdrawal:', error);
            return { success: false, error: error.message };
        }
    },

    /**
     * Get transaction history (Instructor Earnings with Payment details)
     * @param {string} instructorId 
     * @returns {Promise<Array>} List of transactions
     */
    getTransactionHistory: async (instructorId) => {
        try {
            const { data, error } = await supabase
                .from('instructor_earnings')
                .select(`
                    id, 
                    amount:instructor_share, 
                    gross_amount, 
                    platform_fee,
                    earning_type,
                    created_at,
                    payments (
                        id, 
                        student_id, 
                        profiles!student_id(full_name, email)
                    ),
                    courses (id, title)
                `)
                .eq('instructor_id', instructorId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error fetching transaction history:', error);
            return [];
        }
    }
};
