import { uploadPrivateImage, deletePrivateImage, invalidatePrivateImageCache, cleanupPrivateImages } from './r2ImageUpload.js';
import { supabase } from './supabaseClient.js';
import { AuthService } from './authService.js';
import { PayoutService } from './payoutService.js';

// File validation constants
const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB

export const ProfileService = {
    /**
     * Get the completely structured profile including teaching and payout data
     */
    async getFullProfile(userId) {
        // Helper: safely parse a JSON string field
        const safeJson = (raw, fallback = []) => {
            if (!raw) return fallback;
            if (Array.isArray(raw)) return raw; // already parsed
            try { return JSON.parse(raw); } catch { return fallback; }
        };

        // 1. Base Profile
        const { data: profile, error: pErr } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .maybeSingle();

        if (pErr && pErr.code !== 'PGRST116') throw pErr;
        if (!profile) return null;

        // 2. Teaching Profile
        const { data: teachingProfile } = await supabase
            .from('teaching_profiles')
            .select('*')
            .eq('instructor_id', userId)
            .maybeSingle();

        // 3. Expertise (deduplicated by name, case-insensitive)
        const { data: expertise } = await supabase
            .from('expertise_areas')
            .select('expertise_name')
            .eq('instructor_id', userId);

        const seenExp = new Set();
        const expertiseList = (expertise || []).reduce((acc, e) => {
            const key = (e.expertise_name || '').toLowerCase();
            if (key && !seenExp.has(key)) { seenExp.add(key); acc.push(e.expertise_name); }
            return acc;
        }, []);

        // 4. Payout
        const payoutMethod = await PayoutService.getMyPayoutMethod(userId);

        return {
            ...profile,
            teaching_experience: teachingProfile?.teaching_experience || "",
            experience: teachingProfile?.teaching_experience || "",
            // R2 video fields (new
            introVideoStorageKey: teachingProfile?.introduction_video_storage_key || "",
            introVideoProvider: teachingProfile?.introduction_video_provider || "supabase",
            // Legacy Supabase URL (backwards-compat)
            introVideo: teachingProfile?.introduction_video_url || "",
            mentorship_style: teachingProfile?.mentorship_style || "",
            education_list: safeJson(teachingProfile?.educational_background),
            language_list: safeJson(teachingProfile?.languages_spoken),
            expertise_list: expertiseList,
            payout_method: payoutMethod ? (payoutMethod.method_type === 'cash_on_delivery' ? 'Cash on Delivery' : 'Mobile Money') : null,
            payout_details: payoutMethod ? {
                provider: payoutMethod.provider_name,
                mm_phone: payoutMethod.phone_mobile_money,
                cod_phone: payoutMethod.phone_cash_on_delivery,
                address: payoutMethod.address,
                city: payoutMethod.city,
                country: payoutMethod.country
            } : {}
        };
    },

    /**
     * Updates the main instructor profiles table.
     * SECURITY: userId is sourced from the authenticated session — not from caller.
     */
    async updatePersonalInfo(profileData) {
        const session = await AuthService.getSession();
        if (!session) throw new Error('Unauthorized: No active session');

        const { data, error } = await supabase
            .from('profiles')
            .update({
                full_name: profileData.full_name,
                professional_title: profileData.professional_title,
                short_bio: profileData.short_bio,
                social_links: profileData.social_links,
                country: profileData.country,
                city: profileData.city,
                updated_at: new Date()
            })
            .eq('id', session.user.id)
            .select()
            .maybeSingle();

        if (error) throw error;
        return data;
    },

    /**
     * Upserts teaching profile data.
     * SECURITY: userId is sourced from the authenticated session — not from caller.
     */
    async saveTeachingProfile(teachingData, expertiseList) {
        const session = await AuthService.getSession();
        if (!session) throw new Error('Unauthorized: No active session');
        const userId = session.user.id;
        // 1. Save Teaching Profile row
        // Build the upsert payload — include R2 fields when present
        const teachingUpsert = {
            instructor_id: userId,
            teaching_experience: teachingData.experience || '',
            mentorship_style: teachingData.mentorship_style || null,
            educational_background: teachingData.education || '[]',
            languages_spoken: teachingData.languages || '[]'
        };

        // Query current storage key to clean up old R2 file if being replaced
        const { data: currentTeachingProfile } = await supabase
            .from('teaching_profiles')
            .select('introduction_video_storage_key')
            .eq('instructor_id', userId)
            .maybeSingle();

        const previousStorageKey = currentTeachingProfile?.introduction_video_storage_key;

        if (teachingData.introVideoStorageKey) {
            // New R2 upload: persist the object key and provider, clear the old Supabase URL
            teachingUpsert.introduction_video_storage_key = teachingData.introVideoStorageKey;
            teachingUpsert.introduction_video_provider = 'r2';
            teachingUpsert.introduction_video_url = ''; // clear legacy
        } else if (teachingData.introVideo !== undefined) {
            // Legacy Supabase URL path (or explicit clear)
            teachingUpsert.introduction_video_url = teachingData.introVideo || '';
            if (!teachingData.introVideo) {
                // Clearing video entirely
                teachingUpsert.introduction_video_storage_key = null;
                teachingUpsert.introduction_video_provider = 'supabase';
            }
        }

        const { error: teachingErr } = await supabase
            .from('teaching_profiles')
            .upsert(teachingUpsert, { onConflict: 'instructor_id' });

        if (teachingErr) throw teachingErr;

        // If replacing an existing R2 video with a new one, delete the old video from R2 storage
        if (previousStorageKey && teachingData.introVideoStorageKey && previousStorageKey !== teachingData.introVideoStorageKey) {
            this.deleteProfileVideoFromR2(previousStorageKey).catch(err => {
                console.warn('Failed to delete old R2 intro video object:', err);
            });
        }

        // Sync video to mentorship_profiles (non-blocking)
        if (teachingData.introVideoStorageKey) {
            // R2 case: store the storage key, not a URL
            await supabase
                .from('mentorship_profiles')
                .update({
                    introduction_video_url: '',
                    introduction_video_storage_key: teachingData.introVideoStorageKey
                })
                .eq('instructor_id', userId);
        } else if (teachingData.introVideo) {
            // Legacy case: store URL as before
            await supabase
                .from('mentorship_profiles')
                .update({ introduction_video_url: teachingData.introVideo })
                .eq('instructor_id', userId);
        }

        // 2. Deduplicate incoming expertise list before processing
        const uniqueExpertise = [...new Set(
            (expertiseList || []).map(e => e.trim()).filter(Boolean)
        )];

        // 3. Clear old expertise and insert fresh set
        await supabase.from('expertise_areas').delete().eq('instructor_id', userId);

        if (uniqueExpertise.length > 0) {
            // Resolve names against mentor_categories
            const { data: allCats } = await supabase
                .from('mentor_categories')
                .select('id, name, slug');

            const catMap = {};
            (allCats || []).forEach(c => { catMap[c.name.toLowerCase()] = c; });

            const expertisePayload = [];
            for (const expert of uniqueExpertise) {
                const searchKey = expert.toLowerCase();
                let catEntry = catMap[searchKey];

                // Auto-create a new category if not found
                if (!catEntry) {
                    const newSlug = searchKey.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                    // Check if a slug collision exists first
                    const { data: existingCat } = await supabase
                        .from('mentor_categories')
                        .select('id, name')
                        .ilike('name', expert)
                        .maybeSingle();

                    if (existingCat) {
                        catEntry = existingCat;
                        catMap[searchKey] = existingCat;
                    } else {
                        const { data: newCat, error: catErr } = await supabase
                            .from('mentor_categories')
                            .insert([{ name: expert, slug: newSlug, domain_name: 'General' }])
                            .select()
                            .single();
                        if (!catErr && newCat) {
                            catEntry = newCat;
                            catMap[searchKey] = newCat;
                        } else {
                            console.warn('[ProfileService] Could not create category for:', expert, catErr?.message);
                        }
                    }
                }

                if (catEntry) {
                    expertisePayload.push({
                        instructor_id: userId,
                        expertise_name: catEntry.name,
                        mentor_category_id: catEntry.id
                    });
                }
            }

            if (expertisePayload.length > 0) {
                const { error: expertErr } = await supabase
                    .from('expertise_areas')
                    .insert(expertisePayload);
                if (expertErr) {
                    console.error('[ProfileService] Failed to insert expertise_areas:', expertErr);
                    throw expertErr;
                }
            }
        }

        return true;
    },

    /**
     * Mark onboarding as complete to drop dashboard locks.
     * SECURITY: userId is sourced from the authenticated session — not from caller.
     */
    async markProfileCompleted() {
        const session = await AuthService.getSession();
        if (!session) throw new Error('Unauthorized: No active session');

        const { data, error } = await supabase
            .from('profiles')
            .update({ profile_completed: true, updated_at: new Date() })
            .eq('id', session.user.id)
            .select()
            .maybeSingle();

        if (error) throw error;
        return data;
    },

    /**
     * Upload Avatar to Storage and update Profile.
     * SECURITY: userId from session. File type and size validated before upload.
     */
    async uploadAvatar(fileObject) {
        const session = await AuthService.getSession();
        if (!session) throw new Error('Unauthorized: No active session');
        const userId = session.user.id;

        // SECURITY: Validate file type and size
        if (!ALLOWED_AVATAR_TYPES.includes(fileObject.type)) {
            throw new Error('Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.');
        }
        if (fileObject.size > MAX_AVATAR_BYTES) {
            throw new Error('File too large. Maximum avatar size is 5MB.');
        }

        const { data: previousProfile, error: previousError } = await supabase
            .from('profiles').select('avatar_storage_key').eq('id', userId).maybeSingle();
        if (previousError) throw previousError;

        const avatarObjectKey = await uploadPrivateImage({ file: fileObject, purpose: 'avatar' });
        const { data, error } = await supabase
            .from('profiles')
            .update({ avatar_storage_key: avatarObjectKey, updated_at: new Date() })
            .eq('id', userId)
            .select()
            .maybeSingle();

        if (error || !data) {
            try { await deletePrivateImage({ resourceType: 'avatar', resourceId: userId, objectKey: avatarObjectKey }); }
            catch (cleanupError) { console.warn('Could not clean up uncommitted avatar upload.', cleanupError); }
            if (error) throw error;
            throw new Error('Profile was not updated.');
        }

        invalidatePrivateImageCache({ resourceType: 'avatar', resourceId: userId });
        const previousKey = previousProfile?.avatar_storage_key;
        if (previousKey && previousKey !== avatarObjectKey) {
            try { await deletePrivateImage({ resourceType: 'avatar', resourceId: userId, objectKey: previousKey }); }
            catch (cleanupError) { console.warn('Could not clean up replaced avatar.', cleanupError); }
        }
        try { await cleanupPrivateImages(); }
        catch (cleanupError) { console.warn('Could not sweep abandoned private images.', cleanupError); }
        return data;

    },

    async removeAvatar() {
        const session = await AuthService.getSession();
        if (!session?.user?.id) throw new Error('Unauthorized: No active session');
        const userId = session.user.id;
        const { data: profile, error: readError } = await supabase
            .from('profiles').select('avatar_storage_key').eq('id', userId).maybeSingle();
        if (readError) throw readError;

        const { error } = await supabase.from('profiles')
            .update({ avatar_url: null, avatar_storage_key: null, updated_at: new Date() })
            .eq('id', userId);
        if (error) throw error;

        invalidatePrivateImageCache({ resourceType: 'avatar', resourceId: userId });
        if (profile?.avatar_storage_key) {
            try { await deletePrivateImage({ resourceType: 'avatar', resourceId: userId, objectKey: profile.avatar_storage_key }); }
            catch (cleanupError) { console.warn('Could not clean up removed avatar.', cleanupError); }
        }
        return true;
    },

    /**
     * Upload Intro Video to Cloudflare R2 via multipart upload.
     *
     * Mirrors CourseService.uploadToR2 — includes:
     *   - Chunked multipart upload (16 MB parts, 4 concurrent workers)
     *   - Exponential-backoff retry per part (up to 3 retries)
     *   - Live progress callbacks (0–100)
     *   - AbortSignal support (cancel mid-upload triggers R2 abort cleanup)
     *
     * SECURITY: userId from session. File type and size validated server-side
     * in r2-profile-video-create. Object key is scoped to `instructors/{userId}/intro/`.
     *
     * NOTE: Does NOT write to DB. Caller must pass objectKey to saveTeachingProfile
     *       only after the user explicitly saves — preventing junk saves on cancel.
     *
     * @param {File} fileObject
     * @param {(percent: number) => void} onProgress
     * @param {AbortSignal} signal
     * @returns {Promise<{ objectKey: string }>}
     */
    async uploadIntroVideoToR2(fileObject, onProgress, signal) {
        const session = await AuthService.getSession();
        if (!session) throw new Error('Unauthorized: No active session');

        // Client-side pre-flight validation (server validates too)
        if (!ALLOWED_VIDEO_TYPES.includes(fileObject.type)) {
            throw new Error('Invalid video type. Only MP4, WebM and MOV are allowed.');
        }
        if (fileObject.size > MAX_VIDEO_BYTES) {
            throw new Error('Video file too large. Maximum size is 200MB.');
        }

        // Pre-notify progress so progress bar appears immediately
        if (onProgress) onProgress(1);

        // ── 1. Create multipart upload ──────────────────────────────────────
        const createRes = await supabase.functions.invoke('r2-profile-video-create', {
            body: { content_type: fileObject.type, file_size: fileObject.size }
        });
        if (createRes.error) throw new Error(`Init upload failed: ${createRes.error.message}`);

        const { uploadId, objectKey, partCount, partSize } = createRes.data;

        // ── 2. Upload parts (concurrent workers + retry) ─────────────────────
        const MAX_RETRIES = 3;
        const CONCURRENCY = 4;
        const parts = [];
        let totalUploadedBytes = 0;

        const delay = (ms) => new Promise(res => setTimeout(res, ms));

        const uploadPart = async (partNumber) => {
            const start = (partNumber - 1) * partSize;
            const end   = Math.min(partNumber * partSize, fileObject.size);
            const chunk = fileObject.slice(start, end);
            let attempt = 0;

            while (attempt <= MAX_RETRIES) {
                if (signal && signal.aborted) throw new Error('Upload cancelled');

                try {
                    // Get presigned URL for this part
                    const preRes = await supabase.functions.invoke('r2-profile-video-presign', {
                        body: { upload_id: uploadId, object_key: objectKey, part_numbers: [partNumber] }
                    });
                    if (preRes.error) throw new Error(`Presign failed: ${preRes.error.message}`);
                    const presignedUrl = preRes.data.presignedUrls[0].url;

                    // Upload chunk via XHR for progress events
                    const result = await new Promise((resolve, reject) => {
                        const xhr = new XMLHttpRequest();
                        xhr.open('PUT', presignedUrl, true);

                        const handleAbort = () => { xhr.abort(); reject(new Error('Upload cancelled')); };
                        if (signal) signal.addEventListener('abort', handleAbort);

                        let currentLoaded = 0;
                        xhr.upload.onprogress = (e) => {
                            if (e.lengthComputable && onProgress) {
                                const delta = e.loaded - currentLoaded;
                                currentLoaded = e.loaded;
                                totalUploadedBytes += delta;
                                onProgress(Math.min((totalUploadedBytes / fileObject.size) * 100, 99.9));
                            }
                        };
                        xhr.onload = () => {
                            if (signal) signal.removeEventListener('abort', handleAbort);
                            if (xhr.status >= 200 && xhr.status < 300) {
                                const etag = xhr.getResponseHeader('ETag') || xhr.getResponseHeader('etag');
                                if (!etag) {
                                    reject(new Error('R2 did not expose the uploaded part ETag. Check the bucket CORS ExposeHeaders configuration.'));
                                    return;
                                }
                                resolve({ PartNumber: partNumber, ETag: etag });
                            } else {
                                reject(new Error(`Chunk upload failed: ${xhr.statusText}`));
                            }
                        };
                        xhr.onerror = () => {
                            if (signal) signal.removeEventListener('abort', handleAbort);
                            reject(new Error('Network error during chunk upload'));
                        };
                        xhr.send(chunk);
                    });

                    return result;
                } catch (err) {
                    attempt++;
                    if (attempt > MAX_RETRIES) throw err;
                    await delay(Math.pow(2, attempt) * 1000);
                }
            }
        };

        // Pool-based concurrency
        let currentIndex = 1;
        let hasError = false;
        let globalError = null;

        const worker = async () => {
            while (currentIndex <= partCount && !hasError) {
                if (signal && signal.aborted) {
                    hasError = true;
                    globalError = new Error('Upload cancelled');
                    return;
                }
                const partNumber = currentIndex++;
                try {
                    const result = await uploadPart(partNumber);
                    parts.push(result);
                } catch (err) {
                    hasError = true;
                    globalError = err;
                }
            }
        };

        try {
            await Promise.all(Array(Math.min(CONCURRENCY, partCount)).fill(null).map(() => worker()));
            if (hasError) throw globalError;

            // ── 3. Complete the multipart upload ────────────────────────────
            const completeRes = await supabase.functions.invoke('r2-profile-video-complete', {
                body: { upload_id: uploadId, object_key: objectKey, parts }
            });
            if (completeRes.error) throw new Error(`Completion failed: ${completeRes.error.message}`);

            if (onProgress) onProgress(100);
            return { objectKey, uploadId };

        } catch (err) {
            // Gracefully abort the multipart upload to avoid orphaned R2 parts
            await supabase.functions.invoke('r2-profile-video-abort', {
                body: { upload_id: uploadId, object_key: objectKey }
            }).catch(() => {}); // best-effort
            throw err;
        }
    },

    /**
     * Discard a completed-but-not-yet-saved R2 upload (cancel after complete / mid-upload mid-way).
     * Non-critical: if abort fails the cleanup worker handles it eventually.
     */
    async discardProfileVideoUpload(objectKey, uploadId = null) {
        if (!objectKey) return;
        if (uploadId) {
            await supabase.functions.invoke('r2-profile-video-abort', {
                body: { upload_id: uploadId, object_key: objectKey }
            }).catch(() => {});
        }
        await this.deleteProfileVideoFromR2(objectKey).catch(() => {});
    },

    /**
     * Delete an instructor introduction video object from Cloudflare R2.
     */
    async deleteProfileVideoFromR2(objectKey) {
        if (!objectKey) return;
        const session = await AuthService.getSession();
        if (!session) return;

        await supabase.functions.invoke('r2-profile-video-delete', {
            body: { object_key: objectKey }
        }).catch(() => {});
    },

    /**
     * Get a short-lived (1-hour) signed playback URL for an R2 profile intro video.
     * SECURITY: server verifies the object key belongs to the authenticated user.
     */
    async getIntroVideoPlaybackUrl(objectKey) {
        if (!objectKey) return null;
        const { data, error } = await supabase.functions.invoke('r2-profile-video-playback', {
            body: { object_key: objectKey }
        });
        if (error) throw error;
        return data?.playbackUrl || null;
    }
};
