// Coach Admin Panel — creates a client login. The only operation the panel
// cannot do with the anon key: auth.admin.createUser needs the service-role
// key, which must never reach the browser. See docs/ADMIN_WEB_DB_CONNECTION.md §6.
//
// Deploy (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are
// provided to functions automatically):
//   supabase functions deploy create-client --project-ref rzgwkwxskrovxnnymxqo
// and set ALLOWED_ORIGINS once for the project (see ../_shared/cors.ts).

import { verifyCoach, adminClient, tempPassword } from '../_shared/coach.ts';
import { json, withCors } from '../_shared/cors.ts';

Deno.serve(withCors(async (req) => {
  try {
    const caller = await verifyCoach(req);
    if (caller === 'unauthenticated') return json({ error: 'unauthenticated' }, 401);
    if (caller === 'forbidden') return json({ error: 'forbidden' }, 403);

    const { email, display_name } = await req.json();
    if (typeof email !== 'string' || !email.includes('@')) {
      return json({ error: 'a valid email is required' }, 400);
    }

    // (The previous generateLink approach produced a link but never delivered
    // it anywhere — no email is sent by generateLink, and the app has no web
    // recovery flow — hence the temporary password.)
    const admin = adminClient();
    const temp_password = tempPassword();

    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: temp_password,
      email_confirm: true,
      user_metadata: { display_name },
    });
    if (error) return json({ error: error.message }, 400);

    // handle_new_user creates the profiles row (role defaults to 'user') and
    // the email-sync trigger fills in profiles.email — both run server-side
    // as part of this same createUser call, before we respond.
    if (display_name && created.user) {
      await admin.from('profiles').update({ display_name }).eq('id', created.user.id);
    }

    return json({ user_id: created.user?.id, temp_password }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}));
