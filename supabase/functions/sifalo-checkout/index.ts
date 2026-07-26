import { createClient } from 'jsr:@supabase/supabase-js@2';

type ActionType = 'createCheckout' | 'verifyTransaction' | 'createDirectPayment';

interface CreateCheckoutPayload {
  type: 'course' | 'booking' | 'boost' | 'banner';
  entityType?: 'course' | 'mentorship_sessions';
  referenceId: string;
  amount: number;
  currency?: string;
}

interface DirectPaymentPayload {
  type: 'course' | 'booking' | 'boost' | 'banner';
  entityType?: 'course' | 'mentorship_sessions'; // for boosts
  bannerText?: string;
  planDays?: number;
  referenceId: string;
  amount: number;
  currency?: string;
  gateway: 'waafi' | 'edahab' | 'pbwallet';
  account: string;
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

async function createCheckout(userId: string, payload: CreateCheckoutPayload): Promise<Response> {
  const { type, referenceId, amount, currency = 'USD' } = payload;
  if (!type || !referenceId || amount === undefined) return err('Missing required fields: type, referenceId, amount');
  if (!RETURN_URL_BASE) return err('Server misconfiguration: RETURN_URL_BASE not set', 500);

  const supabase = adminClient();
  
  if (type === 'boost' || type === 'banner') {
    const { data: settings } = await supabase.rpc('get_platform_settings');
    const isCourse = (payload.entityType || 'course') === 'course';
    if (type === 'boost') {
        if (isCourse && settings?.course_boost_enabled === false) return err('Course boosting is currently disabled', 403);
        if (!isCourse && settings?.mentor_boost_enabled === false) return err('Mentor boosting is currently disabled', 403);
    } else {
        if (isCourse && settings?.course_banner_enabled === false) return err('Course banners are currently disabled', 403);
        if (!isCourse && settings?.mentor_banner_enabled === false) return err('Mentor banners are currently disabled', 403);
    }
  }

  const orderId  = generateOrderId();
  const returnUrl = `${RETURN_URL_BASE}/src/pages/payment/return/index.html?order_id=${orderId}`;

  let result: Awaited<ReturnType<typeof sifaloPost>>;
  try {
    result = await sifaloPost({ amount: amount.toFixed(2), gateway: 'checkout', currency, return_url: returnUrl });
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
    student_id: userId, amount, currency,
    payment_provider: 'sifalo_checkout', payment_status: 'pending',
    order_id: orderId, gateway: 'sifalo_checkout',
    verification_status: 'unverified', transaction_reference: orderId,
  };
  if (type === 'course') {
    paymentRow.course_id = referenceId;
  } else if (type === 'booking') {
    paymentRow.mentorship_session_id = referenceId;
    await supabase.from('mentorship_sessions').update({ booking_status: 'pending_payment' }).eq('id', referenceId);
  } else if (type === 'boost' || type === 'banner') {
    // Boosts do not map to course_id / mentorship_session_id on the payment table
    // (We link strictly via the boosts/promo_banners table)
  }

  const { error: payErr } = await supabase.from('payments').insert(paymentRow);
  if (payErr) {
    console.error('Payment insert error:', payErr);
    return err('Failed to initialize payment record.', 500, payErr);
  }

  return json({ checkout_url: checkoutUrl, order_id: orderId });
}

async function createDirectPayment(userId: string, payload: DirectPaymentPayload): Promise<Response> {
  const { type, referenceId, amount, currency = 'USD', gateway, account } = payload;
  if (!type || !referenceId || amount === undefined || !gateway || !account) {
    return err('Missing required fields: type, referenceId, amount, gateway, account');
  }

  const supabase = adminClient();

  if (type === 'boost' || type === 'banner') {
    const { data: settings } = await supabase.rpc('get_platform_settings');
    const isCourse = (payload.entityType || 'course') === 'course';
    if (type === 'boost') {
        if (isCourse && settings?.course_boost_enabled === false) return err('Course boosting is currently disabled', 403);
        if (!isCourse && settings?.mentor_boost_enabled === false) return err('Mentor boosting is currently disabled', 403);
    } else {
        if (isCourse && settings?.course_banner_enabled === false) return err('Course banners are currently disabled', 403);
        if (!isCourse && settings?.mentor_banner_enabled === false) return err('Mentor banners are currently disabled', 403);
    }
  }

  const orderId  = generateOrderId();

  let result: Awaited<ReturnType<typeof sifaloPost>>;
  try {
    result = await sifaloPost({ account, gateway, amount: amount.toFixed(2), currency, order_id: orderId });
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
    student_id: userId, amount, currency,
    payment_provider: `sifalo_${gateway}`, payment_status: 'paid',
    order_id: orderId, sifalo_sid: sid, gateway: `sifalo_${gateway}`,
    verification_status: 'verified', transaction_reference: orderId,
    gateway_response: data,
  };
  if (type === 'course') {
    paymentRow.course_id = referenceId;
  } else if (type === 'booking') {
    paymentRow.mentorship_session_id = referenceId;
  } else if (type === 'boost' || type === 'banner') {
    // Safe to leave course_id / mentorship_session_id NULL to avoid FK violations
  }

  const { error: payErr } = await supabase.from('payments').insert(paymentRow);
  if (payErr) {
    console.error('Payment insert error:', payErr);
    return err('Failed to record payment.', 500, payErr);
  }

  // Fetch settings for direct payment (which skips verifyTransaction)
  const { data: settings } = await supabase.rpc('get_platform_settings');
  const commEnabled = settings?.commission_enabled === true;
  const pPct = commEnabled ? (settings?.platform_percentage || 0) : 0;
  const iPct = commEnabled ? (settings?.instructor_percentage || 100) : 100;
  const fee = (amount * pPct) / 100;
  const share = (amount * iPct) / 100;

  if (type === 'course') {
    await supabase.from('enrollments').upsert(
      { student_id: userId, course_id: referenceId, enrolled_at: new Date().toISOString() },
      { onConflict: 'student_id,course_id', ignoreDuplicates: true }
    );

    const { data: course } = await supabase.from('courses').select('instructor_id').eq('id', referenceId).single();
    if (course?.instructor_id) {
       await supabase.from('instructor_earnings').upsert({
         instructor_id: course.instructor_id, payment_id: paymentRow.id || (await supabase.from('payments').select('id').eq('order_id', orderId).single()).data?.id, course_id: referenceId,
         earning_type: 'course', gross_amount: amount, platform_fee: fee, instructor_share: share, instructor_percentage_snapshot: iPct, platform_percentage_snapshot: pPct, currency
       }, { onConflict: 'payment_id' });
    }

    return json({ status: 'success', type: 'course', referenceId, sid, order_id: orderId });
  } else if (type === 'booking') {
    await supabase.from('mentorship_sessions').update({ booking_status: 'paid_waiting_review' }).eq('id', referenceId);
    const { data: session } = await supabase.from('mentorship_sessions').select('mentor_id').eq('id', referenceId).single();
    if (session?.mentor_id) {
        await supabase.from('instructor_earnings').upsert({
           instructor_id: session.mentor_id, payment_id: paymentRow.id || (await supabase.from('payments').select('id').eq('order_id', orderId).single()).data?.id, mentorship_session_id: referenceId,
           earning_type: 'mentorship', gross_amount: amount, platform_fee: fee, instructor_share: share, instructor_percentage_snapshot: iPct, platform_percentage_snapshot: pPct, currency
        }, { onConflict: 'payment_id' });
    }

    return json({ status: 'success', type: 'booking', referenceId, sid, order_id: orderId });
  } else if (type === 'boost' || type === 'banner') {
    // Execute the Postgres RPC to grant the feature
    const safePaymentId = paymentRow.id || (await supabase.from('payments').select('id').eq('order_id', orderId).single()).data?.id;
    if (type === 'boost') {
      const { error: boostErr } = await supabase.rpc('purchase_boost', {
        p_entity_type: payload.entityType || 'course',
        p_entity_id: referenceId,
        p_instructor_id: userId,
        p_plan_days: payload.planDays || 1,
        p_amount_paid: amount,
        p_payment_id: safePaymentId
      });
      if (boostErr) console.error('Failed to create boost record:', boostErr);
    } else {
      const { error: bannerErr } = await supabase.rpc('purchase_promo_banner', {
        p_entity_type: payload.entityType || 'course',
        p_entity_id: referenceId,
        p_instructor_id: userId,
        p_banner_text: payload.bannerText || '',
        p_plan_days: payload.planDays || 1,
        p_amount_paid: amount,
        p_payment_id: safePaymentId
      });
      if (bannerErr) console.error('Failed to create banner record:', bannerErr);
    }
    return json({ status: 'success', type, referenceId, sid, order_id: orderId });
  }

  return json({ status: 'failed', message: 'Unknown type' });
}

async function verifyTransaction(_userId: string, payload: VerifyPayload): Promise<Response> {
  const { orderId, sid } = payload;
  const supabase = adminClient();
  const { data: payment, error: fetchErr } = await supabase
    .from('payments')
    .select('id, student_id, course_id, mentorship_session_id, amount, payment_status, verification_status')
    .eq('order_id', orderId)
    .single();

  if (fetchErr || !payment) return err('Payment record not found', 404);
  
  // Note: boosts/banners don't set course_id/mentorship_session_id mapped on payment
  const determineTypeFromPayment = () => {
    if (payment.course_id) return 'course';
    if (payment.mentorship_session_id) return 'booking';
    // Without altering payments schema more deeply for redirect flow, if it's neither of those 2, we return boost or banner 
    // Usually redirect isn't used for boosts anyway, they mostly use EWallet / direct. But if they do we support ignoring mapping 
    return 'boost_or_banner'; 
  };
  
  const resolvedType = determineTypeFromPayment();

  if (payment.verification_status === 'verified' && payment.payment_status === 'paid') {
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

    // Fetch dynamic platform settings
    const { data: settings } = await supabase.rpc('get_platform_settings');
    const commEnabled = settings?.commission_enabled === true;
    const pPct = commEnabled ? (settings?.platform_percentage || 0) : 0;
    const iPct = commEnabled ? (settings?.instructor_percentage || 100) : 100;
      
    const fee = (payment.amount * pPct) / 100;
    const share = (payment.amount * iPct) / 100;

    if (resolvedType === 'course') {
       await supabase.from('enrollments').upsert({ student_id: payment.student_id, course_id: payment.course_id }, { onConflict: 'student_id,course_id' });
       
       // Record instructor earnings for course
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
      
      // Record instructor earnings for mentorship
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
       // Since the payload for createCheckout redirect doesn't pass up `bannerText` or `entityType` easily via callback directly yet, 
       // Ideally we don't dispatch redirect checkouts for boosts yet. E-Wallet handles it perfectly via direct params.
       // It just succeeds as 'paid' via Sifalo so the admin can verify.
       return json({ status: 'success', type: 'boost_or_banner', referenceId: 'unlinked_boost_redirect' });
    }
    return json({ status: 'success' });
  } else {
    await supabase.from('payments').update({ payment_status: 'failed', sifalo_sid: verifyData.sid ?? sid, gateway_response: verifyData, verification_status: 'failed' }).eq('id', payment.id);
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
    case 'createDirectPayment': return createDirectPayment(user.id, payload);
    case 'verifyTransaction':   return verifyTransaction(user.id, payload);
    default:                    return err(`Unknown action: ${action}`);
  }
});
