import type {
  AccessSource,
  ContentRequest,
  ContentRequestKind,
  MembershipStatus,
  MyAccess,
  MyAccessSubscription,
  SubscriptionStatus,
} from "@/src/types/database";

// The rules behind every Premium screen (docs/superpowers/specs/
// 2026-11-16-premium-subscriptions-design.md, «The app»). No React, no Expo, no
// I/O and no clock: `now` is always passed in, so `npm test` pins them. The
// hooks read the server's answer (rpc get_my_access) and these functions say
// what it means; the app never decides access on its own.

/** What a screen needs to know about the client's access. */
export type AccessState =
  /** No answer yet. */
  | "loading"
  /** The switch is off: everyone counts as active, nothing is locked. */
  | "open"
  | "active"
  /** A subscription that has stopped renewing but has not ended. */
  | "cancelled_active"
  /** A billing problem: the store is retrying, access goes on until the grace ends. */
  | "grace"
  /** Switch on and no access (never had it, or it ended). */
  | "lapsed";

/**
 * What the app assumes when it cannot read the answer at all (first launch
 * offline, a failed call, nothing cached): nobody is ever locked by a guess.
 */
export const OPEN_ACCESS: MyAccess = {
  enforced: false,
  has_access: true,
  source: "open",
  access_ends_at: null,
  subscription: null,
  membership: null,
  has_program: false,
  has_nutrition_plan: false,
  has_supplement_plan: false,
};

/** The longest delay setTimeout holds (2^31 - 1 ms, about 24.8 days): a longer
    one overflows and fires at once. */
export const MAX_TIMEOUT_MS = 2_147_483_647;

const SOURCES: readonly string[] = ["coach", "subscription", "membership", "open"];
const SUBSCRIPTION_STATUSES: readonly string[] = ["active", "cancelled", "billing_issue", "expired"];
const MEMBERSHIP_STATUSES: readonly string[] = ["active", "expired", "paused", "cancelled"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** A timestamp in ms; null for null, "infinity" or anything unparsable. */
function timeOf(iso: string | null): number | null {
  if (iso == null) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function parseSubscription(raw: unknown): MyAccessSubscription | null {
  if (!isRecord(raw)) return null;
  return {
    status: SUBSCRIPTION_STATUSES.includes(raw.status as string)
      ? (raw.status as SubscriptionStatus)
      : "expired",
    store: text(raw.store) ?? "",
    product_id: text(raw.product_id) ?? "",
    environment: raw.environment === "sandbox" ? "sandbox" : "production",
    is_premium: raw.is_premium === true,
    will_renew: raw.will_renew === true,
    started_at: text(raw.started_at),
    current_period_started_at: text(raw.current_period_started_at),
    expires_at: text(raw.expires_at),
    grace_expires_at: text(raw.grace_expires_at),
    access_until: text(raw.access_until) ?? "",
    last_synced_at: text(raw.last_synced_at) ?? "",
  };
}

function parseMembership(raw: unknown): MyAccess["membership"] {
  if (!isRecord(raw) || !MEMBERSHIP_STATUSES.includes(raw.status as string)) return null;
  return { status: raw.status as MembershipStatus, expires_at: text(raw.expires_at) };
}

/**
 * The jsonb of get_my_access() as a MyAccess; null when it is not an answer
 * (signed out). Strict about what it reads and fails open: an answer that
 * does not say `enforced: true` locks nobody.
 */
export function parseMyAccess(raw: unknown): MyAccess | null {
  if (!isRecord(raw)) return null;
  const enforced = raw.enforced === true;
  const source = SOURCES.includes(raw.source as string) ? (raw.source as AccessSource) : null;
  return {
    enforced,
    has_access: enforced ? raw.has_access === true : true,
    source: source ?? (enforced ? null : "open"),
    access_ends_at: text(raw.access_ends_at),
    subscription: parseSubscription(raw.subscription),
    membership: parseMembership(raw.membership),
    has_program: raw.has_program === true,
    has_nutrition_plan: raw.has_nutrition_plan === true,
    has_supplement_plan: raw.has_supplement_plan === true,
  };
}

/**
 * The answer to build screens from. A cached answer always wins; with none,
 * the first fetch in flight is «loading» (null), but a phone that is offline
 * or whose fetch failed gets OPEN_ACCESS, so a client the app cannot read is
 * never locked or sent to the paywall by a guess. The database enforces the
 * real rule anyway.
 */
export function effectiveAccess(
  cached: MyAccess | null,
  query: { pending: boolean; paused: boolean },
): MyAccess | null {
  if (cached != null) return cached;
  if (query.pending && !query.paused) return null;
  return OPEN_ACCESS;
}

/** How long past its period end a renewing subscription still counts on the
    local clock when the app has not heard of the renewal (a late webhook, a
    phone with no signal). The database gives content the same 72 h
    (premium_content_access), so a renewal that is a little late does not take
    the program away. */
export const RENEWAL_GRACE_MS = 72 * 3_600_000;

/** After a renewing subscription's period end, how long the store's
    notification and RevenueCat's webhook are given to reach the server before
    the app looks for the renewal itself. */
export const RENEWAL_SETTLE_MS = 5 * 60_000;

/** What decides whether a subscription is expected to renew. */
export type RenewalView = {
  source?: MyAccess["source"];
  subscription?: Pick<MyAccessSubscription, "status" | "will_renew"> | null;
};

/**
 * Access comes from a store subscription that is active and set to renew: its
 * period end is a date the store is expected to move, not a point where access
 * stops. A cancelled subscription, a billing problem, a membership and a
 * coach-set end are hard ends.
 */
export function isRenewing(access: RenewalView): boolean {
  const subscription = access.subscription;
  return (
    access.source === "subscription" &&
    subscription != null &&
    subscription.status === "active" &&
    subscription.will_renew
  );
}

/**
 * Access right now: the server says yes and, by the local clock, it has not
 * ended. A renewing subscription's period end is not an end: the answer in hand
 * is stale until the renewal reaches the app, so it counts for RENEWAL_GRACE_MS
 * more. A fresh answer that says no always wins (`has_access` false).
 */
export function hasAccessNow(access: MyAccess, now: Date): boolean {
  if (!access.has_access) return false;
  const ends = timeOf(access.access_ends_at);
  if (ends == null) return true;
  const t = now.getTime();
  if (ends > t) return true;
  return isRenewing(access) && t < ends + RENEWAL_GRACE_MS;
}

export function accessState(access: MyAccess | null, now: Date): AccessState {
  if (access == null) return "loading";
  if (!access.enforced) return "open";
  if (!hasAccessNow(access, now)) return "lapsed";
  if (access.source === "subscription" && access.subscription != null) {
    if (access.subscription.status === "billing_issue") return "grace";
    if (access.subscription.status === "cancelled") return "cancelled_active";
  }
  return "active";
}

/** A store subscription grants access right now (whether or not the switch is on). */
export function isSubscribed(access: MyAccess | null, now: Date): boolean {
  const subscription = access?.subscription;
  if (subscription == null || !subscription.is_premium) return false;
  if (subscription.access_until === "infinity") return true;
  const until = timeOf(subscription.access_until);
  return until != null && until > now.getTime();
}

/**
 * How long to wait before the screen must be worked out again because access
 * ends, or null when nothing is waiting. For access that does not renew that is
 * its end; for a renewing subscription it is first the moment the store's
 * notification has had RENEWAL_SETTLE_MS to arrive (when the app looks for the
 * renewal, see needsRenewalSync) and then the end of RENEWAL_GRACE_MS. Just
 * after the boundary, and never more than setTimeout can hold: the caller
 * re-arms when it fires.
 */
export function msUntilAccessEnds(access: MyAccess | null, now: Date): number | null {
  if (access == null || !access.enforced || !access.has_access) return null;
  const ends = timeOf(access.access_ends_at);
  if (ends == null) return null;
  const t = now.getTime();
  const boundaries = isRenewing(access)
    ? [ends + RENEWAL_SETTLE_MS, ends + RENEWAL_GRACE_MS]
    : [ends];
  const next = boundaries.find((boundary) => boundary > t);
  if (next == null) return null;
  return Math.min(next - t + 1, MAX_TIMEOUT_MS);
}

/**
 * A subscription the store should have renewed, and the answer in hand still
 * holds the old period: the renewal has not reached the app, or the server
 * never heard of it (a lost webhook). The cue to read the answer again and, if
 * it is still the old one, to ask sync-subscription to re-read the store.
 * True once the store's notification has had RENEWAL_SETTLE_MS; false while
 * the switch is off, and for anything the store will not renew. It does not
 * look at `has_access`: a paying client the server has already locked out,
 * because its row never moved, is the one that needs the repair most.
 */
export function needsRenewalSync(access: MyAccess | null, now: Date): boolean {
  if (access == null || !access.enforced) return false;
  const subscription = access.subscription;
  if (subscription == null || subscription.status !== "active" || !subscription.will_renew) {
    return false;
  }
  const until = timeOf(subscription.access_until);
  return until != null && until + RENEWAL_SETTLE_MS <= now.getTime();
}

/** The three things the coach assigns. Supplements follow the nutrition gate. */
export type GateKind = "program" | "nutrition_plan" | "supplement_plan";

/** The request a gate can make; supplements have none of their own. */
export function requestKindOf(gate: GateKind): ContentRequestKind | null {
  if (gate === "program") return "program";
  if (gate === "nutrition_plan") return "nutrition_plan";
  return null;
}

/** What a tab shows in place of (or as) the coach's content. */
export type ContentGate =
  | { kind: "loading" }
  | { kind: "content" }
  | { kind: "empty"; action: "request" | "paywall" | null }
  | { kind: "pending"; since: string }
  | { kind: "locked" };

export type ShownGate = Exclude<ContentGate, { kind: "loading" | "content" }>;

const FLAG: Record<GateKind, "has_program" | "has_nutrition_plan" | "has_supplement_plan"> = {
  program: "has_program",
  nutrition_plan: "has_nutrition_plan",
  supplement_plan: "has_supplement_plan",
};

/**
 * The spec's table of screen states. `hasContent` is the real content in
 * hand (the query returned a row); for a client without access it is ignored,
 * because a cached copy must not outlive the access, and the has_* flag says
 * whether something is assigned behind the lock.
 */
export function contentGate(i: {
  gate: GateKind;
  state: AccessState;
  access: MyAccess | null;
  hasContent: boolean;
  pending: ContentRequest | null;
  /** The client's requests are still being read: a request button would flash
      before «Solicitud enviada», so nothing is offered yet. */
  requestsLoading?: boolean;
  /** Offer requests while the switch is off (`open`). Only a dev client does:
      the panel (plan 3) cannot yet show the coach who asked for what, so a
      release build keeps today's plain empty state until the switch is on. */
  requestsEnabledWhileOpen?: boolean;
}): ContentGate {
  const {
    gate,
    state,
    access,
    hasContent,
    pending,
    requestsLoading = false,
    requestsEnabledWhileOpen = false,
  } = i;
  if (state === "loading") return hasContent ? { kind: "content" } : { kind: "loading" };

  if (state === "lapsed") {
    if (access != null && access[FLAG[gate]]) return { kind: "locked" };
    return { kind: "empty", action: requestKindOf(gate) == null ? null : "paywall" };
  }

  // open, active, cancelled_active, grace: the client has access.
  if (hasContent) return { kind: "content" };
  // The coach is refused by request_content, and supplements have no request.
  if (access?.source === "coach" || requestKindOf(gate) == null) {
    return { kind: "empty", action: null };
  }
  // The switch is off: nothing changes for anyone, so no request is offered
  // (nor a pending one shown) unless this is a dev client testing them.
  if (state === "open" && !requestsEnabledWhileOpen) return { kind: "empty", action: null };
  if (pending != null) return { kind: "pending", since: pending.created_at };
  if (requestsLoading) return { kind: "loading" };
  return { kind: "empty", action: "request" };
}

/** The newest still-pending request of a kind. */
export function pendingRequest(
  requests: readonly ContentRequest[],
  kind: ContentRequestKind,
): ContentRequest | null {
  let newest: ContentRequest | null = null;
  for (const r of requests) {
    if (r.kind !== kind || r.status !== "pending") continue;
    if (newest == null || r.created_at > newest.created_at) newest = r;
  }
  return newest;
}

export type GateCopy = {
  icon: "ribbon-outline" | "nutrition-outline" | "medkit-outline" | "lock-closed-outline" | "time-outline";
  /** i18n keys, rendered by the view (the plan is language-free, like the reminders'). */
  titleKey: string;
  hintKey: string;
  actionKey: string | null;
  /** What the button does: open the request sheet or the paywall. */
  action: "request" | "paywall" | null;
  /** «Enviada el {{date}}»: the view fills the date. */
  footnoteKey: string | null;
  /** Nothing to offer: the app's own empty state, as before Premium. Home's
      card then shows the hint alone, with no title. */
  plain: boolean;
};

/** The texts and button of a shown gate. With nothing to offer the app's own
    empty texts stay. */
export function gateCopy(gate: GateKind, shown: ShownGate): GateCopy {
  // Supplements follow the nutrition gate.
  const ns = gate === "program" ? "program" : "nutrition";
  const icon =
    gate === "program" ? "ribbon-outline" : gate === "nutrition_plan" ? "nutrition-outline" : "medkit-outline";

  switch (shown.kind) {
    case "locked":
      return {
        icon: "lock-closed-outline",
        titleKey: "premium.gate.lockedTitle",
        hintKey:
          gate === "supplement_plan"
            ? "premium.gate.supplements.lockedHint"
            : `premium.gate.${ns}.lockedHint`,
        actionKey: "premium.gate.renewAction",
        action: "paywall",
        footnoteKey: null,
        plain: false,
      };
    case "pending":
      return {
        icon: "time-outline",
        titleKey: "premium.gate.pendingTitle",
        hintKey: "premium.gate.pendingHint",
        actionKey: null,
        action: null,
        footnoteKey: "premium.gate.pendingSince",
        plain: false,
      };
    case "empty": {
      if (shown.action == null) {
        const [titleKey, hintKey] =
          gate === "program"
            ? ["coach.noProgramTitle", "coach.noProgramHint"]
            : gate === "nutrition_plan"
              ? ["mealReg.noPlanTitle", "mealReg.noPlanHint"]
              : ["supplements.noPlanTitle", "supplements.noPlanHint"];
        return { icon, titleKey, hintKey, actionKey: null, action: null, footnoteKey: null, plain: true };
      }
      return {
        icon,
        titleKey: `premium.gate.${ns}.title`,
        hintKey:
          shown.action === "request"
            ? `premium.gate.${ns}.requestHint`
            : `premium.gate.${ns}.noneHint`,
        actionKey: `premium.gate.${ns}.requestAction`,
        action: shown.action,
        footnoteKey: null,
        plain: false,
      };
    }
  }
}

/** Which pane the Nutrición tab opens on: the plan, else the supplements. A
    locked client has nothing to read, so the has_* flags decide instead. */
export function nutritionPane(i: {
  state: AccessState;
  access: MyAccess | null;
  hasPlan: boolean;
  hasSupplements: boolean;
}): "plan" | "supplements" {
  const flags = i.state === "lapsed" ? i.access : null;
  const plan = flags != null ? flags.has_nutrition_plan : i.hasPlan;
  const supplements = flags != null ? flags.has_supplement_plan : i.hasSupplements;
  return plan ? "plan" : supplements ? "supplements" : "plan";
}

export type SubscriptionCardView = {
  show: boolean;
  status: "none" | "active" | "cancelled" | "billing_issue" | "expired" | "membership";
  /** The date line: «Se renueva el», «Termina el» or «Terminó el». */
  date: { kind: "renews" | "ends" | "ended"; iso: string } | null;
  /** A test purchase (the store's sandbox). */
  sandbox: boolean;
  /** Opens the paywall: «Ver planes» or «Renovar suscripción». */
  action: "plans" | "renew" | null;
  manage: boolean;
  restore: boolean;
  /** Buying and managing happen in the iOS or Android app (web). */
  storeOnly: boolean;
};

function cardStatus(access: MyAccess, state: AccessState): SubscriptionCardView["status"] {
  const subscription = access.subscription;
  if (state === "lapsed") return subscription != null ? "expired" : "none";
  if (access.source === "subscription" && subscription != null) return subscription.status;
  if (access.source === "membership") return "membership";
  return subscription != null ? subscription.status : "none";
}

function cardDate(
  status: SubscriptionCardView["status"],
  access: MyAccess,
  now: Date,
): SubscriptionCardView["date"] {
  const subscription = access.subscription;
  const dated = (kind: "renews" | "ends" | "ended", iso: string | null) => {
    const t = timeOf(iso);
    return t == null || iso == null ? null : { kind, iso, t };
  };
  switch (status) {
    case "active": {
      if (subscription?.will_renew) {
        // A renewal date already past means the store is still processing it.
        const renews = dated("renews", subscription.expires_at);
        return renews != null && renews.t > now.getTime()
          ? { kind: renews.kind, iso: renews.iso }
          : null;
      }
      const ends = dated("ends", access.access_ends_at ?? subscription?.expires_at ?? null);
      return ends != null ? { kind: ends.kind, iso: ends.iso } : null;
    }
    case "cancelled":
    case "billing_issue": {
      const ends = dated("ends", access.access_ends_at ?? subscription?.expires_at ?? null);
      return ends != null ? { kind: ends.kind, iso: ends.iso } : null;
    }
    case "expired": {
      const ended = dated("ended", subscription?.access_until ?? null);
      return ended != null ? { kind: ended.kind, iso: ended.iso } : null;
    }
    case "membership": {
      const ends = dated("ends", access.access_ends_at);
      return ends != null ? { kind: ends.kind, iso: ends.iso } : null;
    }
    case "none":
      return null;
  }
}

/**
 * Settings' subscription card. While the switch is off it stays hidden unless
 * there is a subscription to show or a dev client that can buy (how the owner
 * tests purchases before go-live); the paywall is offered only where buying
 * works and the switch is on (or in that dev client).
 */
export function subscriptionCard(i: {
  access: MyAccess | null;
  state: AccessState;
  /** The purchases gateway can buy here (native, with a key). */
  purchasable: boolean;
  /** A dev client (`__DEV__`). */
  dev: boolean;
  now: Date;
}): SubscriptionCardView {
  const { access, state, purchasable, dev, now } = i;
  const hidden: SubscriptionCardView = {
    show: false,
    status: "none",
    date: null,
    sandbox: false,
    action: null,
    manage: false,
    restore: false,
    storeOnly: false,
  };
  if (access == null || state === "loading" || access.source === "coach") return hidden;
  const subscription = access.subscription;
  if (state === "open" && subscription == null && !(purchasable && dev)) return hidden;

  const status = cardStatus(access, state);
  const sellable = purchasable && (access.enforced || dev);
  return {
    show: true,
    status,
    date: cardDate(status, access, now),
    sandbox: subscription?.environment === "sandbox",
    action: sellable ? (status === "none" ? "plans" : status === "expired" ? "renew" : null) : null,
    manage: purchasable && subscription != null,
    restore: purchasable,
    storeOnly: !purchasable && (status === "none" || status === "expired"),
  };
}
