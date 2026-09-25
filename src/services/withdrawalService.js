import { supabase } from './supabaseClient.js';

export const WithdrawalService = {

    /**
     * Admin: get all withdrawal requests.
     */
    async getAllWithdrawals() {
        const { data, error } = await supabase
            .from('withdrawal_requests')
            .select('*, profiles!withdrawal_requests_instructor_id_fkey(full_name, avatar_url, email, payout_details)')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    },

    /**
     * Admin: update withdrawal status (approve, mark processing, mark paid)
     */
    async updateWithdrawalStatus(withdrawalId, adminId, status, notes = null) {
        if (!['approved', 'processing', 'paid'].includes(status)) {
            throw new Error(`Invalid status override: ${status}`);
        }

        const now = new Date().toISOString();
        const updateData = {
            status: status,
            processed_by: adminId,
            processed_at: now
        };
        
        if (notes) {
            updateData.notes_to_instructor = notes;
        }

        const { error } = await supabase
            .from('withdrawal_requests')
            .update(updateData)
            .eq('id', withdrawalId);

        if (error) throw error;

        await supabase.from('admin_audit_logs').insert({
            admin_id: adminId,
            action: `mark_withdrawal_${status}`,
            entity_type: 'withdrawal_request',
            entity_id: withdrawalId,
            details: { processed_at: now, notes_to_instructor: notes }
        });
    },

    /**
     * Admin: approve a withdrawal request. (Legacy wrapper)
     */
    async approveWithdrawal(withdrawalId, adminId) {
        return this.updateWithdrawalStatus(withdrawalId, adminId, 'approved');
    },

    /**
     * Admin: reject a withdrawal request.
     */
    async rejectWithdrawal(withdrawalId, adminId, rejectionReason) {
        const now = new Date().toISOString();

        const { error } = await supabase
            .from('withdrawal_requests')
            .update({
                status: 'rejected',
                processed_by: adminId,
                processed_at: now,
                rejection_reason: rejectionReason
            })
            .eq('id', withdrawalId);

        if (error) throw error;

        await supabase.from('admin_audit_logs').insert({
            admin_id: adminId,
            action: 'reject_withdrawal',
            entity_type: 'withdrawal_request',
            entity_id: withdrawalId,
            details: { rejection_reason: rejectionReason, processed_at: now }
        });
    },

    /**
     * Admin: Get withdrawal analytics summary.
     */
    async getWithdrawalSummary() {
        const { data, error } = await supabase
            .from('withdrawal_requests')
            .select('status, amount');

        if (error) throw error;

        const paid = data.filter(w => w.status === 'paid');
        const processing = data.filter(w => w.status === 'processing');
        const approved = data.filter(w => w.status === 'approved');
        const pending = data.filter(w => w.status === 'pending');

        return {
            total: data.length,
            pendingCount: pending.length,
            approvedCount: approved.length,
            processingCount: processing.length,
            paidCount: paid.length,
            pendingTotal: pending.reduce((s, w) => s + (w.amount || 0), 0),
            approvedTotal: approved.reduce((s, w) => s + (w.amount || 0), 0),
            processingTotal: processing.reduce((s, w) => s + (w.amount || 0), 0),
            paidTotal: paid.reduce((s, w) => s + (w.amount || 0), 0)
        };
    }
};
