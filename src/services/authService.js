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
     */
    async login(identifier, password) {
        // 1. Detect if it's an Admin login (username instead of email)
        const isAdminLogin = !identifier.includes('@');

        if (isAdminLogin) {
            const { data, error } = await supabase.rpc('verify_admin_login', {
                p_username: identifier,
                p_password: password
            });

            if (error) throw error;
            
            // Check if data is an array and has at least one result
            if (!data || !Array.isArray(data) || data.length === 0) {
                throw new Error('Invalid administrator credentials.');
            }

            const adminInfo = data[0];

            // Create a pseudo-session for the admin
            const adminSession = {
                user: { 
                    id: adminInfo.out_id, 
                    email: `${adminInfo.out_username}@admin.tacliimi.com`, 
                    user_metadata: { 
                        full_name: adminInfo.out_full_name,
                        role: 'admin',
                        is_admin: true
                    } 
                },
                access_token: `admin-${adminInfo.out_id}-${Date.now()}`,
                expires_at: Math.floor(Date.now() / 1000) + (3600 * 24), // 24 hours
                is_admin: true
            };

            localStorage.setItem('tacliimi_admin_session', JSON.stringify(adminSession));
            return { session: adminSession, user: adminSession.user };
        }

        // 2. Standard Supabase Auth for Students/Instructors
        // Clear any stale admin session first so it doesn't override the standard session
        localStorage.removeItem('tacliimi_admin_session');

        const { data, error } = await supabase.auth.signInWithPassword({
            email: identifier,
            password
        });

        if (error) throw error;

        // Ensure user is verified
        if (!data.session) throw new Error('Please verify your email address to proceed.');

        return data;
    },

    /**
     * Logout active session
     */
    async logout() {
        localStorage.removeItem('tacliimi_admin_session');
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
    },

    /**
     * Get active session
     */
    async getSession() {
        // Check for Admin Session first
        const adminSession = localStorage.getItem('tacliimi_admin_session');
        if (adminSession) {
            try {
                return JSON.parse(adminSession);
            } catch (e) {
                localStorage.removeItem('tacliimi_admin_session');
            }
        }

        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        return data.session;
    },

    /**
     * Get strictly the current Profile record linked to Auth
     */
    async getCurrentProfile() {
        const session = await this.getSession();
        if (!session) return null;

        // Admin Profile Override
        if (session.is_admin) {
            return {
                id: session.user.id,
                full_name: session.user.user_metadata.full_name || 'Administrator',
                email: session.user.email,
                role: 'admin',
                avatar_url: `https://ui-avatars.com/api/?name=${encodeURIComponent(session.user.user_metadata.full_name || 'Admin')}&background=4F46E5&color=fff`
            };
        }

        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', session.user.id)
                .single();

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
     * Update the current user's profile
     */
    async updateProfile(updates) {
        const session = await this.getSession();
        if (!session) throw new Error("No active session");

        const { data, error } = await supabase
            .from('profiles')
            .update(updates)
            .eq('id', session.user.id)
            .select()
            .single();

        if (error) throw error;
        return data;
    }
};
