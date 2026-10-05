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
   * Initiate a certificate payment using the existing Sifalo checkout.
   * The server is authoritative for the configured certificate price.
   */
  async startCertificatePayment(courseId, currency = 'USD') {
    const result = await callEdgeFn('createCheckout', {
      type: 'certificate',
      referenceId: courseId,
      currency
    });
    if (result.already_paid) return { method: 'already_paid', type: 'certificate', courseId };
    if (!result.checkout_url) throw new Error('No checkout URL returned from gateway.');
    window.location.href = result.checkout_url;
    return { method: 'redirect', type: 'certificate', orderId: result.order_id };
  },

  /**
   * Charge a certificate through a Somali e-wallet.
   * The Edge Function ignores any client-supplied price and uses platform settings.
   */
  async createCertificateDirectPayment({ courseId, currency = 'USD', gateway, account }) {
    return callEdgeFn('createDirectPayment', {
      type: 'certificate',
      referenceId: courseId,
      currency,
      gateway,
      account
    });
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
    const { boostService } = await import('./boostService.js');
    const order = await boostService.createPromotionOrder({ productType: 'boost', entityType, entityId, planDays });
    
    const isSomali = await PaymentService.isSomaliUser();
    if (isSomali) return { method: 'ewallet', entityType, entityId, amount: order.canonical_amount, planDays, currency, promotionOrderId: order.order_id };
    const result = await callEdgeFn('createCheckout', { type: 'boost', referenceId: entityId, entityType, planDays, amount: order.canonical_amount, currency, promotionOrderId: order.order_id });
    if (!result.checkout_url) throw new Error('No checkout URL returned from gateway.');
    window.location.href = result.checkout_url;
    return { method: 'redirect' };
  },

  /**
   * Initiate a banner payment (Courses/Mentors).
   */
  async startBannerPayment(entityType, entityId, amount, planDays, bannerText, currency = 'USD') {
    const { boostService } = await import('./boostService.js');
    const order = await boostService.createPromotionOrder({ productType: 'banner', entityType, entityId, planDays, bannerText });

    const isSomali = await PaymentService.isSomaliUser();
    if (isSomali) return { method: 'ewallet', entityType, entityId, amount: order.canonical_amount, planDays, bannerText, currency, promotionOrderId: order.order_id };
    const result = await callEdgeFn('createCheckout', { type: 'banner', referenceId: entityId, entityType, planDays, bannerText, amount: order.canonical_amount, currency, promotionOrderId: order.order_id });
    if (!result.checkout_url) throw new Error('No checkout URL returned from gateway.');
    window.location.href = result.checkout_url;
    return { method: 'redirect' };
  },

  /**
   * Initiate a combined boost + banner payment (single charge, both records created atomically).
   * boostAmount + bannerAmount must add up to totalAmount.
   */
  async startBoostAndBannerPayment(entityType, entityId, boostAmount, bannerAmount, planDays, bannerText, currency = 'USD') {
    const { boostService } = await import('./boostService.js');
    const order = await boostService.createPromotionOrder({ productType: 'boost_and_banner', entityType, entityId, planDays, bannerText });
    
    const totalAmount = order.canonical_amount;
    const isSomali = await PaymentService.isSomaliUser();
    if (isSomali) return {
      method: 'ewallet', entityType, entityId,
      amount: totalAmount, planDays, bannerText, currency,
      boostAmount, bannerAmount,
      promotionOrderId: order.order_id
    };
    const result = await callEdgeFn('createCheckout', {
      type: 'boost_and_banner', referenceId: entityId, entityType,
      planDays, bannerText, amount: totalAmount, currency,
      promotionOrderId: order.order_id
    });
    if (!result.checkout_url) throw new Error('No checkout URL returned from gateway.');
    window.location.href = result.checkout_url;
    return { method: 'redirect' };
  },

  /**
   * Process a direct e-wallet payment (Somali users).
   * No redirect — result is returned immediately.
   */
  async createDirectPayment({ type, referenceId, amount, currency = 'USD', gateway, account, entityType, planDays, bannerText, promotionOrderId }) {
    return callEdgeFn('createDirectPayment', { type, referenceId, amount, currency, gateway, account, entityType, planDays, bannerText, promotionOrderId });
  },

  /**
   * Legacy methods (still used by booking.js)
   */
  async createCourseCheckout(courseId, amount, currency = 'USD') {
    const result = await callEdgeFn('createCheckout', { type: 'course', referenceId: courseId, amount, currency });
    if (result.already_paid) {
      window.location.href = '/src/pages/student/student-dashboard/index.html';
      return;
    }
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
