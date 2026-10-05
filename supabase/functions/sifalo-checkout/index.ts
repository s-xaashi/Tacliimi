import { createClient } from 'jsr:@supabase/supabase-js@2';

type ActionType = 'createCheckout' | 'verifyTransaction' | 'createDirectPayment';

interface CreateCheckoutPayload {
  type: 'course' | 'booking' | 'boost' | 'banner' | 'boost_and_banner' | 'certificate';
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
  sid: string;
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
    const { data: session, error } = await supabase.from('mentorship_sessions').select('mentor_id, mentorship_type, notes, booking_status').eq('id', referenceId).single();
    if (error || !session) return null;
    // ensure booking hasn't been paid already/is in valid state (pending or pending_payment)
    if (session.booking_status !== 'pending' && session.booking_status !== 'pending_payment') return null;

    const { data: profile, error: pErr } = await supabase.from('mentorship_profiles').select('hourly_rate, monthly_rate').eq('instructor_id', session.mentor_id).single();
    if (pErr || !profile) return null;

    const isMonthly = session.mentorship_type === 'program' || session.mentorship_type === 'monthly' || (session.notes && session.notes.includes('monthly'));
    const hourlyRate = Number(profile.hourly_rate || 0);
    const monthlyRate = profile.monthly_rate ? Number(profile.monthly_rate) : (hourlyRate * 20);

    let basePrice = isMonthly ? monthlyRate : hourlyRate;

    if (payload.couponCode) {
      const { data: coupon, error: cErr } = await supabase.from('mentorship_coupons').select('discount_percentage, expires_at').eq('mentor_id', session.mentor_id).eq('code', payload.couponCode.toUpperCase()).single();
      if (!cErr && coupon && new Date(coupon.expires_at) > new Date()) {
         let dp = Number(coupon.discount_percentage || 0);
         basePrice = basePrice * (1 - (dp / 100));
      }
    }

    return basePrice;
  } else if (type === 'boost' || type === 'banner' || type === 'boost_and_banner') {
    if (!payload.promotionOrderId) return null;
    const { data: order, error: orderErr } = await supabase.from('promotion_orders').select('canonical_amount, status, payer_id').eq('id', payload.promotionOrderId).single();
    if (orderErr || !order) return null;
    if (order.payer_id !== userId || order.status !== 'pending') return null;
    return Number(order.canonical_amount);
  }
  return null;
}


async function getCertificateContext(supabase: any, userId: string, courseId: string) {
  const { data: course, error: courseErr } = await supabase
    .from('courses')
    .select('id, title, certificate_enabled')
    .eq('id', courseId)
    .single();
  if (courseErr || !course) return { error: 'Course not found', status: 404 };
  if (!course.certificate_enabled) return { error: 'Certificates are not enabled for this course', status: 403 };

  const { data: enrollment, error: enrollmentErr } = await supabase
    .from('enrollments')
    .select('completed_at, progress_percentage')
    .eq('student_id', userId)
    .eq('course_id', courseId)
    .maybeSingle();
  if (enrollmentErr || !enrollment) return { error: 'You are not enrolled in this course', status: 403 };

  const completed = !!enrollment.completed_at || Number(enrollment.progress_percentage || 0) >= 100;
  if (!completed) return { error: 'Course not yet completed', status: 403 };

  const { data: settings, error: settingsErr } = await supabase.rpc('get_platform_settings');
  if (settingsErr || !settings) return { error: 'Unable to load certificate payment settings', status: 500 };

  const price = Number(settings.certificate_price ?? 1);
  if (!Number.isFinite(price) || price < 0) return { error: 'Invalid certificate price configuration', status: 500 };

  const { data: paidOrder } = await supabase
    .from('certificate_orders')
    .select('id, order_id, payment_status, verification_status')
    .eq('student_id', userId)
    .eq('course_id', courseId)
    .eq('payment_status', 'paid')
    .eq('verification_status', 'verified')
    .order('paid_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  return { course, settings, price, paidOrder: paidOrder || null };
}

async function createCertificateCheckout(userId: string, payload: CreateCheckoutPayload): Promise<Response> {
  const courseId = payload.referenceId;
  const supabase = adminClient();
  const ctx = await getCertificateContext(supabase, userId, courseId);
  if (ctx.error) return err(ctx.error, ctx.status);
  if (ctx.paidOrder) return json({ status: 'already_paid', already_paid: true, type: 'certificate', referenceId: courseId });
  if (!RETURN_URL_BASE) return err('Server misconfiguration: RETURN_URL_BASE not set', 500);

  const orderId = generateOrderId();
  const returnUrl = RETURN_URL_BASE + '/src/pages/payment/return/index.html?order_id=' + encodeURIComponent(orderId);

  const { data: order, error: orderErr } = await supabase
    .from('certificate_orders')
    .insert({
      student_id: userId,
      course_id: courseId,
      amount: ctx.price,
      currency: payload.currency || 'USD',
      order_id: orderId,
      payment_status: 'pending',
      verification_status: 'unverified'
    })
    .select('id')
    .single();
  if (orderErr || !order) return err('Failed to initialize certificate payment.', 500, orderErr);

  const { data: payment, error: paymentErr } = await supabase
    .from('payments')
    .insert({
      student_id: userId,
      amount: ctx.price,
      currency: payload.currency || 'USD',
      payment_provider: 'sifalo_checkout',
      payment_status: 'pending',
      order_id: orderId,
      gateway: 'sifalo_checkout',
      verification_status: 'unverified',
      transaction_reference: orderId,
      certificate_order_id: order.id
    })
    .select('id')
    .single();

  if (paymentErr || !payment) {
    await supabase.from('certificate_orders').update({ payment_status: 'failed', verification_status: 'failed', updated_at: new Date().toISOString() }).eq('id', order.id);
    return err('Failed to initialize certificate payment record.', 500, paymentErr);
  }

  let result: Awaited<ReturnType<typeof sifaloPost>>;
  try {
    result = await sifaloPost({
      amount: ctx.price.toFixed(2),
      gateway: 'checkout',
      currency: payload.currency || 'USD',
      return_url: returnUrl
    });
  } catch {
    await supabase.from('certificate_orders').update({ payment_status: 'failed', verification_status: 'failed', updated_at: new Date().toISOString() }).eq('id', order.id);
    await supabase.from('payments').update({ payment_status: 'failed', verification_status: 'failed', updated_at: new Date().toISOString() }).eq('id', payment.id);
    return err('Payment gateway unreachable. Please try again.', 502);
  }

  const { data, rawText, ok } = result;
  const key = data.key as string | undefined;
  const token = data.token as string | undefined;
  if (!ok || !key || !token) {
    await supabase.from('certificate_orders').update({ payment_status: 'failed', verification_status: 'failed', updated_at: new Date().toISOString() }).eq('id', order.id);
    await supabase.from('payments').update({ payment_status: 'failed', verification_status: 'failed', gateway_response: data, updated_at: new Date().toISOString() }).eq('id', payment.id);
    const msg = (data.message ?? data.error ?? ('Sifalo error: ' + rawText.substring(0, 200))) as string;
    return err(msg, 502);
  }

  const checkoutUrl = SIFALO_CHECKOUT_PAGE + '?key=' + encodeURIComponent(key) + '&token=' + encodeURIComponent(token);
  return json({ checkout_url: checkoutUrl, order_id: orderId, type: 'certificate', referenceId: courseId });
}

async function createCertificateDirectPayment(userId: string, payload: DirectPaymentPayload): Promise<Response> {
  const courseId = payload.referenceId;
  const supabase = adminClient();
  const ctx = await getCertificateContext(supabase, userId, courseId);
  if (ctx.error) return err(ctx.error, ctx.status);
  if (ctx.paidOrder) return json({ status: 'already_paid', already_paid: true, type: 'certificate', referenceId: courseId });

  const orderId = generateOrderId();
  const currency = payload.currency || 'USD';

  const { data: order, error: orderErr } = await supabase
    .from('certificate_orders')
    .insert({
      student_id: userId,
      course_id: courseId,
      amount: ctx.price,
      currency,
      order_id: orderId,
      payment_status: 'pending',
      verification_status: 'unverified'
    })
    .select('id')
    .single();
  if (orderErr || !order) return err('Failed to initialize certificate payment.', 500, orderErr);

  const { data: payment, error: paymentErr } = await supabase
    .from('payments')
    .insert({
      student_id: userId,
      amount: ctx.price,
      currency,
      payment_provider: 'sifalo_' + payload.gateway,
      payment_status: 'pending',
      order_id: orderId,
      gateway: 'sifalo_' + payload.gateway,
      verification_status: 'unverified',
      transaction_reference: orderId,
      certificate_order_id: order.id
    })
    .select('id')
    .single();
  if (paymentErr || !payment) {
    await supabase.from('certificate_orders').update({ payment_status: 'failed', verification_status: 'failed', updated_at: new Date().toISOString() }).eq('id', order.id);
    return err('Failed to initialize certificate payment record.', 500, paymentErr);
  }

  let result: Awaited<ReturnType<typeof sifaloPost>>;
  try {
    result = await sifaloPost({
      account: payload.account,
      gateway: payload.gateway,
      amount: ctx.price.toFixed(2),
      currency,
      order_id: orderId
    });
  } catch {
    return err('Payment gateway unreachable.', 502);
  }

  const { data, rawText, ok } = result;
  const code = String(data.code ?? '');
  const sid = data.sid as string | undefined;

  if (code === '603') {
    await supabase.from('certificate_orders').update({ sifalo_sid: sid, gateway_response: data, updated_at: new Date().toISOString() }).eq('id', order.id);
    await supabase.from('payments').update({ sifalo_sid: sid, gateway_response: data, updated_at: new Date().toISOString() }).eq('id', payment.id);
    return json({ status: 'pending', type: 'certificate', referenceId: courseId, order_id: orderId, sid });
  }

  const isSuccess = ok && (code === '601' || data.response?.toString().toLowerCase().includes('processed'));
  if (!isSuccess) {
    await supabase.from('certificate_orders').update({ payment_status: 'failed', verification_status: 'failed', sifalo_sid: sid, updated_at: new Date().toISOString() }).eq('id', order.id);
    await supabase.from('payments').update({ payment_status: 'failed', verification_status: 'failed', sifalo_sid: sid, gateway_response: data, updated_at: new Date().toISOString() }).eq('id', payment.id);
    const msg = (data.response ?? data.message ?? data.error ?? ('Payment failed: ' + rawText.substring(0, 200))) as string;
    return err(msg, 402);
  }

  const now = new Date().toISOString();
  await supabase.from('certificate_orders').update({ payment_status: 'paid', verification_status: 'verified', sifalo_sid: sid, paid_at: now, updated_at: now }).eq('id', order.id);
  await supabase.from('payments').update({ payment_status: 'paid', verification_status: 'verified', sifalo_sid: sid, gateway_response: data, updated_at: now }).eq('id', payment.id);
  await supabase.from('certificates').update({ payment_unlocked: true, payment_unlocked_at: now, payment_order_id: order.id }).eq('student_id', userId).eq('course_id', courseId);

  return json({ status: 'success', type: 'certificate', referenceId: courseId, order_id: orderId, sid });
}

async function createCheckout(userId: string, payload: CreateCheckoutPayload): Promise<Response> {
  const { type, referenceId, currency = 'USD' } = payload;
  if (!type || !referenceId) return err('Missing required fields: type, referenceId');
  if (type === 'certificate') return createCertificateCheckout(userId, payload);
  if (!RETURN_URL_BASE) return err('Server misconfiguration: RETURN_URL_BASE not set', 500);

  const supabase = adminClient();
  
  if (type === 'boost' || type === 'banner' || type === 'boost_and_banner') {

    const { data: settings } = await supabase.rpc('get_platform_settings');
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

  // Reuse the single payment row allowed for a student/course.
  // Failed or pending attempts must not block a legitimate retry.
  let existingCoursePayment: { id: string; payment_status: string; verification_status: string } | null = null;
  if (type === 'course') {
    const { data: existing } = await supabase
      .from('payments')
      .select('id, payment_status, verification_status')
      .eq('student_id', userId)
      .eq('course_id', referenceId)
      .maybeSingle();

    existingCoursePayment = existing;

    if (existingCoursePayment?.payment_status === 'paid' || existingCoursePayment?.verification_status === 'verified') {
      await supabase.from('enrollments').upsert(
        { student_id: userId, course_id: referenceId },
        { onConflict: 'student_id,course_id', ignoreDuplicates: true }
      );
      return json({ status: 'already_paid', already_paid: true, type: 'course', referenceId });
    }
  }

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
  if (type === 'course') {
    paymentRow.course_id = referenceId;
  } else if (type === 'booking') {
    paymentRow.mentorship_session_id = referenceId;
    await supabase.from('mentorship_sessions').update({ booking_status: 'pending_payment' }).eq('id', referenceId);
  }

  const payQuery = existingCoursePayment
    ? supabase.from('payments').update(paymentRow).eq('id', existingCoursePayment.id)
    : supabase.from('payments').insert(paymentRow);

  const { error: payErr } = await payQuery;
  if (payErr) {
    console.error('Payment record error:', payErr);
    return err('Failed to initialize payment record.', 500, payErr);
  }

  return json({ checkout_url: checkoutUrl, order_id: orderId });
}

async function createDirectPayment(userId: string, token: string, payload: DirectPaymentPayload): Promise<Response> {
  const { type, referenceId, currency = 'USD', gateway, account } = payload;
  if (!type || !referenceId || !gateway || !account) {
    return err('Missing required fields: type, referenceId, gateway, account');
  }

  const supabase = adminClient();

  if (type === 'certificate') return createCertificateDirectPayment(userId, payload);

  if (type === 'boost' || type === 'banner' || type === 'boost_and_banner') {
    const { data: settings } = await supabase.rpc('get_platform_settings');
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

  // Reuse the single payment row allowed for a student/course.
  // Failed or pending attempts must not block a legitimate retry.
  let existingCoursePayment: { id: string; payment_status: string; verification_status: string } | null = null;
  if (type === 'course') {
    const { data: existing } = await supabase
      .from('payments')
      .select('id, payment_status, verification_status')
      .eq('student_id', userId)
      .eq('course_id', referenceId)
      .maybeSingle();

    existingCoursePayment = existing;

    if (existingCoursePayment?.payment_status === 'paid' || existingCoursePayment?.verification_status === 'verified') {
      await supabase.from('enrollments').upsert(
        { student_id: userId, course_id: referenceId },
        { onConflict: 'student_id,course_id', ignoreDuplicates: true }
      );
      return json({ status: 'already_paid', already_paid: true, type: 'course', referenceId });
    }
  }

  // ==========================================
  // CRITICAL PHASE 5 FIX: CANONICAL PRICE 
  // No longer trusts payload.amount blindly
  // ==========================================
  let effectiveAmount = await getCanonicalPrice(supabase, type, referenceId, userId, payload);
  if (effectiveAmount === null) return err('Invalid product pricing or coupon verification failed', 400);

  let result: Awaited<ReturnType<typeof sifaloPost>>;
  try {
    result = await sifaloPost({ account, gateway, amount: effectiveAmount.toFixed(2), currency, order_id: orderId });
  } catch (e) {
    return err('Payment gateway unreachable.', 502);
  }

  const { data, rawText, ok } = result;
  const isSuccess = ok && (data.code === '601' || data.code === 601 || data.response?.toString().toLowerCase().includes('processed'));
  const sid = data.sid as string | undefined;

  if (!isSuccess) {
    const msg = (data.response ?? data.message ?? data.error ?? `Payment failed: ${rawText.substring(0, 200)}`) as string;
    return err(msg, 402);
  }

  const paymentRow: Record<string, unknown> = {
    student_id: userId, amount: effectiveAmount, currency,
    payment_provider: `sifalo_${gateway}`, payment_status: 'paid',
    order_id: orderId, sifalo_sid: sid, gateway: `sifalo_${gateway}`,
    verification_status: 'verified', transaction_reference: orderId,
    gateway_response: data,
  };
  if (type === 'course') {
    paymentRow.course_id = referenceId;
  } else if (type === 'booking') {
    paymentRow.mentorship_session_id = referenceId;
  }

  let safePaymentId: string;
  if (existingCoursePayment) {
    const { data: updatedPayment, error: payErr } = await supabase
      .from('payments')
      .update(paymentRow)
      .eq('id', existingCoursePayment.id)
      .select('id')
      .single();

    if (payErr || !updatedPayment) {
      console.error('Payment update error:', payErr);
      return err('Failed to record payment.', 500, payErr);
    }
    safePaymentId = updatedPayment.id;
  } else {
    const { data: insertedPayment, error: payErr } = await supabase
      .from('payments')
      .insert(paymentRow)
      .select('id')
      .single();

    if (payErr || !insertedPayment) {
      console.error('Payment insert error:', payErr);
      return err('Failed to record payment.', 500, payErr);
    }
    safePaymentId = insertedPayment.id;
  }

  const { data: settings } = await supabase.rpc('get_platform_settings');
  const commEnabled = settings?.commission_enabled === true;
  const pPct = commEnabled ? (settings?.platform_percentage || 0) : 0;
  const iPct = commEnabled ? (settings?.instructor_percentage || 100) : 100;
  const fee = (effectiveAmount * pPct) / 100;
  const share = (effectiveAmount * iPct) / 100;

  if (type === 'course') {
    await supabase.from('enrollments').upsert(
      { student_id: userId, course_id: referenceId, enrolled_at: new Date().toISOString() },
      { onConflict: 'student_id,course_id', ignoreDuplicates: true }
    );

    if (payload.couponCode) {
      const { data: coupon } = await supabase.from('course_coupons').select('id').eq('code', payload.couponCode.toUpperCase()).single();
      if (coupon?.id) {
         await supabase.from('course_update_offers')
           .update({ redeemed_at: new Date().toISOString() })
           .eq('coupon_id', coupon.id)
           .eq('student_id', userId)
           .is('redeemed_at', null);
      }
    }

    const { data: course } = await supabase.from('courses').select('instructor_id').eq('id', referenceId).single();
    if (course?.instructor_id) {
       await supabase.from('instructor_earnings').upsert({
         instructor_id: course.instructor_id, payment_id: safePaymentId, course_id: referenceId,
         earning_type: 'course', gross_amount: effectiveAmount, platform_fee: fee, instructor_share: share, instructor_percentage_snapshot: iPct, platform_percentage_snapshot: pPct, currency
       }, { onConflict: 'payment_id' });
    }

    return json({ status: 'success', type: 'course', referenceId, sid, order_id: orderId });
  } else if (type === 'booking') {
    await supabase.from('mentorship_sessions').update({ booking_status: 'paid_waiting_review' }).eq('id', referenceId);
    const { data: session } = await supabase.from('mentorship_sessions').select('mentor_id').eq('id', referenceId).single();
    if (session?.mentor_id) {
        await supabase.from('instructor_earnings').upsert({
           instructor_id: session.mentor_id, payment_id: safePaymentId, mentorship_session_id: referenceId,
           earning_type: 'mentorship', gross_amount: effectiveAmount, platform_fee: fee, instructor_share: share, instructor_percentage_snapshot: iPct, platform_percentage_snapshot: pPct, currency
        }, { onConflict: 'payment_id' });
    }

    return json({ status: 'success', type: 'booking', referenceId, sid, order_id: orderId });
  } else if (type === 'boost' || type === 'banner' || type === 'boost_and_banner') {
    const promotionOrderId = payload.promotionOrderId;
    if (!promotionOrderId) {
      await supabase.from('payments').update({
        verification_status: 'needs_manual_grant',
        gateway_response: { ...data, error: 'Missing promotionOrderId in payload' }
      }).eq('id', safePaymentId);
      return err('Missing promotionOrderId. Payment captured but boost not granted — flagged for admin review.', 400);
    }
    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const { data: consumeResult, error: consumeErr } = await userClient.rpc('consume_promotion_order', {
      p_order_id: promotionOrderId,
      p_payment_id: safePaymentId
    });

    if (consumeErr) {
      console.error('Failed to consume promotion order:', consumeErr);
      await supabase.from('payments').update({
        verification_status: 'needs_manual_grant',
        gateway_response: { ...data, rpc_error: consumeErr }
      }).eq('id', safePaymentId);
      return err('Payment was captured but boost/banner could not be granted automatically. It has been flagged for admin review.', 500, consumeErr);
    }

    return json({ status: 'success', type, referenceId, sid, order_id: orderId, grant: consumeResult });
  }

  return json({ status: 'failed', message: 'Unknown type' });
}

async function verifyTransaction(_userId: string, payload: VerifyPayload): Promise<Response> {
  const { orderId, sid } = payload;
  const supabase = adminClient();
  const { data: payment, error: fetchErr } = await supabase
    .from('payments')
    .select('id, student_id, course_id, mentorship_session_id, certificate_order_id, amount, payment_status, verification_status, gateway_response')
    .eq('order_id', orderId)
    .single();

  if (fetchErr || !payment) return err('Payment record not found', 404);
  
  if (payment.student_id !== _userId) {
    console.warn(`Unauthorized verification attempt: User ${_userId} tried to verify payment owned by ${payment.student_id}`);
    return err('Unauthorized: You do not own this transaction', 403);
  }
  
  const determineTypeFromPayment = () => {
    if (payment.certificate_order_id) return 'certificate';
    if (payment.course_id) return 'course';
    if (payment.mentorship_session_id) return 'booking';
    return 'boost_or_banner'; 
  };
  
  const resolvedType = determineTypeFromPayment();
  if (payment.verification_status === 'verified' && payment.payment_status === 'paid') {
    if (resolvedType === 'certificate') {
      const { data: order } = await supabase
        .from('certificate_orders')
        .select('course_id')
        .eq('id', payment.certificate_order_id)
        .single();
      return json({ status: 'success', type: 'certificate', referenceId: order?.course_id || null, order_id: orderId });
    }
    return json({ status: 'success', type: resolvedType, referenceId: payment.course_id || payment.mentorship_session_id || 'unlinked_boost' });
  }

  const verifyBody = sid ? { sid } : { order_id: orderId };
  let verifyRes: Response;
  try {
    verifyRes = await fetch(SIFALO_VERIFY_URL, {
      method: 'POST',
      headers: { 'Authorization': basicAuthHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify(verifyBody),
    });
  } catch { return err('Payment gateway unreachable', 502); }

  const rawText = await verifyRes.text();
  let verifyData: Record<string, unknown> = {};
  try { verifyData = JSON.parse(rawText); } catch { return err('Bad gateway response', 502); }

  const isSuccess = verifyData.status === 'success' || (verifyData.code as number) === 601;
  const paymentType = (verifyData.payment_type as string) || null;

  if (isSuccess) {
    await supabase.from('payments').update({
      payment_status: 'paid', sifalo_sid: verifyData.sid ?? sid,
      payment_provider: paymentType ? `sifalo_${paymentType.toLowerCase()}` : 'sifalo_checkout',
      gateway_response: verifyData, verification_status: 'verified',
    }).eq('id', payment.id);

    if (resolvedType === 'certificate') {
      const { data: order } = await supabase
        .from('certificate_orders')
        .select('course_id')
        .eq('id', payment.certificate_order_id)
        .single();

      const now = new Date().toISOString();
      await supabase.from('certificate_orders').update({
        payment_status: 'paid',
        verification_status: 'verified',
        sifalo_sid: verifyData.sid ?? sid,
        paid_at: now,
        updated_at: now
      }).eq('id', payment.certificate_order_id);

      await supabase.from('certificates').update({
        payment_unlocked: true,
        payment_unlocked_at: now,
        payment_order_id: payment.certificate_order_id
      }).eq('student_id', payment.student_id).eq('course_id', order?.course_id);

      return json({ status: 'success', type: 'certificate', referenceId: order?.course_id || null, order_id: orderId });
    }

    const { data: settings } = await supabase.rpc('get_platform_settings');
    const commEnabled = settings?.commission_enabled === true;
    const pPct = commEnabled ? (settings?.platform_percentage || 0) : 0;
    const iPct = commEnabled ? (settings?.instructor_percentage || 100) : 100;
      
    const fee = (payment.amount * pPct) / 100;
    const share = (payment.amount * iPct) / 100;

    if (resolvedType === 'course') {
       await supabase.from('enrollments').upsert({ student_id: payment.student_id, course_id: payment.course_id }, { onConflict: 'student_id,course_id' });
       
       const couponCode = (payment.gateway_response as Record<string, unknown>)?.couponCode as string | undefined;
       if (couponCode) {
         const { data: coupon } = await supabase.from('course_coupons').select('id').eq('code', couponCode.toUpperCase()).single();
         if (coupon?.id) {
            await supabase.from('course_update_offers')
              .update({ redeemed_at: new Date().toISOString() })
              .eq('coupon_id', coupon.id)
              .eq('student_id', payment.student_id)
              .is('redeemed_at', null);
         }
       }
       
       const { data: course } = await supabase.from('courses').select('instructor_id').eq('id', payment.course_id).single();
       if (course?.instructor_id) {
          await supabase.from('instructor_earnings').upsert({
            instructor_id: course.instructor_id,
            payment_id: payment.id,
            course_id: payment.course_id,
            earning_type: 'course',
            gross_amount: payment.amount,
            platform_fee: fee,
            instructor_share: share,
            instructor_percentage_snapshot: iPct,
            platform_percentage_snapshot: pPct,
            currency: 'USD'
          }, { onConflict: 'payment_id' });
       }
       return json({ status: 'success', type: 'course', referenceId: payment.course_id });
    } else if (resolvedType === 'booking') {
      await supabase.from('mentorship_sessions').update({ booking_status: 'paid_waiting_review' }).eq('id', payment.mentorship_session_id);
      
      const { data: session } = await supabase.from('mentorship_sessions').select('mentor_id').eq('id', payment.mentorship_session_id).single();
      if (session?.mentor_id) {
          await supabase.from('instructor_earnings').upsert({
            instructor_id: session.mentor_id,
            payment_id: payment.id,
            mentorship_session_id: payment.mentorship_session_id,
            earning_type: 'mentorship',
            gross_amount: payment.amount,
            platform_fee: fee,
            instructor_share: share,
            instructor_percentage_snapshot: iPct,
            platform_percentage_snapshot: pPct,
            currency: 'USD'
          }, { onConflict: 'payment_id' });
      }
      return json({ status: 'success', type: 'booking', referenceId: payment.mentorship_session_id });
    } else if (resolvedType === 'boost_or_banner') {
       return json({ status: 'success', type: 'boost_or_banner', referenceId: 'unlinked_boost_redirect' });
    }
    return json({ status: 'success' });
  } else if (resolvedType === 'certificate' && String(verifyData.code ?? '') === '603') {
    await supabase.from('certificate_orders').update({
      payment_status: 'pending',
      verification_status: 'unverified',
      sifalo_sid: verifyData.sid ?? sid,
      updated_at: new Date().toISOString()
    }).eq('id', payment.certificate_order_id);
    await supabase.from('payments').update({
      payment_status: 'pending',
      verification_status: 'unverified',
      sifalo_sid: verifyData.sid ?? sid,
      gateway_response: verifyData,
      updated_at: new Date().toISOString()
    }).eq('id', payment.id);
    return json({ status: 'pending', type: 'certificate', referenceId: null, order_id: orderId });
  } else {
    await supabase.from('payments').update({ payment_status: 'failed', sifalo_sid: verifyData.sid ?? sid, gateway_response: verifyData, verification_status: 'failed' }).eq('id', payment.id);
    if (resolvedType === 'certificate') {
      await supabase.from('certificate_orders').update({ payment_status: 'failed', verification_status: 'failed', sifalo_sid: verifyData.sid ?? sid, updated_at: new Date().toISOString() }).eq('id', payment.certificate_order_id);
    }
    return json({ status: 'failed', message: (verifyData.message as string) || 'Payment failed' });
  }
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
    case 'verifyTransaction':   return verifyTransaction(user.id, payload);
    default:                    return err(`Unknown action: ${action}`);
  }
});
