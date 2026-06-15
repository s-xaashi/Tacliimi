import { supabase } from './supabaseClient.js';

export const NotificationService = {
    /**
     * Create a notification for a user
     */
    async createNotification(userId, title, message, type, metadata = {}) {
        // Ensure user is authenticated before creating a notification
        // The RLS policy "Anyone can create notifications" requires the 'authenticated' role
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session) {
            console.warn('Skipping notification creation: No active session found. Notifications require an authenticated session.');
            return null;
        }

        const { data, error } = await supabase
            .from('notifications')
            .insert({
                user_id: userId,
                title: title,
                message: message,
                notification_type: type,
                metadata: metadata,
                is_read: false
            })
            .select()
            .single();

        if (error) {
            console.error('Error creating notification:', {
                message: error.message,
                details: error.details,
                hint: error.hint,
                code: error.code,
                context: { userId, title, type }
            });
            return null;
        }
        return data;
    },

    /**
     * Get recent notifications for a user
     */
    async getUserNotifications(userId, limit = 10) {
        const { data, error } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            console.error('Error fetching notifications:', error);
            return [];
        }
        return data || [];
    },

    /**
     * Get unread notification count
     */
    async getUnreadCount(userId) {
        const { count, error } = await supabase
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('is_read', false);

        if (error) {
            console.error('Error getting unread count:', error);
            return 0;
        }
        return count || 0;
    },

    /**
     * Mark a notification as read
     */
    async markAsRead(notificationId) {
        console.trace('NotificationService.markAsRead called', notificationId);
        const { error } = await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('id', notificationId);

        if (error) console.error('Error marking as read:', error);
    },

    /**
     * Mark all as read
     */
    async markAllAsRead(userId) {
        console.trace('NotificationService.markAllAsRead called', userId);
        const { error } = await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('user_id', userId)
            .eq('is_read', false);

        if (error) console.error('Error marking all as read:', error);
    },

    /**
     * Subscribe to new notifications
     */
    subscribeToNotifications(userId, callback) {
        return supabase
            .channel(`notifications:${userId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'notifications',
                    filter: `user_id=eq.${userId}`
                },
                (payload) => {
                    callback(payload.new);
                }
            )
            .subscribe();
    }
};
