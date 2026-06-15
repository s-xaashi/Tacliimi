import { supabase } from './supabaseClient.js';

export const RefundService = {

    /**
     * Student submits a refund request.
     * Checks for existing pending refund for same payment (duplicate guard).
     */
    async submitRefundRequest({ paymentId, amount, reason, requestType = 'course_refund' }) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        // Check for existing pending refund
        const { data: existing } = await supabase
            .from('refund_requests')
            .select('id')
            .eq('payment_id', paymentId)
            .eq('status', 'pending')
            .maybeSingle();

        if (existing) {
            throw new Error('A refund request for this payment is already pending review.');
        }

        const { data, error } = await supabase
            .from('refund_requests')
            .insert({
                payment_id: paymentId,
                student_id: user.id,
                amount,
                reason,
                request_type: requestType,
                status: 'pending'
            })
            .select()
            .single();

        if (error) {
            // Unique index violation = duplicate
            if (error.code === '23505') {
                throw new Error('A refund request for this payment is already pending.');
            }
            throw error;
        }

        return data;
    },

    /**
     * Student views their own refund requests.
     */
    async getMyRefunds() {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const { data, error } = await supabase
            .from('refund_requests')
            .select('*, payments(amount, course_id, mentorship_id)')
            .eq('student_id', user.id)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    },

    /**
     * Admin: get all refund requests with student info.
     */
    async getAllRefunds() {
        const { data, error } = await supabase
            .from('refund_requests')
            .select('*, profiles!refund_requests_student_id_fkey(full_name, avatar_url, email), payments(amount, course_id, mentorship_id, payment_status)')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    },

    /**
     * Admin: approve a refund request. Also updates payment status to 'refunded'.
     */
    async approveRefund(refundId, adminId, adminNotes = '') {
        const now = new Date().toISOString();

        // Fetch refund to get payment_id
        const { data: refund, error: fetchErr } = await supabase
            .from('refund_requests')
            .select('payment_id')
            .eq('id', refundId)
            .single();

        if (fetchErr) throw fetchErr;

        // Update refund status
        const { error } = await supabase
            .from('refund_requests')
            .update({
                status: 'approved',
                processed_by: adminId,
                processed_at: now,
                admin_notes: adminNotes
            })
            .eq('id', refundId);

        if (error) throw error;

        // Update payment status to refunded
        await supabase
            .from('payments')
            .update({ payment_status: 'refunded' })
            .eq('id', refund.payment_id);

        // Write audit log
        await supabase.from('admin_audit_logs').insert({
            admin_id: adminId,
            action: 'approve_refund',
            entity_type: 'refund_request',
            entity_id: refundId,
            details: { admin_notes: adminNotes, processed_at: now }
        });
    },

    /**
     * Admin: reject a refund request.
     */
    async rejectRefund(refundId, adminId, rejectionReason) {
        const now = new Date().toISOString();

        const { error } = await supabase
            .from('refund_requests')
            .update({
                status: 'rejected',
                processed_by: adminId,
                processed_at: now,
                rejection_reason: rejectionReason
            })
            .eq('id', refundId);

        if (error) throw error;

        // Write audit log
        await supabase.from('admin_audit_logs').insert({
            admin_id: adminId,
            action: 'reject_refund',
            entity_type: 'refund_request',
            entity_id: refundId,
            details: { rejection_reason: rejectionReason, processed_at: now }
        });
    },

    /**
     * Admin: Get refund analytics summary.
     */
    async getRefundSummary() {
        const { data, error } = await supabase
            .from('refund_requests')
            .select('status, amount');

        if (error) throw error;

        const approved = data.filter(r => r.status === 'approved');
        const rejected = data.filter(r => r.status === 'rejected');
        const pending = data.filter(r => r.status === 'pending');

        return {
            total: data.length,
            approvedCount: approved.length,
            rejectedCount: rejected.length,
            pendingCount: pending.length,
            approvedTotal: approved.reduce((s, r) => s + (r.amount || 0), 0),
            successRate: data.length > 0 
                ? Math.round((approved.length / (approved.length + rejected.length || 1)) * 100) 
                : 0
        };
    }
};
