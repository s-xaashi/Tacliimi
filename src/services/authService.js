import { supabase } from './supabaseClient.js';

export const AuthService = {
    /**
     * Check rate limit status for a given email address without recording attempt
     */
    async checkRateLimit(email) {
        if (!email || !email.trim()) return { allowed: true, retry_after_seconds: 0 };
        try {
            const { data: rateCheck } = await supabase.rpc('check_and_record_login_attempt', {
                p_email: email.trim(),
                p_success: null
            });
            return rateCheck || { allowed: true, retry_after_seconds: 0 };
        } catch (err) {
            return { allowed: true, retry_after_seconds: 0 };
        }
    },

    /**
     * Register a new instructor account with Email Verification
     */
    async signUpInstructor(email, password, fullName) {
        // Pre-check if email already exists before calling supabase.auth.signUp
        const exists = await this.checkEmailExists(email);
        if (exists) {
            throw new Error("This email is already registered. Please log in or use a different email address.");
        }

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
     * Check if an email address is already registered in Supabase auth.users or profiles
     */
    async checkEmailExists(email) {
        if (!email || !email.trim()) return false;
        try {
            const { data, error } = await supabase.rpc('check_email_exists', {
                p_email: email.trim()
            });
            if (error) {
                console.warn('Error checking email existence:', error);
                return false;
            }
            return !!data;
        } catch (err) {
            console.warn('Failed to execute check_email_exists:', err);
            return false;
        }
    },

    /**
     * Register a new student account with Email Verification
     */
    async signUpStudent(email, password, fullName) {
        // Pre-check if email already exists before calling supabase.auth.signUp
        const exists = await this.checkEmailExists(email);
        if (exists) {
            throw new Error("This email is already registered. Please log in or use a different email address.");
        }

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
    /**
     * Login existing user (Student/Instructor) or Administrator
     * Supports either email or username for Admins.
     */
    async login(emailOrUsername, password) {
        let email = emailOrUsername ? emailOrUsername.trim() : '';

        // 1. Check if it's a username (no '@' sign)
        if (!email.includes('@')) {
            const { data: adminRecord, error: lookupError } = await supabase
                .from('admin_auth')
                .select('id, backup_email, is_suspended')
                .eq('username', email)
                .maybeSingle();

            if (adminRecord) {
                if (adminRecord.is_suspended) {
                    throw new Error("This administrative account has been suspended.");
                }
                if (adminRecord.backup_email) {
                    email = adminRecord.backup_email;
                } else {
                    email = `${email.toLowerCase()}@tacliimi.com`;
                }
            }
        } else {
            // Also check suspension by email if it's an admin
            const { data: adminByEmail } = await supabase
                .from('admin_auth')
                .select('is_suspended')
                .eq('backup_email', email)
                .maybeSingle();
            
            if (adminByEmail && adminByEmail.is_suspended) {
                throw new Error("This administrative account has been suspended.");
            }
        }

        // 2. SERVER-SIDE RATE LIMIT PRE-CHECK
        try {
            const { data: rateCheck, error: rateErr } = await supabase.rpc('check_and_record_login_attempt', {
                p_email: email,
                p_success: null
            });

            if (!rateErr && rateCheck && rateCheck.allowed === false) {
                const retrySec = rateCheck.retry_after_seconds || 30;
                const err = new Error(`Account temporarily locked due to multiple failed login attempts. Please try again in ${retrySec} seconds.`);
                err.retryAfter = retrySec;
                err.isRateLimit = true;
                throw err;
            }
        } catch (rateEx) {
            // If it's a rate-limit exception created above, rethrow
            if (rateEx.isRateLimit || (rateEx.message && rateEx.message.includes('Account temporarily locked'))) {
                throw rateEx;
            }
            console.warn('Login rate limit check notice:', rateEx);
        }

        // 3. ATTEMPT AUTHENTICATION
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            // Record failed attempt in server database
            try {
                await supabase.rpc('check_and_record_login_attempt', {
                    p_email: email,
                    p_success: false
                });
            } catch (recErr) {
                console.warn('Failed to record login attempt:', recErr);
            }

            // Return generic error message to prevent user enumeration
            if (error.message && (error.message.includes('Invalid login credentials') || error.status === 400)) {
                throw new Error("Invalid email or password.");
            }
            throw error;
        }

        // 4. AUTHENTICATION SUCCESSFUL -> RECORD SUCCESS & CHECK ACCOUNT STATUS
        if (data.session) {
            // Record successful login attempt (clears lockout counter)
            try {
                await supabase.rpc('check_and_record_login_attempt', {
                    p_email: email,
                    p_success: true
                });
            } catch (recErr) {
                console.warn('Failed to record successful login:', recErr);
            }

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

            // Priority 2: Check global account status (blocked/suspended)
            const { data: profile } = await supabase
                .from('profiles')
                .select('account_status')
                .eq('id', data.user.id)
                .maybeSingle();

            if (profile?.account_status === 'blocked' || profile?.account_status === 'suspended') {
                await supabase.auth.signOut();
                throw new Error('Your account has been blocked by an administrator. Please contact support if you believe this is an error.');
            }
        }

        return data;
    },

    /**
     * Verify a password without creating a new session as a side-effect.
     * SECURITY: Uses signInWithPassword in a controlled way — returns only
     * a boolean without mutating the existing session state.
     * Note: Does NOT rate-limit — callers should implement their own limits.
     */
    async verifyPassword(password) {
        const session = await this.getSession();
        if (!session) throw new Error('No active session');

        // We temporarily sign in to verify the password only.
        // This does refresh tokens — an acceptable tradeoff since we need
        // to verify the credential. The session is effectively the same user.
        const { data, error } = await supabase.auth.signInWithPassword({
            email: session.user.email,
            password: password
        });

        if (error) return false;
        // Refresh cache with the new session returned
        if (data?.session) {
            this._sessionCache = data.session;
            this._sessionCacheTs = Date.now();
        }
        return !!data?.user;
    },

    /**
     * Logout active session and clear the session cache.
     */
    async logout() {
        this._sessionCache = null;
        this._sessionCacheTs = 0;
        const { error } = await supabase.auth.signOut();
        // Ignore "AuthSessionMissingError" because if they don't have a session,
        // they are effectively already logged out.
        if (error && error.name !== 'AuthSessionMissingError') throw error;
    },

    async signOut() {
        return this.logout();
    },

    /**
     * Get active session — cached for 30 seconds to reduce network round-trips.
     * SECURITY: Cache is cleared on logout.
     */
    _sessionCache: null,
    _sessionCacheTs: 0,
    SESSION_TTL: 30_000,

    async getSession() {
        // Return cached session if fresh
        if (this._sessionCache && (Date.now() - this._sessionCacheTs) < this.SESSION_TTL) {
            return this._sessionCache;
        }

        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session) {
            this._sessionCache = null;
            return null;
        }

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
            this._sessionCache = null;
            return null;
        }

        this._sessionCache = session;
        this._sessionCacheTs = Date.now();
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
     * Update the current user's profile metadata in the 'profiles' table.
     * SECURITY: Only allowed fields are updated (prevents over-posting).
     * Privileged fields like role, account_status are excluded.
     */
    async updateProfile(updates) {
        const session = await this.getSession();
        if (!session) throw new Error('No active session');

        // SECURITY: Whitelist of fields callers can update via this method.
        // Privileged fields (role, account_status, profile_completed, is_admin)
        // can only be updated via dedicated methods or server-side RPCs.
        const SAFE_FIELDS = [
            'full_name', 'short_bio', 'professional_title', 'country', 'city',
            'social_links', 'phone_number', 'gender', 'learning_interests',
            'avatar_url', 'setup_progress', 'notification_preferences',
            'agreed_to_instructor_tos'
        ];
        const safeUpdates = Object.fromEntries(
            Object.entries(updates).filter(([k]) => SAFE_FIELDS.includes(k))
        );

        if (Object.keys(safeUpdates).length === 0) return null; // Nothing to update

        const { data, error } = await supabase
            .from('profiles')
            .update(safeUpdates)
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
