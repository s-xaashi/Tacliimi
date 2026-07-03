import { supabase } from './supabaseClient.js';

export const AuthService = {
    /**
     * Register a new instructor account with Email Verification
     */
    async signUpInstructor(email, password, fullName) {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName,
                    role: 'instructor'
                },
                // Redirect user back to the app after clicking verification link
                emailRedirectTo: `${window.location.origin}/src/pages/instructor/instructor-dashboard/index.html`
            }
        });

        if (error) throw error;
        return data; // Usually prompts "Confirmation Email Sent"
    },

    /**
     * Register a new student account with Email Verification
     */
    async signUpStudent(email, password, fullName) {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName,
                    role: 'student'
                },
                // Redirect user back to the app after clicking verification link
                emailRedirectTo: `${window.location.origin}/src/pages/student/student-dashboard/index.html`
            }
        });

        if (error) throw error;
        return data; // Usually prompts "Confirmation Email Sent"
    },

    /**
     * Start Google OAuth Sign-In
     */
    async signInWithGoogle(role = 'student') {
        // Store intended role before redirecting so callback knows what to create
        localStorage.setItem('tacliimi_pending_role', role);

        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${window.location.origin}/src/pages/auth/callback/index.html`
            }
        });

        if (error) throw error;
        return data;
    },

    /**
     * Login existing user (Student/Instructor) or Administrator
     * Supports either email or username for Admins.
     */
    async login(emailOrUsername, password) {
        let email = emailOrUsername;

        // 1. Check if it's a username (no '@' sign)
        if (!emailOrUsername.includes('@')) {
            const { data: adminRecord, error: lookupError } = await supabase
                .from('admin_auth')
                .select('id, backup_email, is_suspended')
                .eq('username', emailOrUsername)
                .maybeSingle();

            if (adminRecord) {
                if (adminRecord.is_suspended) {
                    throw new Error("This administrative account has been suspended.");
                }
                if (adminRecord.backup_email) {
                    email = adminRecord.backup_email;
                } else {
                    email = `${emailOrUsername.toLowerCase()}@tacliimi.com`;
                }
            }
        } else {
            // Also check suspension by email if its an admin
            const { data: adminByEmail } = await supabase
                .from('admin_auth')
                .select('is_suspended')
                .eq('backup_email', emailOrUsername)
                .maybeSingle();
            
            if (adminByEmail && adminByEmail.is_suspended) {
                throw new Error("This administrative account has been suspended.");
            }
        }

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) throw error;

        // Check if admin is suspended
        if (data.session) {
            // Priority 1: Check admin suspension
            const { data: adminAuth } = await supabase
                .from('admin_auth')
                .select('is_suspended')
                .eq('id', data.user.id)
                .maybeSingle();
            
            if (adminAuth?.is_suspended) {
                await supabase.auth.signOut();
                throw new Error('Your administrative access has been suspended. Please contact the system owner.');
            }

            // Priority 2: Check global account status (blocked)
            const { data: profile } = await supabase
                .from('profiles')
                .select('account_status')
                .eq('id', data.user.id)
                .maybeSingle();

            if (profile?.account_status === 'blocked') {
                await supabase.auth.signOut();
                throw new Error('Your account has been blocked by an administrator. Please contact support if you believe this is an error.');
            }
        }

        return data;
    },

    /**
     * Verify a password without logging out the current user.
     * Useful for sensitive actions like "Show Password".
     */
    async verifyPassword(password) {
        const session = await this.getSession();
        if (!session) throw new Error("No active session");

        // Use a secondary supabase instance or a check
        // Simpler: Try to sign in with current email and the provided password
        const { data, error } = await supabase.auth.signInWithPassword({
            email: session.user.email,
            password: password
        });

        if (error) return false;
        return !!data.user;
    },

    /**
     * Logout active session
     */
    async logout() {
        const { error } = await supabase.auth.signOut();
        // Ignore "AuthSessionMissingError" because if they don't have a session, 
        // they are effectively already logged out.
        if (error && error.name !== 'AuthSessionMissingError') throw error;
    },

    /**
     * Get active session
     */
    async getSession() {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session) return null;

        // Extend session with admin role if it exists
        const { data: adminRecord, error: adminError } = await supabase
            .from('admin_auth')
            .select('role, full_name')
            .eq('id', session.user.id)
            .maybeSingle();

        if (adminRecord && !adminError) {
            session.is_admin = true;
            session.admin_role = adminRecord.role;
            session.user.user_metadata.full_name = adminRecord.full_name;
        }

        // Check if user is blocked globally
        const { data: profile } = await supabase
            .from('profiles')
            .select('account_status')
            .eq('id', session.user.id)
            .maybeSingle();

        if (profile?.account_status === 'blocked') {
            await supabase.auth.signOut();
            return null;
        }

        return session;
    },

    /**
     * Get strictly the current Profile record linked to Auth
     */
    async getCurrentProfile() {
        const session = await this.getSession();
        if (!session) return null;

        // Admin Profile Override
        if (session.is_admin) {
            try {
                const { data: adminRecord, error: adminError } = await supabase
                    .from('admin_auth')
                    .select('id, full_name, username, role, phone_number, city, address, avatar_url')
                    .eq('id', session.user.id)
                    .maybeSingle();

                if (adminRecord && !adminError) {
                    return {
                        id: adminRecord.id,
                        full_name: adminRecord.full_name || 'Administrator',
                        username: adminRecord.username,
                        email: session.user.email,
                        role: 'admin',
                        admin_role: adminRecord.role,
                        is_admin: true,
                        phone_number: adminRecord.phone_number,
                        city: adminRecord.city,
                        address: adminRecord.address,
                        avatar_url: adminRecord.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(adminRecord.full_name || 'Admin')}&background=4F46E5&color=fff`
                    };
                }
            } catch (err) {
                console.error("Admin profile fetch error:", err);
            }

            // Fallback
            return {
                id: session.user.id,
                full_name: session.user.user_metadata.full_name || 'Administrator',
                email: session.user.email,
                role: 'admin',
                admin_role: session.admin_role,
                is_admin: true,
                avatar_url: `https://ui-avatars.com/api/?name=${encodeURIComponent(session.user.user_metadata.full_name || 'Admin')}&background=4F46E5&color=fff`
            };
        }

        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', session.user.id)
                .maybeSingle();

            if (error && error.code !== 'PGRST116') {
                // Ignore "Row not found" (PGRST116) as it might legitimately not exist yet
                console.error("Profile fetch error:", error);
            }
            return data || null;
        } catch (err) {
            console.error("Unexpected profile fetch error", err);
            return null;
        }
    },

    /**
     * Update the current admin's profile record in 'admin_auth'
     */
    async updateAdminProfile(updates) {
        const session = await this.getSession();
        if (!session || !session.is_admin) throw new Error("Unauthorized: Admin session required");

        const { data, error } = await supabase
            .from('admin_auth')
            .update(updates)
            .eq('id', session.user.id)
            .select()
            .maybeSingle();

        if (error) throw error;

        // Update audit log
        try {
            await supabase.from('admin_audit_logs').insert({
                admin_id: session.user.id,
                action: 'profile_update',
                entity_type: 'admin_auth',
                entity_id: session.user.id,
                details: { updated_fields: Object.keys(updates) }
            });
        } catch (logErr) {
            console.warn("Failed to create audit log for profile update:", logErr);
        }

        return data;
    },

    /**
     * Update the current user's profile metadata in the 'profiles' table
     */
    async updateProfile(updates) {
        const session = await this.getSession();
        if (!session) throw new Error("No active session");

        const { data, error } = await supabase
            .from('profiles')
            .update(updates)
            .eq('id', session.user.id)
                .select()
                .maybeSingle();

        if (error) throw error;
        return data;
    },

    /**
     * Update the authenticated user's credentials (e.g., password)
     */
    async updatePassword(newPassword) {
        const { data, error } = await supabase.auth.updateUser({
            password: newPassword
        });

        if (error) throw error;
        return data;
    },

    /**
     * Send a password reset email
     */
    async sendPasswordResetEmail(email) {
        const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/src/pages/auth/reset-password/index.html`
        });

        if (error) throw error;
        return data;
    }
};
