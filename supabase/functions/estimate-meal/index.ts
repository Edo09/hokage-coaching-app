// estimate-meal: the server's estimate of one registered meal.
//
// Only the database calls it (pg_net), from the triggers and the pg_cron jobs
// in migration 20261105120000_meal_registrations.sql, with the body
// { id, version } and the header x-estimate-secret. It answers 202 at once and
// works in the background: pg_net stops waiting after a few seconds, and a
// model call with a photo can take 30 s or more.
//
// Deployed with --no-verify-jwt, since the database carries no user JWT; the
// shared secret is the only way in. Set it as a function secret and, with the
// same value, in Vault as estimate_meal_secret (docs/ADMIN_WEB_DB_CONNECTION.md
// §6.6):
//   supabase secrets set ESTIMATE_MEAL_SECRET=... --project-ref rzgwkwxskrovxnnymxqo
// ESTIMATE_FAIL_USER_ID (optional, for testing): that client's estimates fail
// as a provider failure would, without calling the model.

import { adminClient } from '../_shared/coach.ts';
import { json } from '../_shared/cors.ts';
import { estimateRegistration } from './estimate.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Compares two secrets in time that doesn't depend on where they differ. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const secret = Deno.env.get('ESTIMATE_MEAL_SECRET');
  if (!secret) {
    console.error('ESTIMATE_MEAL_SECRET is not set');
    return json({ error: 'not configured' }, 503);
  }
  if (!sameSecret(req.headers.get('x-estimate-secret') ?? '', secret)) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid request' }, 400);
  }
  const { id, version } = (body ?? {}) as { id?: unknown; version?: unknown };
  if (typeof id !== 'string' || !UUID.test(id) || typeof version !== 'number' || !Number.isSafeInteger(version)) {
    return json({ error: 'invalid request' }, 400);
  }

  EdgeRuntime.waitUntil(
    estimateRegistration(adminClient(), id, version).catch((e) => console.error('estimate-meal failed:', e)),
  );
  return json({ accepted: true }, 202);
});
