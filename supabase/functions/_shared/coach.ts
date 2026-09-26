// Helpers shared by the coach-only Edge Functions (create-client,
// reset-client-password): verify the caller is the coach, get a service-role
// client, and generate the one-time temporary passwords the coach hands out.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/** Whether the request's JWT belongs to the coach. Checked with the
 *  caller's own token + the anon key, so RLS applies to the lookup. */
export async function verifyCoach(req: Request): Promise<'coach' | 'unauthenticated' | 'forbidden'> {
  const caller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  );
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return 'unauthenticated';

  const { data: me } = await caller.from('profiles').select('role').eq('id', user.id).single();
  return me?.role === 'coach' ? 'coach' : 'forbidden';
}

/** Service-role client for the privileged work. The key is provided to
 *  functions automatically and never leaves the server. */
export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

/** Temporary password, returned ONCE to the coach who shares it with the
 *  client out-of-band (WhatsApp). The client signs in with it and changes it
 *  in the app's Ajustes screen. No lookalike characters (0/O, 1/l/I). */
export function tempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return 'Hkg-' + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
