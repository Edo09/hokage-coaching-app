// The real I/O behind SyncDeps (subscription-sync.ts), shared by the two
// functions that re-read a customer from RevenueCat: revenuecat-webhook and
// sync-subscription. Deno only (it talks to Supabase), so it has no unit test;
// the logic it serves is tested through the fakes in
// src/utils/subscription-sync.test.ts and the writer by
// supabase/scripts/smoke_premium.sql.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { makeSubscriberFetcher } from './revenuecat-client.ts';
import type { ApplyResult, SyncDeps } from './subscription-sync.ts';

const RESULTS: ReadonlySet<string> = new Set(['applied', 'stale', 'skipped']);

/**
 * RevenueCat for the reading, apply_subscription_snapshot (service role only)
 * for the writing. With no key the reading fails, which RevenueCat retries and
 * the event log records, instead of crashing the function.
 */
export function syncDeps(admin: SupabaseClient, revenueCatKey: string | undefined): SyncDeps {
  return {
    now: () => new Date(),
    fetchSubscriber: revenueCatKey
      ? makeSubscriberFetcher(revenueCatKey)
      : async () => {
          throw new Error('REVENUECAT_API_KEY is not set');
        },
    applySnapshot: async (userId, patch, fetchedAt, eventId, eventAt) => {
      const { data, error } = await admin.rpc('apply_subscription_snapshot', {
        p_user: userId,
        p_patch: patch,
        p_fetched_at: fetchedAt.toISOString(),
        p_event_id: eventId,
        p_event_at: eventAt === null ? null : eventAt.toISOString(),
      });
      if (error) throw new Error(`apply_subscription_snapshot failed: ${error.message}`);
      if (typeof data !== 'string' || !RESULTS.has(data)) {
        throw new Error(`apply_subscription_snapshot answered ${JSON.stringify(data)}`);
      }
      return data as ApplyResult;
    },
  };
}
