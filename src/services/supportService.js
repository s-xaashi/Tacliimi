import { supabase } from './supabaseClient.js';

export const SupportService = {

    /**
     * Student creates a new support ticket.
     * @param {object} ticketData - { category, entityId, entityType, subject, description, refundRequested }
     * @param {string[]} attachmentPaths - Storage paths (not URLs) returned by uploadScreenshot
     */
    async createTicket(ticketData, attachmentPaths = []) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const { data: ticket, error } = await supabase
            .from('support_tickets')
            .insert({
                student_id: user.id,
                category: ticketData.category,
                entity_id: ticketData.entityId || null,
                entity_type: ticketData.entityType || null,
                subject: ticketData.subject || null,
                description: ticketData.description,
                refund_requested: ticketData.refundRequested || false
            })
            .select()
            .single();

        if (error) throw error;

        // Attach screenshots — store storage PATH (not a public URL; bucket is private)
        if (attachmentPaths.length > 0) {
            const attachments = attachmentPaths.map(path => ({
                ticket_id: ticket.id,
                file_url: path,
                file_name: path.split('/').pop()
            }));
            const { error: attErr } = await supabase
                .from('support_ticket_attachments')
                .insert(attachments);
            if (attErr) console.warn('Attachment save warning:', attErr.message);
        }

        return ticket;
    },

    /**
     * Get all tickets for the current student.
     */
    async getMyTickets() {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const { data, error } = await supabase
            .from('support_tickets')
            .select('*, support_ticket_attachments(*)')
            .eq('student_id', user.id)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    },

    /**
     * Admin: get tickets filtered by categories.
     * Joins student profile, attachments, and any linked refund request.
     */
    async getTicketsByCategory(categories) {
        const { data, error } = await supabase
            .from('support_tickets')
            .select(`
                *,
                profiles!support_tickets_student_id_fkey(full_name, avatar_url),
                support_ticket_attachments(*),
                refund_requests!refund_requests_support_ticket_id_fkey(id, status, amount)
            `)
            .in('category', categories)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    },

    /**
     * Admin (SuperAdmin): get ALL tickets across all categories.
     */
    async getAllTickets() {
        const { data, error } = await supabase
            .from('support_tickets')
            .select(`
                *,
                profiles!support_tickets_student_id_fkey(full_name, avatar_url),
                support_ticket_attachments(*),
                refund_requests!refund_requests_support_ticket_id_fkey(id, status, amount)
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    },

    /**
     * Admin: update ticket status.
     */
    async updateTicketStatus(ticketId, status, assignedTo) {
        const updates = { status, updated_at: new Date().toISOString() };
        if (assignedTo) updates.assigned_to = assignedTo;

        const { error } = await supabase
            .from('support_tickets')
            .update(updates)
            .eq('id', ticketId);

        if (error) throw error;
    },

    /**
     * Upload a screenshot to the private support-attachments bucket.
     * Returns the raw STORAGE PATH — NOT a public URL.
     * Use getSignedUrl() when you need to display it.
     * THROWS on failure so callers can surface the error.
     */
    async uploadScreenshot(file, ticketId) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const fileName = `${user.id}/${ticketId}/${Date.now()}_${file.name}`;
        const { data, error } = await supabase.storage
            .from('support-attachments')
            .upload(fileName, file, { upsert: true });

        if (error) {
            throw new Error(`Screenshot upload failed: ${error.message}`);
        }

        return data.path;
    },

    /**
     * Generate a short-lived signed URL for a private storage path.
     * @param {string} path - Storage path returned by uploadScreenshot
     * @param {number} expiresIn - Seconds until expiry (default 1 hour)
     */
    async getSignedUrl(path, expiresIn = 3600) {
        const { data, error } = await supabase.storage
            .from('support-attachments')
            .createSignedUrl(path, expiresIn);
        if (error) {
            console.warn('Could not sign URL for attachment:', error.message);
            return null;
        }
        return data.signedUrl;
    }
};
