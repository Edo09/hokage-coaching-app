/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
// Covers the revenuecat-webhook Edge Function's pure module: which users a
// RevenueCat event concerns, and what RevenueCat's customer answer means for
// the subscriptions row. The module has no imports so Deno and this runner can
// both load it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isUuid,
  parseWebhook,
  patchFromSubscriber,
  planEvent,
  type RcEvent,
} from "@/supabase/functions/_shared/revenuecat";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

describe("isUuid", () => {
  it("accepts a UUID and refuses what is not one", () => {
    assert.equal(isUuid(U1), true);
    assert.equal(isUuid("$RCAnonymousID:abc123"), false);
    assert.equal(isUuid("not-a-uuid"), false);
    assert.equal(isUuid(""), false);
  });
});

describe("parseWebhook", () => {
  it("takes RevenueCat's envelope", () => {
    const r = parseWebhook({ api_version: "1.0", event: { id: "evt_1", type: "INITIAL_PURCHASE", app_user_id: U1 } });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.event.id, "evt_1");
      assert.equal(r.event.type, "INITIAL_PURCHASE");
    }
  });

  it("refuses what is not an event, with a reason", () => {
    for (const body of [null, undefined, "x", 7, {}, { event: null }, { event: {} }, { event: { id: 5, type: "X" } }, { event: { id: "e", type: "" } }, { event: { id: "", type: "X" } }]) {
      const r = parseWebhook(body);
      assert.equal(r.ok, false, JSON.stringify(body));
      if (!r.ok) assert.equal(typeof r.reason, "string");
    }
  });
});

describe("planEvent", () => {
  const ev = (over: Partial<RcEvent> & { type: string }): RcEvent => ({ id: "evt", ...over });

  it("re-reads the user of a purchase", () => {
    assert.deepEqual(planEvent(ev({ type: "INITIAL_PURCHASE", app_user_id: U1 })), {
      action: "sync",
      userIds: [U1],
      unknownIds: [],
    });
  });

  it("finds the Supabase user behind an anonymous id through the aliases", () => {
    const plan = planEvent(
      ev({ type: "RENEWAL", app_user_id: "$RCAnonymousID:abc", original_app_user_id: "$RCAnonymousID:abc", aliases: ["$RCAnonymousID:abc", U1] }),
    );
    assert.deepEqual(plan, { action: "sync", userIds: [U1], unknownIds: ["$RCAnonymousID:abc"] });
  });

  it("lists a non-UUID id as unknown and has nobody to re-read", () => {
    assert.deepEqual(planEvent(ev({ type: "EXPIRATION", app_user_id: "$RCAnonymousID:zzz" })), {
      action: "sync",
      userIds: [],
      unknownIds: ["$RCAnonymousID:zzz"],
    });
  });

  it("does not repeat an id that appears twice", () => {
    const plan = planEvent(ev({ type: "RENEWAL", app_user_id: U1, original_app_user_id: U1, aliases: [U1] }));
    assert.deepEqual(plan, { action: "sync", userIds: [U1], unknownIds: [] });
  });

  it("re-reads both users of a transfer, which carries no app_user_id", () => {
    const plan = planEvent(ev({ type: "TRANSFER", transferred_from: [U1], transferred_to: [U2] }));
    assert.deepEqual(plan, { action: "sync", userIds: [U1, U2], unknownIds: [] });
  });

  it("acknowledges a test event", () => {
    assert.deepEqual(planEvent(ev({ type: "TEST", app_user_id: U1 })), { action: "ack" });
  });

  it("ignores only the types that have nothing to do with a subscription", () => {
    for (const type of ["EXPERIMENT_ENROLLMENT", "VIRTUAL_CURRENCY_TRANSACTION", "INVOICE_ISSUANCE"]) {
      assert.deepEqual(planEvent(ev({ type, app_user_id: U1 })), { action: "ignore" }, type);
    }
  });

  it("re-reads for any other type, including one RevenueCat adds later: a re-read is harmless, a missed one is a wrong access", () => {
    for (const type of ["NON_RENEWING_PURCHASE", "PURCHASE_REDEEMED", "SUBSCRIBER_ALIAS", "SOMETHING_RC_ADDS_LATER"]) {
      assert.deepEqual(planEvent(ev({ type, app_user_id: U1 })), { action: "sync", userIds: [U1], unknownIds: [] }, type);
    }
  });

  it("re-reads for every type that can change access", () => {
    for (const type of [
      "INITIAL_PURCHASE", "RENEWAL", "CANCELLATION", "UNCANCELLATION", "EXPIRATION", "BILLING_ISSUE",
      "PRODUCT_CHANGE", "SUBSCRIPTION_PAUSED", "SUBSCRIPTION_EXTENDED", "REFUND_REVERSED", "TEMPORARY_ENTITLEMENT_GRANT",
    ]) {
      assert.deepEqual(planEvent(ev({ type, app_user_id: U1 })), { action: "sync", userIds: [U1], unknownIds: [] }, type);
    }
  });
});

describe("patchFromSubscriber", () => {
  const NOW = new Date("2026-11-23T12:00:00.000Z");
  const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();

  type Bag = Record<string, unknown>;
  const customer = (ent: Bag | undefined, subs: Record<string, Bag> = {}) => ({
    entitlements: ent === undefined ? {} : { premium_access: ent },
    subscriptions: subs,
  });
  // A monthly subscriber with a live period; `sub` and `ent` override fields.
  const monthly = (sub: Bag = {}, ent: Bag = {}) =>
    customer(
      { product_identifier: "hokage_monthly", purchase_date: at(-5), expires_date: at(25), grace_period_expires_date: null, ...ent },
      {
        hokage_monthly: {
          store: "app_store", is_sandbox: false, original_purchase_date: at(-35), purchase_date: at(-5),
          expires_date: at(25), unsubscribe_detected_at: null, billing_issues_detected_at: null,
          grace_period_expires_date: null, refunded_at: null, ...sub,
        },
      },
    );
  const patch = (c: unknown) => patchFromSubscriber(c, U1, NOW);

  it("reads a live monthly subscription", () => {
    assert.deepEqual(patch(monthly()), {
      product_id: "hokage_monthly", store: "app_store", environment: "production", status: "active",
      is_premium: true, will_renew: true, started_at: at(-35), current_period_started_at: at(-5),
      expires_at: at(25), grace_expires_at: null, access_until: at(25), rc_app_user_id: U1,
    });
  });

  it("keeps access for a cancelled subscription until its period ends", () => {
    const p = patch(monthly({ unsubscribe_detected_at: at(-1) }));
    assert.equal(p.status, "cancelled");
    assert.equal(p.is_premium, true);
    assert.equal(p.will_renew, false);
    assert.equal(p.access_until, at(25));
  });

  it("keeps access through a billing issue until the grace ends", () => {
    const p = patch(
      monthly(
        { expires_date: at(-2), billing_issues_detected_at: at(-2), grace_period_expires_date: at(5) },
        { expires_date: at(-2), grace_period_expires_date: at(5) },
      ),
    );
    assert.equal(p.status, "billing_issue");
    assert.equal(p.is_premium, true);
    assert.equal(p.will_renew, false);
    assert.equal(p.access_until, at(5));
    assert.equal(p.grace_expires_at, at(5));
  });

  it("ends access when the grace has passed too", () => {
    const p = patch(
      monthly(
        { expires_date: at(-10), billing_issues_detected_at: at(-10), grace_period_expires_date: at(-3) },
        { expires_date: at(-10), grace_period_expires_date: at(-3) },
      ),
    );
    assert.equal(p.status, "expired");
    assert.equal(p.is_premium, false);
    assert.equal(p.access_until, at(-3));
  });

  it("reads an expired subscription", () => {
    const p = patch(monthly({ expires_date: at(-3) }, { expires_date: at(-3) }));
    assert.equal(p.status, "expired");
    assert.equal(p.is_premium, false);
    assert.equal(p.will_renew, false);
    assert.equal(p.access_until, at(-3));
    assert.ok(Date.parse(p.access_until) <= NOW.getTime());
  });

  it("closes access at once for a refund, whatever the period says", () => {
    const p = patch(monthly({ refunded_at: at(-1) }));
    assert.equal(p.is_premium, false);
    assert.equal(p.status, "expired");
    assert.equal(p.access_until, NOW.toISOString());
  });

  it("treats an entitlement with no expiry (a promotional grant) as open-ended access", () => {
    const p = patch(customer({ product_identifier: "rc_promo_premium_access_lifetime", purchase_date: at(-1), expires_date: null, grace_period_expires_date: null }));
    assert.equal(p.is_premium, true);
    assert.equal(p.access_until, "infinity");
    assert.equal(p.status, "active");
    assert.equal(p.store, "unknown");
    assert.equal(p.expires_at, null);
    assert.equal(p.product_id, "rc_promo_premium_access_lifetime");
  });

  it("has no product and no access for a customer with nothing", () => {
    const p = patch(customer(undefined));
    assert.equal(p.product_id, null);
    assert.equal(p.store, null);
    assert.equal(p.status, "expired");
    assert.equal(p.is_premium, false);
    assert.equal(p.will_renew, false);
  });

  it("flags a sandbox purchase", () => {
    assert.equal(patch(monthly({ is_sandbox: true })).environment, "sandbox");
    assert.equal(patch(monthly()).environment, "production");
  });

  it("passes the quarterly, annual and Google base-plan product ids through", () => {
    for (const id of ["hokage_quarterly", "hokage_annual", "premium:annual-plan"]) {
      const c = customer(
        { product_identifier: id, purchase_date: at(-5), expires_date: at(80), grace_period_expires_date: null },
        { [id]: { store: "play_store", is_sandbox: false, original_purchase_date: at(-5), purchase_date: at(-5), expires_date: at(80) } },
      );
      const p = patch(c);
      assert.equal(p.product_id, id);
      assert.equal(p.store, "play_store");
      assert.equal(p.is_premium, true);
    }
  });

  it("never throws, and never grants access, on input it does not understand", () => {
    for (const input of [
      null, undefined, "x", 42, [], {}, { entitlements: "x", subscriptions: [] },
      { entitlements: { premium_access: "x" } },
      { entitlements: { premium_access: { product_identifier: "p" } } }, // no expires_date at all: not open-ended
    ]) {
      const p = patch(input);
      assert.equal(p.is_premium, false, JSON.stringify(input));
      assert.equal(p.status, "expired", JSON.stringify(input));
      assert.equal(p.rc_app_user_id, U1);
    }
  });
});
