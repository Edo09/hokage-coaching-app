// RevenueCat's webhook and customer, for the revenuecat-webhook and
// sync-subscription Edge Functions. Pure, with no imports, so Deno and `npm
// test` both load it (src/utils/revenuecat.test.ts).
//
// The webhook only says WHO to look at. What is true about them is read from
// RevenueCat's REST API (GET /v1/subscribers/{app_user_id}) and turned into a
// subscriptions row by patchFromSubscriber, so nothing in an event payload
// ever decides access: a leaked webhook secret or a replayed event can only
// cause a harmless re-read. The rules are the design's mapping table
// (docs/superpowers/specs/2026-11-16-premium-subscriptions-design.md).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The entitlement the app sells: its identifier in the RevenueCat dashboard. */
export const ENTITLEMENT_ID = 'premium_access';

export function isUuid(s: string): boolean {
  return UUID.test(s);
}

export type RcEvent = {
  id: string;
  type: string;
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  transferred_from?: string[];
  transferred_to?: string[];
  event_timestamp_ms?: number;
  [k: string]: unknown;
};

export function parseWebhook(body: unknown): { ok: true; event: RcEvent } | { ok: false; reason: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, reason: 'the body is not an object' };
  const event = (body as { event?: unknown }).event;
  if (typeof event !== 'object' || event === null) return { ok: false, reason: 'the body has no event' };
  const e = event as Record<string, unknown>;
  if (typeof e.id !== 'string' || e.id === '') return { ok: false, reason: 'the event has no id' };
  if (typeof e.type !== 'string' || e.type === '') return { ok: false, reason: 'the event has no type' };
  return { ok: true, event: e as RcEvent };
}

/**
 * The event types that have nothing to do with a subscription's access. Every
 * other type, including one RevenueCat adds later, re-reads the customer: a
 * re-read is harmless (the payload never decides access), while a missed one
 * leaves a wrong access in the database.
 */
const IGNORED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'EXPERIMENT_ENROLLMENT',
  'VIRTUAL_CURRENCY_TRANSACTION',
  'INVOICE_ISSUANCE',
]);

export type EventPlan =
  | { action: 'ack' }
  | { action: 'ignore' }
  | { action: 'sync'; userIds: string[]; unknownIds: string[] };

const strings = (x: unknown): string[] =>
  Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : [];

/**
 * What to do with an event: acknowledge a test, ignore a type that has nothing
 * to do with a subscription, or re-read the customers it concerns. Only UUIDs
 * can be a Supabase user; any other id (an anonymous RevenueCat id) is returned
 * as unknown. A transfer carries no app_user_id: both ends are in its arrays.
 */
export function planEvent(event: RcEvent): EventPlan {
  if (event.type === 'TEST') return { action: 'ack' };
  if (IGNORED_EVENT_TYPES.has(event.type)) return { action: 'ignore' };

  const ids: string[] =
    event.type === 'TRANSFER'
      ? [...strings(event.transferred_from), ...strings(event.transferred_to)]
      : [...strings([event.app_user_id]), ...strings([event.original_app_user_id]), ...strings(event.aliases)];

  const userIds: string[] = [];
  const unknownIds: string[] = [];
  for (const id of ids) {
    const bucket = isUuid(id) ? userIds : unknownIds;
    if (!bucket.includes(id)) bucket.push(id);
  }
  return { action: 'sync', userIds, unknownIds };
}

/** What a sync writes to the subscriptions row (see apply_subscription_snapshot). */
export type SubscriptionPatch = {
  product_id: string | null;
  store: string | null;
  environment: 'production' | 'sandbox';
  status: 'active' | 'cancelled' | 'billing_issue' | 'expired';
  is_premium: boolean;
  will_renew: boolean;
  started_at: string | null;
  current_period_started_at: string | null;
  expires_at: string | null;
  grace_expires_at: string | null;
  /** The end of access; 'infinity' for an open-ended grant. */
  access_until: string;
  rc_app_user_id: string;
};

type Bag = Record<string, unknown>;
const obj = (x: unknown): Bag =>
  typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Bag) : {};
const str = (x: unknown): string | null => (typeof x === 'string' && x !== '' ? x : null);
const date = (x: unknown): Date | null => {
  const s = str(x);
  if (s === null) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
};
const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());
const later = (a: Date | null, b: Date | null): Date | null =>
  a === null ? b : b === null ? a : a.getTime() >= b.getTime() ? a : b;

/** The product bought last, for a customer whose entitlement is gone. */
function newestProduct(subscriptions: Bag): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const [key, value] of Object.entries(subscriptions)) {
    const ms = date(obj(value).purchase_date)?.getTime() ?? 0;
    if (best === null || ms > bestMs) {
      best = key;
      bestMs = ms;
    }
  }
  return best;
}

/**
 * What RevenueCat's `subscriber` (from GET /v1/subscribers/{id}) means for the
 * row. Access is the `premium_access` entitlement being live: open-ended, or
 * its end (or its grace end) still ahead, and not refunded. Fails closed: an
 * entitlement that does not say when it ends (no `expires_date` key at all) is
 * not access, while an explicit null is an open-ended grant. Never throws.
 */
export function patchFromSubscriber(subscriber: unknown, appUserId: string, now: Date): SubscriptionPatch {
  const root = obj(subscriber);
  const entitlement = obj(obj(root.entitlements)[ENTITLEMENT_ID]);
  const subscriptions = obj(root.subscriptions);
  const hasEntitlement = Object.keys(entitlement).length > 0;

  const productId = str(entitlement.product_identifier) ?? newestProduct(subscriptions);
  const sub = productId === null ? {} : obj(subscriptions[productId]);

  // Strictly null: a missing key is not an open-ended grant.
  const openEnded = hasEntitlement && entitlement.expires_date === null;
  const entExpires = date(entitlement.expires_date);
  const subExpires = date(sub.expires_date);
  const grace = date(entitlement.grace_period_expires_date) ?? date(sub.grace_period_expires_date);
  const refunded = str(sub.refunded_at) !== null;

  const nowMs = now.getTime();
  const live =
    hasEntitlement &&
    !refunded &&
    (openEnded ||
      (entExpires !== null && entExpires.getTime() > nowMs) ||
      (grace !== null && grace.getTime() > nowMs));

  // The latest end we know of. Once access is gone it is clamped to now, so a
  // refund (a future period end, but no access) counts its grace from here.
  const end = later(entExpires ?? subExpires, grace);
  let accessUntil: string;
  if (live && openEnded) accessUntil = 'infinity';
  else if (live && end !== null) accessUntil = end.toISOString();
  else accessUntil = (end !== null && end.getTime() < nowMs ? end : now).toISOString();

  const status: SubscriptionPatch['status'] = !live
    ? 'expired'
    : str(sub.billing_issues_detected_at) !== null
      ? 'billing_issue'
      : str(sub.unsubscribe_detected_at) !== null
        ? 'cancelled'
        : 'active';

  return {
    product_id: productId,
    store: str(sub.store) ?? (hasEntitlement ? 'unknown' : null),
    environment: sub.is_sandbox === true ? 'sandbox' : 'production',
    status,
    is_premium: live,
    will_renew: status === 'active',
    started_at: iso(date(sub.original_purchase_date) ?? date(entitlement.purchase_date)),
    current_period_started_at: iso(date(sub.purchase_date) ?? date(entitlement.purchase_date)),
    expires_at: iso(entExpires ?? subExpires),
    grace_expires_at: iso(grace),
    access_until: accessUntil,
    rc_app_user_id: appUserId,
  };
}
