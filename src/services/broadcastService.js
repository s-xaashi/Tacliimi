import { supabase } from './supabaseClient.js';

export const BroadcastService = {

    /**
     * SuperAdmin sends a system-wide broadcast.
     */
    async sendBroadcast({ title, message, targetAudience = 'all', expiresAt = null, adminId }) {
        const { data, error } = await supabase
            .from('system_broadcasts')
            .insert({
                sent_by: adminId,
                title,
                message,
                target_audience: targetAudience,
                is_active: true,
                expires_at: expiresAt
            })
            .select()
            .single();

        if (error) throw error;

        // Log the action
        await supabase.from('admin_audit_logs').insert({
            admin_id: adminId,
            action: 'send_broadcast',
            entity_type: 'system_broadcast',
            entity_id: data.id,
            details: { target_audience: targetAudience, title }
        });

        return data;
    },

    /**
     * Get all active broadcasts for the current user.
     */
    async getActiveBroadcasts() {
        const { data, error } = await supabase
            .from('system_broadcasts')
            .select('*, admin_auth!system_broadcasts_sent_by_fkey(full_name)')
            .eq('is_active', true)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    },

    /**
     * SuperAdmin: get ALL broadcasts including expired.
     */
    async getAllBroadcasts() {
        const { data, error } = await supabase
            .from('system_broadcasts')
            .select('*, admin_auth!system_broadcasts_sent_by_fkey(full_name)')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    },

    /**
     * SuperAdmin: deactivate a broadcast.
     */
    async deactivateBroadcast(broadcastId) {
        const { error } = await supabase
            .from('system_broadcasts')
            .update({ is_active: false })
            .eq('id', broadcastId);

        if (error) throw error;
    }
};
