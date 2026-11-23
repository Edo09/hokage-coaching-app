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

    const admin = adminClient();
    const deps: OwnSyncDeps = {
      ...syncDeps(admin, revenueCatKey),
      takeSlot: async (userId) => {
        const { data, error } = await admin.rpc('take_subscription_sync', {
          p_user: userId,
          p_cooldown_seconds: 10,
        });
        if (error) throw new Error(`take_subscription_sync failed: ${error.message}`);
        return data === true;
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
