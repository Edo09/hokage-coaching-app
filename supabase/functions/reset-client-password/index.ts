// Coach Admin Panel — gives a client who forgot their password a new
// temporary one. There is no self-service recovery (no email is ever sent),
// so the coach resets it here and shares the new password over WhatsApp,
// exactly like when the account was created (see ../create-client).
//
// Deploy (service-role key etc. are provided to functions automatically):
//   supabase functions deploy reset-client-password --project-ref rzgwkwxskrovxnnymxqo
// and set ALLOWED_ORIGINS once for the project (see ../_shared/cors.ts).

import { verifyCoach, adminClient, tempPassword } from '../_shared/coach.ts';
import { json, withCors } from '../_shared/cors.ts';

Deno.serve(withCors(async (req) => {
  try {
    const caller = await verifyCoach(req);
    if (caller === 'unauthenticated') return json({ error: 'unauthenticated' }, 401);
    if (caller === 'forbidden') return json({ error: 'forbidden' }, 403);

    const { user_id } = await req.json();
    if (typeof user_id !== 'string' || user_id === '') {
      return json({ error: 'user_id is required' }, 400);
    }

    const admin = adminClient();

    // Clients only: this must never become a way to take over a coach account.
    const { data: target, error: lookupError } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user_id)
      .maybeSingle();
    if (lookupError) return json({ error: lookupError.message }, 500);
    if (!target) return json({ error: 'client not found' }, 404);
    if (target.role !== 'user') return json({ error: 'only client passwords can be reset' }, 403);

    const temp_password = tempPassword();
    const { error } = await admin.auth.admin.updateUserById(user_id, { password: temp_password });
    if (error) return json({ error: error.message }, 400);

    return json({ temp_password }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}));
