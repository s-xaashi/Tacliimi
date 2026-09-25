import { supabase } from './supabaseClient.js';

export const instructorEarningsService = {

    /**
     * Aggregated earnings summary including held_balance.
     * @param {string} instructorId
     */
    getSummary: async (instructorId) => {
        try {
            const { data, error } = await supabase.rpc('get_instructor_earnings_summary', {
                p_instructor_id: instructorId
            });
            if (error) throw error;
            
            if (data) {
                // Deduct paid withdrawals from the gross total to show the net remaining earnings as Total Earnings
                const { data: wData } = await supabase
                    .from('withdrawal_requests')
                    .select('amount')
                    .eq('instructor_id', instructorId)
                    .eq('status', 'paid');
                    
                if (wData) {
                    const totalPaidWithdrawals = wData.reduce((sum, w) => sum + parseFloat(w.amount), 0);
                    
                    if (data.cleared_earnings !== undefined) {
                        data.cleared_earnings = Math.max(0, data.cleared_earnings - totalPaidWithdrawals);
                    } else if (data.net_earnings !== undefined) {
                        data.net_earnings = Math.max(0, data.net_earnings - totalPaidWithdrawals);
                    } else if (data.total_earned !== undefined) {
                        data.total_earned = Math.max(0, data.total_earned - totalPaidWithdrawals);
                    }
                }
            }
            return data;
        } catch (error) {
            console.error('Error fetching earnings summary:', error);
            return null;
        }
    },

    /**
     * Returns serial_id, student name/avatar, and deterministic refund status
     * for all of the calling instructor's own earnings.
     * Uses the SECURITY DEFINER RPC (bypasses RLS on payments / refund_requests safely).
     * @returns {Promise<Map<string, object>>} Map keyed by earning_id
     */
    getPaymentDetails: async () => {
        try {
            const { data, error } = await supabase.rpc('get_instructor_payment_details');
            if (error) throw error;
            const map = new Map();
            (data || []).forEach(row => map.set(row.earning_id, row));
            return map;
        } catch (error) {
            console.error('Error fetching payment details:', error);
            return new Map();
        }
    },

    /**
     * Transaction history — joined with mentorship_sessions for hold-window
     * calculation. Does NOT nest payments (RLS blocks instructor access).
     * @param {string} instructorId
     */
    getTransactionHistory: async (instructorId) => {
        try {
            const { data, error } = await supabase
                .from('instructor_earnings')
                .select(`
                    id,
                    gross_amount,
                    platform_fee,
                    instructor_share,
                    earning_type,
                    created_at,
                    instructor_percentage_snapshot,
                    platform_percentage_snapshot,
                    payment_id,
                    courses (id, title),
                    mentorship_sessions (
                        id, mentorship_type, scheduled_at, end_date, topic
                    )
                `)
                .eq('instructor_id', instructorId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error fetching transaction history:', error);
            return [];
        }
    },

    /**
     * Determine hold status for a transaction row.
     * @param {object} item — a row from getTransactionHistory()
     * @returns {{ held: boolean, clearsAt: Date|null }}
     */
    getHoldInfo: (item) => {
        if (item.earning_type !== 'mentorship' || !item.mentorship_sessions) {
            return { held: false, clearsAt: null };
        }
        const ms = item.mentorship_sessions;
        const now = new Date();
        if (ms.mentorship_type === 'single') {
            const clearsAt = new Date(new Date(ms.scheduled_at).getTime() + 24 * 60 * 60 * 1000);
            return { held: now < clearsAt, clearsAt };
        }
        if (ms.mentorship_type === 'program') {
            const clearsAt = new Date(ms.end_date);
            return { held: now < clearsAt, clearsAt };
        }
        return { held: false, clearsAt: null };
    },

    /**
     * Withdrawal history for the instructor.
     * @param {string} instructorId
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
     * Request a new withdrawal via RPC.
     * @param {number} amount
     * @param {string} payoutMethodId
     */
    requestWithdrawal: async (amount, payoutMethodId) => {
        try {
            const { data, error } = await supabase.rpc('request_withdrawal', {
                p_amount: parseFloat(amount),
                p_payout_method_id: payoutMethodId
            });
            if (error) throw error;
            if (!data.success) throw new Error(data.error || 'Withdrawal request failed');
            return data;
        } catch (error) {
            console.error('Error requesting withdrawal:', error);
            return { success: false, error: error.message };
        }
    }
};
