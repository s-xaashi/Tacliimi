import { supabase } from './supabaseClient.js';

const EDGE_FN_URL = 'https://jboruccxbgdqntrggslz.supabase.co/functions/v1/sifalo-checkout';

/**
 * Call the sifalo-checkout Edge Function with the current user's JWT.
 */
async function callEdgeFn(action, payload) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('User is not authenticated.');

  const res = await fetch(EDGE_FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, payload }),
  });

  const data = await res.json();
  if (!res.ok) {
    const error = new Error(data.error || `Edge Function error: ${res.status}`);
    error.details = data.details || null;
    throw error;
  }
  return data;
}

/**
 * Detect user's country via IP geolocation.
 * Returns 'SO' for Somalia, or the ISO country code.
 * Falls back to null on failure (treat as international).
 */
async function detectCountry() {
  try {
    const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    return data.country_code || null;
  } catch {
    return null;
  }
}

export const PaymentService = {

  /**
   * Detect whether the user is in Somalia.
   * Cached for the session to avoid repeated API calls.
   */
  async isSomaliUser() {
    if (PaymentService._countryCache !== undefined) return PaymentService._countryCache;
    const country = await detectCountry();
    PaymentService._countryCache = (country === 'SO');
    return PaymentService._countryCache;
  },
  _countryCache: undefined,

  /**
   * Initiate a course purchase.
   * - Somali users: show e-wallet modal (returns false, modal handles payment)
   * - International: redirect to Sifalo hosted checkout
   * Returns true if redirected (no further action needed), false if modal should be shown.
   */
  async startCoursePayment(courseId, amount, currency = 'USD') {
    const isSomali = await PaymentService.isSomaliUser();
    if (isSomali) return { method: 'ewallet', courseId, amount, currency };
    // International: redirect to hosted checkout
    const result = await callEdgeFn('createCheckout', { type: 'course', referenceId: courseId, amount, currency });
    if (!result.checkout_url) throw new Error('No checkout URL returned from gateway.');
    window.location.href = result.checkout_url;
    return { method: 'redirect' };
  },

  /**
   * Initiate a mentor booking payment.
   * Same geo-detection logic as course payments.
   */
  async startBookingPayment(sessionId, amount, currency = 'USD') {
    const isSomali = await PaymentService.isSomaliUser();
    if (isSomali) return { method: 'ewallet', sessionId, amount, currency };
    const result = await callEdgeFn('createCheckout', { type: 'booking', referenceId: sessionId, amount, currency });
    if (!result.checkout_url) throw new Error('No checkout URL returned from gateway.');
    window.location.href = result.checkout_url;
    return { method: 'redirect' };
  },

  /**
   * Initiate a boost payment (Courses/Mentors).
   */
  async startBoostPayment(entityType, entityId, amount, planDays, currency = 'USD') {
    const isSomali = await PaymentService.isSomaliUser();
    if (isSomali) return { method: 'ewallet', entityType, entityId, amount, planDays, currency };
    const result = await callEdgeFn('createCheckout', { type: 'boost', referenceId: entityId, entityType, planDays, amount, currency });
    if (!result.checkout_url) throw new Error('No checkout URL returned from gateway.');
    window.location.href = result.checkout_url;
    return { method: 'redirect' };
  },

  /**
   * Initiate a banner payment (Courses/Mentors).
   */
  async startBannerPayment(entityType, entityId, amount, planDays, bannerText, currency = 'USD') {
    const isSomali = await PaymentService.isSomaliUser();
    if (isSomali) return { method: 'ewallet', entityType, entityId, amount, planDays, bannerText, currency };
    const result = await callEdgeFn('createCheckout', { type: 'banner', referenceId: entityId, entityType, planDays, bannerText, amount, currency });
    if (!result.checkout_url) throw new Error('No checkout URL returned from gateway.');
    window.location.href = result.checkout_url;
    return { method: 'redirect' };
  },

  /**
   * Process a direct e-wallet payment (Somali users).
   * No redirect — result is returned immediately.
   */
  async createDirectPayment({ type, referenceId, amount, currency = 'USD', gateway, account, entityType, planDays, bannerText }) {
    return callEdgeFn('createDirectPayment', { type, referenceId, amount, currency, gateway, account, entityType, planDays, bannerText });
  },

  /**
   * Legacy methods (still used by booking.js)
   */
  async createCourseCheckout(courseId, amount, currency = 'USD') {
    const result = await callEdgeFn('createCheckout', { type: 'course', referenceId: courseId, amount, currency });
    if (!result.checkout_url) throw new Error('No checkout URL returned from gateway.');
    window.location.href = result.checkout_url;
  },

  async createBookingCheckout(sessionId, amount, currency = 'USD') {
    const result = await callEdgeFn('createCheckout', { type: 'booking', referenceId: sessionId, amount, currency });
    if (!result.checkout_url) throw new Error('No checkout URL returned from gateway.');
    window.location.href = result.checkout_url;
  },

  /**
   * Verify a payment after Sifalo redirects back (hosted checkout only).
   */
  async verifyTransaction(orderId, sid) {
    return callEdgeFn('verifyTransaction', { orderId, sid });
  },
};
