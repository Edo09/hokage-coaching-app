// revenuecat-webhook: RevenueCat tells us something happened to a customer.
//
// Only RevenueCat calls it, with the Authorization header set in its dashboard
// (and, if configured, a signature). It sends no Supabase token, so it is
// deployed with --no-verify-jwt: the shared secret is the only way in.
//
// An event is only a signal. The function records it once (idempotent by event
// id), re-reads the customer from RevenueCat's REST API and stores what that
// says in public.subscriptions through apply_subscription_snapshot, so nothing
// in the payload ever decides access (see ../_shared/revenuecat.ts and
// docs/ADMIN_WEB_DB_CONNECTION.md §6.7). RevenueCat counts only HTTP 200 as
// delivered and retries a few times otherwise: 200 means handled, ignored,
// repeated or about a user we do not know; 5xx means the database or
// RevenueCat's API failed.
//
// Secrets (supabase secrets set … --project-ref rzgwkwxskrovxnnymxqo):
//   REVENUECAT_WEBHOOK_SECRET          the value of the Authorization header
//   REVENUECAT_API_KEY                 the project's SECRET API key (sk_…)
//   REVENUECAT_WEBHOOK_SIGNING_SECRET  optional: also require the signature
// Apply supabase/migrations/20261123120000_premium_access.sql first.

import { adminClient } from '../_shared/coach.ts';
import { json } from '../_shared/cors.ts';
import { syncDeps } from '../_shared/subscription-deps.ts';
import { handleWebhook, type WebhookDeps } from '../_shared/subscription-sync.ts';

Deno.serve(async (req) => {
  const admin = adminClient();
  const deps: WebhookDeps = {
    ...syncDeps(admin, Deno.env.get('REVENUECAT_API_KEY')),
    secret: Deno.env.get('REVENUECAT_WEBHOOK_SECRET'),
    signingSecret: Deno.env.get('REVENUECAT_WEBHOOK_SIGNING_SECRET'),

    recordEvent: async (event, payload) => {
      const { data, error } = await admin.rpc('record_revenuecat_event', {
        p_event_id: event.id,
        p_event_type: event.type,
        p_app_user_id: typeof event.app_user_id === 'string' ? event.app_user_id : null,
        p_event_at:
          typeof event.event_timestamp_ms === 'number' ? new Date(event.event_timestamp_ms).toISOString() : null,
        p_payload: payload,
      });
      if (error) throw new Error(`record_revenuecat_event failed: ${error.message}`);
      if (data !== 'new' && data !== 'repeat_done' && data !== 'repeat_retry') {
        throw new Error(`record_revenuecat_event answered ${JSON.stringify(data)}`);
      }
      return data;
    },

    finishEvent: async (eventId, outcome, error) => {
      const { error: failure } = await admin.rpc('finish_revenuecat_event', {
        p_event_id: eventId,
        p_outcome: outcome,
        p_error: error ?? null,
      });
      if (failure) throw new Error(`finish_revenuecat_event failed: ${failure.message}`);
    },

    existingProfiles: async (ids) => {
      const { data, error } = await admin.from('profiles').select('id').in('id', ids);
      if (error) throw new Error(`profiles lookup failed: ${error.message}`);
      return new Set((data ?? []).map((row: { id: string }) => row.id));
    },
  };

  const res = await handleWebhook(deps, {
    method: req.method,
    authorization: req.headers.get('Authorization'),
    signature: req.headers.get('X-RevenueCat-Webhook-Signature'),
    rawBody: await req.text(),
  });
  return json(res.body, res.status);
});
