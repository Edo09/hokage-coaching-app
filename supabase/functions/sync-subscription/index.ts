// sync-subscription: the app asks the server to re-read ITS OWN subscription
// from RevenueCat, right after a purchase or a restore, or from Settings. It is
// the safety net for a webhook that was late or lost, and the same code the
// webhook uses (../_shared/subscription-sync.ts).
//
// Callers are the clients, so any signed-in user may call it; the user is the
// one in the token, never anything in the body. A call within 10 seconds of the
// last sync answers from what is stored. It answers { result, access }, where
// access is get_my_access(). Native app requests carry no Origin, so
// ../_shared/cors.ts lets them through.
//
// Needs the secret REVENUECAT_API_KEY (the project's SECRET API key; without it
// every call answers 503) and supabase/migrations/20261123120000_premium_access.sql.
//   supabase functions deploy sync-subscription --project-ref rzgwkwxskrovxnnymxqo

import { adminClient, callerClient } from '../_shared/coach.ts';
import { json, withCors } from '../_shared/cors.ts';
import { syncDeps } from '../_shared/subscription-deps.ts';
import { type OwnSyncDeps, syncOwnAccount } from '../_shared/subscription-sync.ts';

Deno.serve(withCors(async (req) => {
  try {
    const db = callerClient(req);
    const { data: { user } } = await db.auth.getUser();
    if (!user) return json({ error: 'unauthenticated' }, 401);

    const revenueCatKey = Deno.env.get('REVENUECAT_API_KEY');
    if (!revenueCatKey) {
      console.error('REVENUECAT_API_KEY is not set');
      return json({ error: 'not configured' }, 503);
    }

    const deps: OwnSyncDeps = {
      ...syncDeps(adminClient(), revenueCatKey),
      // Read as the caller: RLS lets a user read their own subscriptions row.
      lastSyncedAt: async (userId) => {
        const { data, error } = await db
          .from('subscriptions')
          .select('last_synced_at')
          .eq('user_id', userId)
          .maybeSingle();
        if (error) throw new Error(`subscriptions lookup failed: ${error.message}`);
        return data ? new Date(data.last_synced_at as string) : null;
      },
    };
    const result = await syncOwnAccount(deps, user.id);

    const { data: access, error } = await db.rpc('get_my_access');
    if (error) throw new Error(`get_my_access failed: ${error.message}`);
    return json({ result, access }, 200);
  } catch (e) {
    console.error('sync-subscription failed:', e);
    return json({ error: 'sync failed' }, 502);
  }
}));
