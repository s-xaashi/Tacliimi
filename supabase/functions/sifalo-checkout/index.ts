import { createClient } from 'jsr:@supabase/supabase-js@2';

type ActionType = 'createCheckout' | 'verifyTransaction' | 'createDirectPayment';

interface CreateCheckoutPayload {
  type: 'course' | 'booking' | 'boost' | 'banner' | 'boost_and_banner';
  entityType?: 'course' | 'mentorship_sessions';
  referenceId: string;
  couponCode?: string;
  amount?: number;
  currency?: string;
  bannerText?: string;
  planDays?: number;
  promotionOrderId?: string;
}

interface DirectPaymentPayload {
  type: 'course' | 'booking' | 'boost' | 'banner' | 'boost_and_banner';
  entityType?: 'course' | 'mentor' | 'mentorship_sessions';
  bannerText?: string;
  planDays?: number;
  referenceId: string;
  couponCode?: string;
  amount?: number;
  currency?: string;
  gateway: 'waafi' | 'edahab' | 'pbwallet';
  account: string;
  promotionOrderId?: string;
}

interface VerifyPayload {
  orderId: string;
  sid?: string | null;
}

const SIFALO_USERNAME  = Deno.env.get('SIFALO_USERNAME')  ?? '';
const SIFALO_API_KEY   = Deno.env.get('SIFALO_API_KEY')   ?? '';
const RETURN_URL_BASE  = Deno.env.get('RETURN_URL_BASE')  ?? '';
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')     ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const SIFALO_GATEWAY_URL  = 'https://api.sifalopay.com/gateway/';
const SIFALO_VERIFY_URL   = 'https://api.sifalopay.com/gateway/verify.php';
const SIFALO_CHECKOUT_PAGE = 'https://pay.sifalo.com/checkout/';

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
}

function basicAuthHeader(): string {
  return `Basic ${btoa(`${SIFALO_USERNAME}:${SIFALO_API_KEY}`)}`;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function err(message: string, status = 400, details?: any) {
  return json({ error: message, details }, status);
}

function generateOrderId(): string {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `TCL-${ts}-${rand}`;
}

async function sifaloPost(body: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown>; rawText: string }> {
  const res = await fetch(SIFALO_GATEWAY_URL, {
    method: 'POST',
    headers: { 'Authorization': basicAuthHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const rawText = await res.text();
  console.log(`Sifalo [${res.status}]:`, rawText.substring(0, 400));
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(rawText); } catch { /* ... */ }
  return { ok: res.ok, data, rawText };
}

async function getCanonicalPrice(supabase: any, type: string, referenceId: string, userId: string, payload: any): Promise<number | null> {
  if (type === 'course') {
    const { data: course, error } = await supabase.from('courses').select('price').eq('id', referenceId).single();
    if (error || !course) return null;
    let basePrice = Number(course.price);

    if (payload.couponCode) {
      const { data: couponValid, error: couponErr } = await supabase.rpc('validate_course_coupon', {
        p_course_id: referenceId,
        p_code: payload.couponCode,
        p_student_id: userId
      });
      if (!couponErr && couponValid && Array.isArray(couponValid) && couponValid[0]?.valid) {
         let dp = Number(couponValid[0].discount_percent || 0);
         basePrice = basePrice * (1 - (dp / 100));
      }
    }
    return basePrice;
  } else if (type === 'booking') {
    const { data: session, error: sessionErr } = await supabase
      .from('mentorship_sessions')
      .select('student_id, mentor_id, booking_status, mentorship_type, notes')
      .eq('id', referenceId)
      .maybeSingle();
    if (sessionErr || !session) return null;
    if (session.student_id !== userId) return null;
    if (session.booking_status !== 'pending' && session.booking_status !== 'pending_payment') return null;
    if (!session.mentor_id) return null;
    const { data: mentorProfile, error: profileErr } = await supabase
      .from('mentorship_profiles')
      .select('hourly_rate, monthly_rate')
      .eq('instructor_id', session.mentor_id)
      .maybeSingle();
    if (profileErr || !mentorProfile) return null;
    const hourlyRate = Number(mentorProfile.hourly_rate);
    const monthlyRate = mentorProfile.monthly_rate == null ? NaN : Number(mentorProfile.monthly_rate);
    const isMonthly = session.mentorship_type === 'program' || /Type:\s*monthly/i.test(session.notes ?? '');
    const canonicalPrice = isMonthly
      ? (Number.isFinite(monthlyRate) && monthlyRate > 0 ? monthlyRate : hourlyRate * 20)
      : hourlyRate;
    if (!Number.isFinite(canonicalPrice) || canonicalPrice <= 0) return null;
    return canonicalPrice;
  } else if (type === 'boost' || type === 'banner' || type === 'boost_and_banner') {
    if (!payload.promotionOrderId) return null;
    const { data: order, error: orderErr } = await supabase.from('promotion_orders').select('canonical_amount, status, payer_id').eq('id', payload.promotionOrderId).single();
    if (orderErr || !order) return null;
    if (order.payer_id !== userId || order.status !== 'pending') return null;
    return Number(order.canonical_amount);
  }
  return null;
}

async function createCheckout(userId: string, payload: CreateCheckoutPayload): Promise<Response> {
  const { type, referenceId, currency = 'USD' } = payload;
  if (!type || !referenceId) return err('Missing required fields: type, referenceId');
  if (String(currency).toUpperCase() !== 'USD') {
    return err('Sifalo hosted checkout supports USD only.', 400);
  }
  if (!RETURN_URL_BASE) return err('Server misconfiguration: RETURN_URL_BASE not set', 500);

  const supabase = adminClient();
  
  if (type === 'boost' || type === 'banner' || type === 'boost_and_banner') {
    const { data: settings, error: settingsErr } = await supabase.rpc('get_platform_settings');
    if (settingsErr || !settings) return err('Could not verify promotion availability. Please try again.', 500, settingsErr);
    const isCourse = (payload.entityType || 'course') === 'course';
    if (type === 'boost' || type === 'boost_and_banner') {
        if (isCourse && settings?.course_boost_enabled === false) return err('Course boosting is currently disabled', 403);
        if (!isCourse && settings?.mentor_boost_enabled === false) return err('Mentor boosting is currently disabled', 403);
    }
    if (type === 'banner' || type === 'boost_and_banner') {
        if (isCourse && settings?.course_banner_enabled === false) return err('Course banners are currently disabled', 403);
        if (!isCourse && settings?.mentor_banner_enabled === false) return err('Mentor banners are currently disabled', 403);
    }
  }

  const orderId  = generateOrderId();
  const returnUrl = `${RETURN_URL_BASE}/src/pages/payment/return/index.html?order_id=${orderId}`;

  // ==========================================
  // CRITICAL PHASE 5 FIX: CANONICAL PRICE 
  // No longer trusts payload.amount blindly
  // ==========================================
  let effectiveAmount = await getCanonicalPrice(supabase, type, referenceId, userId, payload);
  if (effectiveAmount === null) return err('Invalid product pricing or coupon verification failed', 400);

  let result: Awaited<ReturnType<typeof sifaloPost>>;
  try {
    result = await sifaloPost({ amount: effectiveAmount.toFixed(2), gateway: 'checkout', currency, return_url: returnUrl });
  } catch (e) {
    return err('Payment gateway unreachable. Please try again.', 502);
  }

  const { data, rawText, ok } = result;
  const key   = data.key   as string | undefined;
  const token = data.token as string | undefined;

  if (!ok || !key || !token) {
    const msg = (data.message ?? data.error ?? `Sifalo error: ${rawText.substring(0, 200)}`) as string;
    return err(msg, 502);
  }

  const checkoutUrl = `${SIFALO_CHECKOUT_PAGE}?key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;

  const paymentRow: Record<string, unknown> = {
    student_id: userId, amount: effectiveAmount, currency,
    payment_provider: 'sifalo_checkout', payment_status: 'pending',
    order_id: orderId, gateway: 'sifalo_checkout',
    verification_status: 'unverified', transaction_reference: orderId,
  };
  if (payload.couponCode && type === 'course') {
    paymentRow.gateway_response = { couponCode: payload.couponCode };
  }
  if (payload.promotionOrderId && (type === 'boost' || type === 'banner' || type === 'boost_and_banner')) {
    paymentRow.gateway_response = {
      ...((paymentRow.gateway_response as Record<string, unknown> | undefined) ?? {}),
      promotionOrderId: payload.promotionOrderId,
    };
  }
  if (type === 'course') {
    paymentRow.course_id = referenceId;
  } else if (type === 'booking') {
    paymentRow.mentorship_session_id = referenceId;
  }

  const { data: insertedPayment, error: payErr } = await supabase
    .from('payments').insert(paymentRow).select('id').single();
  if (payErr || !insertedPayment) {
    console.error('Payment insert error:', payErr);
    return err('Failed to initialize payment record.', 500, payErr);
  }

  if (type === 'booking') {
    const { data: updatedSession, error: bookingErr } = await supabase
      .from('mentorship_sessions')
      .update({ booking_status: 'pending_payment' })
      .eq('id', referenceId)
      .eq('student_id', userId)
      .select('id')
      .maybeSingle();

    if (bookingErr || !updatedSession) {
      const { error: cleanupErr } = await supabase.from('payments').delete().eq('id', insertedPayment.id);
      if (cleanupErr) console.error('Failed to remove uncharged pending payment:', cleanupErr);
      return err('Could not prepare the mentorship booking for payment. No checkout was started.', 500, bookingErr);
    }
  }

  return json({ checkout_url: checkoutUrl, order_id: orderId });
}

async function createDirectPayment(userId: string, token: string, payload: DirectPaymentPayload): Promise<Response> {
  const { type, referenceId, currency = 'USD', gateway, account } = payload;
  if (!type || !referenceId || !gateway || !account) {
    return err('Missing required fields: type, referenceId, gateway, account');
  }

  const normalizedCurrency = String(currency).toUpperCase();
  if (!['USD', 'SLSH'].includes(normalizedCurrency)) {
    return err('Unsupported Sifalo currency. Use USD or SLSH.', 400);
  }
  if (gateway === 'pbwallet' && normalizedCurrency !== 'USD') {
    return err('Premier Wallet supports USD only.', 400);
  }

  const supabase = adminClient();

  if (type === 'boost' || type === 'banner' || type === 'boost_and_banner') {
    const { data: settings, error: settingsErr } = await supabase.rpc('get_platform_settings');
    if (settingsErr || !settings) return err('Could not verify promotion availability. Please try again.', 500, settingsErr);
    const isCourse = (payload.entityType || 'course') === 'course';
    if (type === 'boost' || type === 'boost_and_banner') {
      if (isCourse && settings.course_boost_enabled === false) return err('Course boosting is currently disabled', 403);
      if (!isCourse && settings.mentor_boost_enabled === false) return err('Mentor boosting is currently disabled', 403);
    }
    if (type === 'banner' || type === 'boost_and_banner') {
      if (isCourse && settings.course_banner_enabled === false) return err('Course banners are currently disabled', 403);
      if (!isCourse && settings.mentor_banner_enabled === false) return err('Mentor banners are currently disabled', 403);
    }
  }

  const effectiveAmount = await getCanonicalPrice(supabase, type, referenceId, userId, payload);
  if (effectiveAmount === null || !Number.isFinite(effectiveAmount) || effectiveAmount <= 0) {
    return err('Invalid product pricing or coupon verification failed', 400);
  }

  const orderId = generateOrderId();
  const paymentRow: Record<string, unknown> = {
    student_id: userId,
    amount: effectiveAmount,
    currency: normalizedCurrency,
    payment_provider: 'sifalo_' + gateway,
    payment_status: 'pending',
    order_id: orderId,
    gateway: 'sifalo_' + gateway,
    verification_status: 'unverified',
    transaction_reference: orderId,
    ...(payload.promotionOrderId ? { gateway_response: { promotionOrderId: payload.promotionOrderId } } : {}),
  };

  if (type === 'course') {
    paymentRow.course_id = referenceId;
  } else if (type === 'booking') {
    paymentRow.mentorship_session_id = referenceId;
  }

  // Persist the canonical order before contacting the wallet gateway. If the
  // request times out after a debit, the order can be verified without charging again.
  const { data: insertedPayment, error: insertErr } = await supabase
    .from('payments')
    .insert(paymentRow)
    .select('id')
    .single();

  if (insertErr || !insertedPayment) {
    console.error('Direct payment order insert failed:', insertErr);
    return err('Could not safely initialize the payment order. No wallet charge was attempted.', 500, insertErr);
  }

  if (type === 'booking') {
    const { data: updatedSession, error: bookingErr } = await supabase
      .from('mentorship_sessions')
      .update({ booking_status: 'pending_payment' })
      .eq('id', referenceId)
      .eq('student_id', userId)
      .select('id')
      .maybeSingle();

    if (bookingErr || !updatedSession) {
      const { error: cleanupErr } = await supabase.from('payments').delete().eq('id', insertedPayment.id);
      if (cleanupErr) console.error('Failed to remove uncharged payment row:', cleanupErr);
      return err('Could not prepare the mentorship booking for payment. No wallet charge was attempted.', 500, bookingErr);
    }
  }

  const saveGatewayResponse = async (gatewayResponse: Record<string, unknown>) => {
    const { error } = await supabase
      .from('payments')
      .update({ gateway_response: gatewayResponse })
      .eq('id', insertedPayment.id)
      .eq('payment_status', 'pending');
    return error;
  };

  const verifyStoredOrder = async (sid?: string) => {
    const verificationResponse = await verifyTransaction(userId, { orderId, sid }, token);
    let verification: Record<string, unknown> = {};
    try {
      verification = await verificationResponse.json();
    } catch {
      // A malformed verification response is not proof of payment failure.
    }

    if (verificationResponse.ok && (verification.status === 'success' || verification.status === 'failed')) {
      return json({ ...verification, order_id: orderId, ...(sid ? { sid } : {}) });
    }
    if (verification.status === 'pending') {
      return json({
        status: 'pending',
        order_id: orderId,
        ...(sid ? { sid } : {}),
        message: 'Your wallet request is still processing. Approve it if prompted, then check the payment status. Do not submit another charge.',
      }, 202);
    }

    return json({
      status: 'manual_review',
      order_id: orderId,
      ...(sid ? { sid } : {}),
      message: 'The wallet gateway may have received the charge, but Tacliimi could not fully verify and reconcile it. Do not pay again; check the status or contact support.',
    }, 202);
  };

  let result: Awaited<ReturnType<typeof sifaloPost>>;
  try {
    result = await sifaloPost({
      account,
      gateway,
      amount: effectiveAmount.toFixed(2),
      currency: normalizedCurrency,
      order_id: orderId,
    });
  } catch (gatewayError) {
    console.error('Direct wallet request outcome is unknown:', gatewayError);
    return await verifyStoredOrder();
  }

  const { data, rawText, ok } = result;
  const gatewayCode = Number(data.code);
  const sid = typeof data.sid === 'string' ? data.sid.trim() : '';

  // The documented e-Wallet response contains code, sid and response. If the
  // provider also echoes order/amount/currency, validate those fields too.
  if (data.order_id !== undefined && String(data.order_id) !== orderId) {
    await saveGatewayResponse({ ...data, local_validation_error: 'order_id mismatch' });
    return json({ status: 'manual_review', order_id: orderId, message: 'Gateway order reference mismatch. Do not pay again; contact support.' }, 202);
  }
  if (data.amount !== undefined) {
    const returnedAmount = Number(data.amount);
    if (!Number.isFinite(returnedAmount) || Math.round(returnedAmount * 100) !== Math.round(effectiveAmount * 100)) {
      await saveGatewayResponse({ ...data, local_validation_error: 'amount mismatch' });
      return json({ status: 'manual_review', order_id: orderId, message: 'Gateway amount mismatch. Do not pay again; contact support.' }, 202);
    }
  }
  if (data.currency !== undefined && String(data.currency).toUpperCase() !== String(currency).toUpperCase()) {
    await saveGatewayResponse({ ...data, local_validation_error: 'currency mismatch' });
    return json({ status: 'manual_review', order_id: orderId, message: 'Gateway currency mismatch. Do not pay again; contact support.' }, 202);
  }

  const responseSaveErr = await saveGatewayResponse(data);
  if (responseSaveErr) {
    console.error('Could not persist direct gateway response:', responseSaveErr);
    return json({
      status: 'manual_review',
      order_id: orderId,
      message: 'The wallet gateway responded, but Tacliimi could not safely save the response. Do not pay again; contact support.',
    }, 202);
  }

  if (ok && gatewayCode === 601) {
    if (!sid) {
      return json({
        status: 'manual_review',
        order_id: orderId,
        message: 'The wallet gateway reported success without a transaction ID. Do not pay again; contact support.',
      }, 202);
    }
    // Use the same authoritative verification and idempotent grant path as
    // hosted checkout; this validates stored order, amount, currency and SID.
    return await verifyStoredOrder(sid);
  }

  if (gatewayCode === 603) {
    return json({
      status: 'pending',
      order_id: orderId,
      ...(sid ? { sid } : {}),
      message: 'Approve the payment request on your phone. Tacliimi will not charge you again while this order is pending.',
    }, 202);
  }

  if (gatewayCode === 600 || gatewayCode === 604) {
    const { error: failedErr } = await supabase
      .from('payments')
      .update({
        payment_status: 'failed',
        verification_status: 'failed',
        gateway_response: data,
        ...(sid ? { sifalo_sid: sid } : {}),
      })
      .eq('id', insertedPayment.id)
      .eq('payment_status', 'pending');

    if (failedErr) {
      console.error('Could not persist definitive direct-payment decline:', failedErr);
      return json({
        status: 'manual_review',
        order_id: orderId,
        message: 'The wallet declined the request, but Tacliimi could not save the result. Check this order before trying another payment.',
      }, 202);
    }
    return json({ status: 'failed', message: String(data.response ?? data.message ?? 'Payment was declined.'), order_id: orderId });
  }

  // Unknown or non-definitive outcomes stay pending to prevent accidental
  // duplicate charges. The stored order can be checked by order_id later.
  console.warn('Unclassified direct wallet response:', { ok, code: data.code, response: data.response, rawText: rawText.slice(0, 160) });
  return json({
    status: 'pending',
    order_id: orderId,
    ...(sid ? { sid } : {}),
    message: 'The wallet response is not yet conclusive. Check the payment status before attempting another payment.',
  }, 202);
}
async function verifyTransaction(_userId: string, payload: VerifyPayload, token: string): Promise<Response> {
  const orderId = typeof payload?.orderId === 'string' ? payload.orderId.trim() : '';
  const suppliedSid = typeof payload?.sid === 'string' ? payload.sid.trim() : '';
  if (!orderId) return err('Missing payment order reference');

  const supabase = adminClient();
  const { data: payment, error: fetchErr } = await supabase
    .from('payments')
    .select('id, order_id, student_id, course_id, mentorship_session_id, amount, currency, payment_status, verification_status, gateway_response, sifalo_sid')
    .eq('order_id', orderId)
    .maybeSingle();

  if (fetchErr || !payment) return err('Payment record not found', 404);
  if (payment.student_id !== _userId) {
    console.warn(\`Unauthorized verification attempt: User \${_userId} tried to verify payment owned by \${payment.student_id}\`);
    return err('Unauthorized: You do not own this transaction', 403);
  }

  const resolvedType = payment.course_id
    ? 'course'
    : payment.mentorship_session_id
      ? 'booking'
      : 'boost_or_banner';

  const alreadyVerified = payment.payment_status === 'paid'
    && payment.verification_status === 'verified';

  if (!alreadyVerified) {
    if (payment.payment_status === 'failed') {
      return json({ status: 'failed', message: 'The gateway confirmed that this payment was declined.' });
    }
    if (payment.payment_status !== 'pending') {
      return json({ status: 'manual_review', message: 'This payment is not in a verifiable state. Please contact support.' }, 409);
    }

    // Always verify against the server-stored order_id. A browser-supplied SID
    // is only a consistency check; it is never used as the lookup authority.
    let verifyRes: Response;
    try {
      verifyRes = await fetch(SIFALO_VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: payment.order_id }),
      });
    } catch {
      return err('Payment gateway unreachable', 502);
    }

    const rawText = await verifyRes.text();
    let verifyData: Record<string, unknown>;
    try {
      verifyData = JSON.parse(rawText);
    } catch {
      return err('Bad gateway response', 502);
    }
    if (!verifyRes.ok) return err('Payment gateway verification failed', 502);

    const gatewayCode = Number(verifyData.code);
    const gatewayStatus = String(verifyData.status ?? '').toLowerCase();

    if (gatewayCode === 603 || gatewayStatus === 'pending') {
      return json({ status: 'pending', message: 'Payment is still awaiting gateway confirmation.' });
    }

    if (gatewayCode === 600 || gatewayCode === 604 || gatewayStatus === 'failed') {
      const failureSid = typeof verifyData.sid === 'string' ? verifyData.sid : null;
      const { data: failedRow, error: failErr } = await supabase
        .from('payments')
        .update({
          payment_status: 'failed',
          ...(failureSid ? { sifalo_sid: failureSid } : {}),
          gateway_response: { ...((payment.gateway_response && typeof payment.gateway_response === 'object') ? payment.gateway_response : {}), ...verifyData },
          verification_status: 'failed',
        })
        .eq('id', payment.id)
        .eq('payment_status', 'pending')
        .select('id')
        .maybeSingle();

      if (failErr) return err('Could not record the gateway payment result', 500, failErr);
      if (!failedRow) {
        const { data: latest } = await supabase
          .from('payments')
          .select('payment_status, verification_status')
          .eq('id', payment.id)
          .maybeSingle();
        if (latest?.payment_status === 'paid' && latest?.verification_status === 'verified') {
          return err('This payment was already verified successfully. Refresh the page.', 409);
        }
      }
      return json({ status: 'failed', message: String(verifyData.message ?? 'Payment failed') });
    }

    // Sifalo documents a paid result as BOTH status=success and code=601.
    if (gatewayStatus !== 'success' || gatewayCode !== 601) {
      return err('Gateway did not return a confirmed successful payment', 502);
    }

    const returnedOrderId = String(verifyData.order_id ?? '');
    const returnedSid = typeof verifyData.sid === 'string' ? verifyData.sid.trim() : '';
    const amountInMinorUnits = (value: unknown): number | null => {
      if (typeof value !== 'number' && typeof value !== 'string') return null;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) return null;
      return Math.round((parsed + Number.EPSILON) * 100);
    };

    const expectedAmount = amountInMinorUnits(payment.amount);
    const gatewayAmount = amountInMinorUnits(verifyData.amount);
    const expectedCurrency = String(payment.currency || 'USD').toUpperCase();
    const gatewayCurrency = String(verifyData.currency ?? '').toUpperCase();

    if (returnedOrderId !== payment.order_id) {
      return err('Gateway order reference does not match this payment', 409);
    }
    if (!returnedSid) return err('Gateway response is missing its transaction ID', 502);
    if (expectedAmount === null || gatewayAmount === null || gatewayAmount !== expectedAmount) {
      return err('Verified payment amount does not match the stored order', 409);
    }
    if (!gatewayCurrency || gatewayCurrency !== expectedCurrency) {
      return err('Verified payment currency does not match the stored order', 409);
    }
    if (suppliedSid && suppliedSid !== returnedSid) {
      return err('Returned transaction ID does not match the gateway verification result', 409);
    }
    if (payment.sifalo_sid && payment.sifalo_sid !== returnedSid) {
      return err('Gateway transaction ID does not match the transaction already stored', 409);
    }

    const mergedGatewayResponse = {
      ...((payment.gateway_response && typeof payment.gateway_response === 'object') ? payment.gateway_response : {}),
      ...verifyData,
    };
    const { data: updatedPayment, error: updateErr } = await supabase
      .from('payments')
      .update({
        payment_status: 'paid',
        sifalo_sid: returnedSid,
        payment_provider: typeof verifyData.payment_type === 'string'
          ? \`sifalo_\${verifyData.payment_type.toLowerCase()}\`
          : 'sifalo_checkout',
        gateway_response: mergedGatewayResponse,
        verification_status: 'verified',
      })
      .eq('id', payment.id)
      .eq('payment_status', 'pending')
      .select('id')
      .maybeSingle();

    if (updateErr) {
      if (updateErr.code === '23505') {
        return err('Another payment for this course has already been confirmed. No duplicate enrollment was created.', 409);
      }
      return err('Could not securely record the verified payment', 500, updateErr);
    }

    if (!updatedPayment) {
      const { data: latest, error: latestErr } = await supabase
        .from('payments')
        .select('payment_status, verification_status, sifalo_sid, gateway_response')
        .eq('id', payment.id)
        .maybeSingle();
      if (latestErr || latest?.payment_status !== 'paid' || latest?.verification_status !== 'verified' || latest?.sifalo_sid !== returnedSid) {
        return err('Payment state changed during verification. Please refresh and try again.', 409);
      }
      payment.gateway_response = latest.gateway_response;
    } else {
      payment.gateway_response = mergedGatewayResponse;
    }
    payment.payment_status = 'paid';
    payment.verification_status = 'verified';
    payment.sifalo_sid = returnedSid;
  }

  // Granting is idempotent: a retry after a transient grant failure re-runs
  // these upserts even though the payment row is already marked verified.
  const { data: settings, error: settingsErr } = await supabase.rpc('get_platform_settings');
  if (settingsErr || !settings) {
    return err('Payment is verified, but commission settings could not be loaded. Please retry reconciliation.', 500, settingsErr);
  }
  const commEnabled = settings.commission_enabled === true;
  const pPct = commEnabled ? (settings.platform_percentage || 0) : 0;
  const iPct = commEnabled ? (settings.instructor_percentage || 100) : 100;
  const fee = (Number(payment.amount) * pPct) / 100;
  const share = (Number(payment.amount) * iPct) / 100;

  if (resolvedType === 'course') {
    const { error: enrollmentErr } = await supabase.from('enrollments').upsert(
      { student_id: payment.student_id, course_id: payment.course_id },
      { onConflict: 'student_id,course_id' }
    );
    if (enrollmentErr) return err('Payment verified, but course enrollment could not be completed. Please retry.', 500, enrollmentErr);

    const couponCode = (payment.gateway_response as Record<string, unknown> | null)?.couponCode as string | undefined;
    if (couponCode) {
      const { data: coupon, error: couponErr } = await supabase
        .from('course_coupons').select('id').eq('code', couponCode.toUpperCase()).maybeSingle();
      if (couponErr) return err('Payment verified, but coupon redemption could not be completed. Please retry.', 500, couponErr);
      if (coupon?.id) {
        const { error: redemptionErr } = await supabase.from('course_update_offers')
          .update({ redeemed_at: new Date().toISOString() })
          .eq('coupon_id', coupon.id)
          .eq('student_id', payment.student_id)
          .is('redeemed_at', null);
        if (redemptionErr) return err('Payment verified, but coupon redemption could not be completed. Please retry.', 500, redemptionErr);
      }
    }

    const { data: course, error: courseErr } = await supabase
      .from('courses').select('instructor_id').eq('id', payment.course_id).maybeSingle();
    if (courseErr || !course) return err('Payment verified, but course earnings could not be reconciled. Please contact support.', 500, courseErr);

    if (course.instructor_id) {
      const { error: earningErr } = await supabase.from('instructor_earnings').upsert({
        instructor_id: course.instructor_id,
        payment_id: payment.id,
        course_id: payment.course_id,
        earning_type: 'course',
        gross_amount: payment.amount,
        platform_fee: fee,
        instructor_share: share,
        instructor_percentage_snapshot: iPct,
        platform_percentage_snapshot: pPct,
        currency: payment.currency || 'USD',
      }, { onConflict: 'payment_id' });
      if (earningErr) return err('Payment verified, but instructor earnings could not be recorded. Please retry.', 500, earningErr);
    }
    return json({ status: 'success', type: 'course', referenceId: payment.course_id });
  }

  if (resolvedType === 'booking') {
    const { data: updatedSession, error: bookingErr } = await supabase.from('mentorship_sessions')
      .update({ booking_status: 'paid_waiting_review' })
      .eq('id', payment.mentorship_session_id)
      .select('id')
      .maybeSingle();
    if (bookingErr || !updatedSession) return err('Payment verified, but the booking could not be updated. Please retry.', 500, bookingErr);

    const { data: session, error: sessionErr } = await supabase.from('mentorship_sessions')
      .select('mentor_id').eq('id', payment.mentorship_session_id).maybeSingle();
    if (sessionErr || !session) return err('Payment verified, but mentor earnings could not be reconciled. Please contact support.', 500, sessionErr);

    if (session.mentor_id) {
      const { error: earningErr } = await supabase.from('instructor_earnings').upsert({
        instructor_id: session.mentor_id,
        payment_id: payment.id,
        mentorship_session_id: payment.mentorship_session_id,
        earning_type: 'mentorship',
        gross_amount: payment.amount,
        platform_fee: fee,
        instructor_share: share,
        instructor_percentage_snapshot: iPct,
        platform_percentage_snapshot: pPct,
        currency: payment.currency || 'USD',
      }, { onConflict: 'payment_id' });
      if (earningErr) return err('Payment verified, but mentor earnings could not be recorded. Please retry.', 500, earningErr);
    }
    return json({ status: 'success', type: 'booking', referenceId: payment.mentorship_session_id });
  }

  // Promotion grants use the caller JWT and are protected by consume_promotion_order.
  // Check for an existing grant first so a retry after a successful RPC is idempotent.
  const promotionOrderId = (payment.gateway_response as Record<string, unknown> | null)?.promotionOrderId;
  if (typeof promotionOrderId !== 'string' || !promotionOrderId) {
    return err('Payment verified, but its promotion order reference is missing. Please contact support.', 500);
  }

  const { data: promotionOrder, error: promotionLookupErr } = await supabase
    .from('promotion_orders')
    .select('id, status, payment_id')
    .eq('id', promotionOrderId)
    .maybeSingle();

  if (promotionLookupErr || !promotionOrder) {
    return err('Payment verified, but its promotion order could not be loaded. Please contact support.', 500, promotionLookupErr);
  }

  if (promotionOrder.status === 'paid_consumed' && promotionOrder.payment_id === payment.id) {
    return json({ status: 'success', type: 'boost_or_banner', referenceId: promotionOrderId });
  }

  if (promotionOrder.status !== 'pending') {
    return err('Payment verified, but the promotion order is no longer pending. Please contact support.', 409);
  }

  const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: 'Bearer ' + token } },
  });
  const { data: consumeResult, error: consumeErr } = await userClient.rpc('consume_promotion_order', {
    p_order_id: promotionOrderId,
    p_payment_id: payment.id,
  });

  if (consumeErr) {
    const { data: latestOrder } = await supabase
      .from('promotion_orders')
      .select('status, payment_id')
      .eq('id', promotionOrderId)
      .maybeSingle();

    if (latestOrder?.status === 'paid_consumed' && latestOrder.payment_id === payment.id) {
      return json({ status: 'success', type: 'boost_or_banner', referenceId: promotionOrderId });
    }
    return err('Payment verified, but the promotion could not be activated. Please contact support.', 500, consumeErr);
  }

  return json({ status: 'success', type: 'boost_or_banner', referenceId: promotionOrderId, grant: consumeResult });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return err('Method not allowed', 405);
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  const supabaseAnon = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: { user }, error: authErr } = await supabaseAnon.auth.getUser(token);
  if (authErr || !user) return err('Unauthorized', 401);
  let body: any;
  try { body = await req.json(); } catch { return err('Invalid JSON'); }
  const { action, payload } = body;
  switch (action) {
    case 'createCheckout':      return createCheckout(user.id, payload);
    case 'createDirectPayment': return createDirectPayment(user.id, token, payload);
    case 'verifyTransaction':   return verifyTransaction(user.id, payload, token);
    default:                    return err(`Unknown action: ${action}`);
  }
});
