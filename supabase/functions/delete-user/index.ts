import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.46.1";

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing auth header' }), { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Authenticate user who made the request
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  // Verify caller is admin
  const { data: adminAccount } = await supabaseAdmin
    .from('admin_accounts')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (!adminAccount) {
    return new Response(JSON.stringify({ error: 'Forbidden: Admins only' }), { status: 403 });
  }

  try {
    const { user_id_to_delete } = await req.json();
    if (!user_id_to_delete) throw new Error("Missing user_id_to_delete");

    // Delete user from auth (cascades to profiles, auth.users)
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user_id_to_delete);
    if (deleteError) throw deleteError;

    return new Response(JSON.stringify({ success: true, message: 'User deleted successfully' }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 400 });
  }
});
