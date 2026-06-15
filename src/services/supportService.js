import { supabase } from './supabaseClient.js';

export const SupportService = {

    /**
     * Student creates a new support ticket.
     * @param {object} ticketData - { category, entityId, entityType, subject, description, refundRequested }
     * @param {string[]} attachmentUrls - Optional screenshot URLs
     */
    async createTicket(ticketData, attachmentUrls = []) {
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

        // Attach screenshots
        if (attachmentUrls.length > 0) {
            const attachments = attachmentUrls.map(url => ({
                ticket_id: ticket.id,
                file_url: url,
                file_name: url.split('/').pop()
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
     * @param {string[]} categories - e.g. ['course','mentor']
     */
    async getTicketsByCategory(categories) {
        const { data, error } = await supabase
            .from('support_tickets')
            .select('*, profiles!support_tickets_student_id_fkey(full_name, avatar_url), support_ticket_attachments(*)')
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
            .select('*, profiles!support_tickets_student_id_fkey(full_name, avatar_url), support_ticket_attachments(*)')
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
     * Upload a screenshot to Supabase Storage (returns public URL).
     * Falls back to returning a placeholder if storage bucket not configured.
     */
    async uploadScreenshot(file, ticketId) {
        const fileName = `${ticketId}/${Date.now()}_${file.name}`;
        const { data, error } = await supabase.storage
            .from('support-attachments')
            .upload(fileName, file, { upsert: true });

        if (error) {
            console.warn('Storage upload failed, using data URL fallback:', error.message);
            return null;
        }

        const { data: publicData } = supabase.storage
            .from('support-attachments')
            .getPublicUrl(fileName);

        return publicData.publicUrl;
    }
};
