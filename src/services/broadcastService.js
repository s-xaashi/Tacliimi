import { supabase } from './supabaseClient.js';

/**
 * BroadcastService
 * Manages system-wide announcements for students, instructors, and admins.
 */
export const BroadcastService = {
    /**
     * Fetch all active broadcasts for the current user's role
     */
    async getActiveBroadcasts() {
        const { data, error } = await supabase
            .from('system_broadcasts')
            .select('*')
            .eq('is_active', true)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching active broadcasts:', error);
            return [];
        }
        return data || [];
    },

    /**
     * Fetch all broadcasts (Admin Only)
     */
    async getAllBroadcasts() {
        const { data, error } = await supabase
            .from('system_broadcasts')
            .select(`
                *,
                admin_auth!system_broadcasts_admin_id_fkey (
                    full_name,
                    role
                )
            `)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching all broadcasts:', error);
            throw error;
        }
        return data || [];
    },

    /**
     * Send a new broadcast (Admin Only)
     */
    async sendBroadcast({ title, message, targetAudience, adminId }) {
        const { data, error } = await supabase
            .from('system_broadcasts')
            .insert({
                title,
                message,
                target_audience: targetAudience,
                admin_id: adminId,
                is_active: true
            })
            .select()
            .single();

        if (error) {
            console.error('Error sending broadcast:', error);
            throw error;
        }

        // Create audit log
        try {
            await supabase.from('admin_audit_logs').insert({
                admin_id: adminId,
                action: 'send_broadcast',
                entity_type: 'system_broadcasts',
                entity_id: data.id,
                details: { title, target_audience: targetAudience }
            });
        } catch (logErr) {
            console.warn('Failed to log broadcast action:', logErr);
        }

        return data;
    },

    /**
     * Deactivate a broadcast (Admin Only)
     */
    async deactivateBroadcast(id) {
        const { error } = await supabase
            .from('system_broadcasts')
            .update({ is_active: false })
            .eq('id', id);

        if (error) {
            console.error('Error deactivating broadcast:', error);
            throw error;
        }
    }
};
