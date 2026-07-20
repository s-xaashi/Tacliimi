import { supabase } from './supabaseClient.js';

export const RefundService = {

    /**
     * Student submits a refund request.
     * Accepts either:
     *  - ticketId  (Help Center ticket — no payment UUID needed)
     *  - paymentId (direct payment refund)
     */
    async submitRefundRequest({ paymentId, ticketId, amount, reason, requestType = 'general_refund' }) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        // Duplicate guard — key by whichever reference exists
        if (ticketId) {
            const { data: existing } = await supabase
                .from('refund_requests')
                .select('id')
                .eq('support_ticket_id', ticketId)
                .eq('status', 'pending')
                .maybeSingle();
            if (existing) throw new Error('A refund request for this ticket is already pending review.');
        } else if (paymentId) {
            const { data: existing } = await supabase
                .from('refund_requests')
                .select('id')
                .eq('payment_id', paymentId)
                .eq('status', 'pending')
                .maybeSingle();
            if (existing) throw new Error('A refund request for this payment is already pending review.');
        }

        const { data, error } = await supabase
            .from('refund_requests')
            .insert({
                payment_id: paymentId || null,
                support_ticket_id: ticketId || null,
                student_id: user.id,
                amount,
                reason,
                request_type: requestType,
                status: 'pending'
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') throw new Error('A refund request already exists.');
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
     * Admin: get all refund requests with student info and linked support ticket.
     */
    async getAllRefunds() {
        const { data, error } = await supabase
            .from('refund_requests')
            .select(`
                *,
                student_id,
                profiles!refund_requests_student_id_fkey(full_name, avatar_url, email),
                payments(amount, course_id, mentorship_id, payment_status),
                support_tickets!refund_requests_support_ticket_id_fkey(id, entity_id, description)
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    },

    /**
     * Admin: approve a refund request.
     * Only marks the payment as refunded if a real payment_id exists.
     * Ticket-originated refunds have no payment record — the refund_requests.status is the audit trail.
     */
    async approveRefund(refundId, adminId, adminNotes = '') {
        const now = new Date().toISOString();

        const { data: refund, error: fetchErr } = await supabase
            .from('refund_requests')
            .select('payment_id')
            .eq('id', refundId)
            .single();

        if (fetchErr) throw fetchErr;

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

        // Only update payment record if a real payment_id exists
        if (refund.payment_id) {
            await supabase
                .from('payments')
                .update({ payment_status: 'refunded' })
                .eq('id', refund.payment_id);
        }

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
