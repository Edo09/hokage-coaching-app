// The logic behind the revenuecat-webhook and sync-subscription Edge Functions.
// The database and RevenueCat's API are passed in, so src/utils/subscription-sync.test.ts
// runs it with fakes; the functions' index.ts files only wire the real ones.
// It imports only its sibling modules, so Deno and `npm test` both load it.
//
// Nothing here trusts a payload for access: an event says whom to look at,
// RevenueCat's REST API says what is true (see revenuecat.ts).

import { sameSecret, verifySignature } from './secret.ts';
import { parseWebhook, patchFromSubscriber, planEvent, type RcEvent, type SubscriptionPatch } from './revenuecat.ts';

export type ApplyResult = 'applied' | 'stale' | 'skipped';
export type EventOutcome = 'synced' | 'ignored' | 'unknown_user' | 'failed';

export type SyncDeps = {
  now(): Date;
  /** RevenueCat's `subscriber` for this app user id. Throws when RevenueCat does not answer 2xx. */
  fetchSubscriber(appUserId: string): Promise<unknown>;
  /** apply_subscription_snapshot. */
  applySnapshot(
    userId: string,
    patch: SubscriptionPatch,
    fetchedAt: Date,
    eventId: string | null,
    eventAt: Date | null,
  ): Promise<ApplyResult>;
};

/**
 * Re-reads one user from RevenueCat and stores the answer. The fetch time is
 * read BEFORE asking, so a slow, older answer can never be stored over a newer
 * one (the database refuses an older fetch). Throws when RevenueCat fails.
 */
export async function syncUser(
  deps: SyncDeps,
  userId: string,
  eventId: string | null = null,
  eventAt: Date | null = null,
): Promise<ApplyResult> {
  const fetchedAt = deps.now();
  const subscriber = await deps.fetchSubscriber(userId);
  return deps.applySnapshot(userId, patchFromSubscriber(subscriber, userId, fetchedAt), fetchedAt, eventId, eventAt);
}

export type WebhookDeps = SyncDeps & {
  /** REVENUECAT_WEBHOOK_SECRET; unset answers 503. */
  secret: string | undefined;
  /** REVENUECAT_WEBHOOK_SIGNING_SECRET; when set, a valid signature is required too. */
  signingSecret: string | undefined;
  /** record_revenuecat_event. */
  recordEvent(event: RcEvent, payload: unknown): Promise<'new' | 'repeat_done' | 'repeat_retry'>;
  /** finish_revenuecat_event. */
  finishEvent(eventId: string, outcome: EventOutcome, error?: string): Promise<void>;
  /** Which of these ids are profiles. */
  existingProfiles(ids: string[]): Promise<Set<string>>;
};

export type WebhookRequest = {
  method: string;
  authorization: string | null;
  signature: string | null;
  rawBody: string;
};
export type WebhookResponse = { status: number; body: Record<string, unknown> };

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): WebhookResponse => ({
  status,
  body: { error, ...extra },
});
const ok = (extra: Record<string, unknown> = {}): WebhookResponse => ({ status: 200, body: { ok: true, ...extra } });
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * One webhook delivery. RevenueCat counts only HTTP 200 as delivered and
 * retries a few times otherwise, so 200 means «handled, ignored, repeated, or
 * about nobody we know» and 5xx means «the database or RevenueCat's API
 * failed: try again».
 */
export async function handleWebhook(deps: WebhookDeps, req: WebhookRequest): Promise<WebhookResponse> {
  if (req.method !== 'POST') return fail(405, 'method not allowed');
  if (!deps.secret) return fail(503, 'not configured');
  if (!sameSecret(req.authorization ?? '', deps.secret)) return fail(401, 'unauthorized');
  if (deps.signingSecret) {
    const nowSeconds = Math.floor(deps.now().getTime() / 1000);
    if (!(await verifySignature(req.signature, req.rawBody, deps.signingSecret, nowSeconds))) {
      return fail(401, 'unauthorized');
    }
  }

  let body: unknown;
  try {
    body = JSON.parse(req.rawBody);
  } catch {
    return fail(400, 'invalid request', { reason: 'the body is not JSON' });
  }
  const parsed = parseWebhook(body);
  if (!parsed.ok) return fail(400, 'invalid request', { reason: parsed.reason });
  const event = parsed.event;

  try {
    const seen = await deps.recordEvent(event, body);
    if (seen === 'repeat_done') return ok({ duplicate: true });

    const plan = planEvent(event);
    if (plan.action !== 'sync') {
      await deps.finishEvent(event.id, 'ignored');
      return ok({ action: plan.action });
    }

    // Only a real profile is looked up: RevenueCat creates a customer for any
    // id it is asked about.
    const known = plan.userIds.length > 0 ? await deps.existingProfiles(plan.userIds) : new Set<string>();
    const targets = plan.userIds.filter((id) => known.has(id));
    if (targets.length === 0) {
      await deps.finishEvent(event.id, 'unknown_user');
      return ok({ action: 'unknown_user' });
    }

    const eventAt = typeof event.event_timestamp_ms === 'number' ? new Date(event.event_timestamp_ms) : null;
    const failures: string[] = [];
    for (const id of targets) {
      try {
        await syncUser(deps, id, event.id, eventAt);
      } catch (e) {
        failures.push(`${id}: ${message(e)}`);
      }
    }
    if (failures.length > 0) {
      await deps.finishEvent(event.id, 'failed', failures.join('; '));
      return fail(500, 'sync failed');
    }
    await deps.finishEvent(event.id, 'synced');
    return ok({ synced: targets.length });
  } catch (e) {
    console.error('revenuecat-webhook failed:', message(e));
    return fail(500, 'internal error');
  }
}

export type OwnSyncDeps = SyncDeps & {
  /**
   * take_subscription_sync: true when this user may sync now (and the slot is
   * stamped), false when they took it a few seconds ago. Held per user, not on
   * the subscription row, so it also holds for a user who has none yet.
   */
  takeSlot(userId: string): Promise<boolean>;
};

/** sync-subscription: re-reads the caller's own account, unless they synced a moment ago. */
export async function syncOwnAccount(deps: OwnSyncDeps, userId: string): Promise<'cooldown' | ApplyResult> {
  if (!(await deps.takeSlot(userId))) return 'cooldown';
  return syncUser(deps, userId);
}
