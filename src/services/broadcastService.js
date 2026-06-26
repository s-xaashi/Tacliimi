/**
 * broadcastService.js
 * ===========================================================
 * NOTE: Notification fan-out is handled server-side.
 * When a broadcast is inserted, the `trg_broadcast_notifications`
 * PostgreSQL trigger fires `fn_broadcast_notifications()` which
 * bulk-inserts one notification row per matching user in a single
 * SQL statement. No client-side looping is required or safe.
 * See: src/db/migrations/20260626_architectural_fixes.sql
 * ===========================================================
 */
import { supabase } from './supabaseClient.js';

export const BroadcastService = {

    /**
     * SuperAdmin sends a system-wide broadcast.
     * Fan-out notifications are handled by the DB trigger — no JS loop needed.
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

        // Log the admin action
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
