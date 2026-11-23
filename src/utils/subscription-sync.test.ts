/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
// Covers the logic behind the revenuecat-webhook and sync-subscription Edge
// Functions, with the database and RevenueCat's API faked: who may call, what is
// recorded once, whom is re-read, and what a failure answers. The module only
// imports its sibling modules so Deno and this runner can both load it.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import type { RcEvent, SubscriptionPatch } from "@/supabase/functions/_shared/revenuecat";
import {
  handleWebhook,
  syncOwnAccount,
  syncUser,
  type OwnSyncDeps,
  type WebhookDeps,
  type WebhookRequest,
} from "@/supabase/functions/_shared/subscription-sync";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const BASE = Date.parse("2026-11-23T12:00:00.000Z");

type Applied = { userId: string; patch: SubscriptionPatch; fetchedAt: Date; eventId: string | null; eventAt: Date | null };

/** In-memory fakes that record what the handler did. The clock moves a second
 *  every time it is read, so "when was it read" is visible in the results. */
function harness(opts: {
  known?: string[];
  record?: "new" | "repeat_done" | "repeat_retry";
  fetchFails?: string[];
  apply?: "applied" | "stale" | "skipped";
  secret?: string | undefined;
  signingSecret?: string | undefined;
  recordThrows?: boolean;
  slot?: boolean;
} = {}) {
  let reads = 0;
  const calls = {
    record: [] as RcEvent[],
    finish: [] as { id: string; outcome: string; error?: string }[],
    profileChecks: [] as string[][],
    fetched: [] as string[],
    fetchedClock: [] as number[],
    applied: [] as Applied[],
    slots: [] as string[],
  };
  const known = new Set(opts.known ?? [U1, U2]);
  const clock = () => BASE + reads * 1000;
  const subscriber = {
    entitlements: {
      premium_access: {
        product_identifier: "hokage_monthly",
        purchase_date: new Date(BASE - 5 * 86_400_000).toISOString(),
        expires_date: new Date(BASE + 25 * 86_400_000).toISOString(),
        grace_period_expires_date: null,
      },
    },
    subscriptions: {
      hokage_monthly: {
        store: "app_store",
        is_sandbox: true,
        original_purchase_date: new Date(BASE - 35 * 86_400_000).toISOString(),
        purchase_date: new Date(BASE - 5 * 86_400_000).toISOString(),
        expires_date: new Date(BASE + 25 * 86_400_000).toISOString(),
      },
    },
  };
  const deps: WebhookDeps & OwnSyncDeps = {
    secret: "secret" in opts ? opts.secret : "hook-secret",
    signingSecret: opts.signingSecret,
    now: () => new Date(BASE + ++reads * 1000),
    recordEvent: async (event) => {
      if (opts.recordThrows) throw new Error("database is down");
      calls.record.push(event);
      return opts.record ?? "new";
    },
    finishEvent: async (id, outcome, error) => {
      calls.finish.push({ id, outcome, error });
    },
    existingProfiles: async (ids) => {
      calls.profileChecks.push(ids);
      return new Set(ids.filter((id) => known.has(id)));
    },
    fetchSubscriber: async (id) => {
      calls.fetched.push(id);
      calls.fetchedClock.push(clock());
      if (opts.fetchFails?.includes(id)) throw new Error("RevenueCat answered 500");
      return subscriber;
    },
    applySnapshot: async (userId, patch, fetchedAt, eventId, eventAt) => {
      calls.applied.push({ userId, patch, fetchedAt, eventId, eventAt });
      return opts.apply ?? "applied";
    },
    takeSlot: async (userId) => {
      calls.slots.push(userId);
      return opts.slot ?? true;
    },
  };
  return { deps, calls };
}

const event = (over: Partial<RcEvent> = {}): RcEvent => ({
  id: "evt_1",
  type: "INITIAL_PURCHASE",
  app_user_id: U1,
  event_timestamp_ms: BASE - 60_000,
  ...over,
});
const post = (body: unknown, over: Partial<WebhookRequest> = {}): WebhookRequest => ({
  method: "POST",
  authorization: "hook-secret",
  signature: null,
  rawBody: JSON.stringify(body),
  ...over,
});
const envelope = (e: RcEvent) => ({ api_version: "1.0", event: e });

describe("handleWebhook: who may call", () => {
  it("answers 405 to anything but POST, and touches nothing", async () => {
    const { deps, calls } = harness();
    const r = await handleWebhook(deps, post(envelope(event()), { method: "GET" }));
    assert.equal(r.status, 405);
    assert.equal(calls.record.length, 0);
  });

  it("answers 503 when no secret is configured, and touches nothing", async () => {
    const { deps, calls } = harness({ secret: undefined });
    const r = await handleWebhook(deps, post(envelope(event())));
    assert.equal(r.status, 503);
    assert.equal(calls.record.length + calls.fetched.length, 0);
  });

  it("answers 401 to a wrong or missing Authorization", async () => {
    for (const authorization of ["nope", "", null]) {
      const { deps, calls } = harness();
      const r = await handleWebhook(deps, post(envelope(event()), { authorization }));
      assert.equal(r.status, 401, String(authorization));
      assert.equal(calls.record.length, 0);
    }
  });

  it("checks the signature only when a signing secret is set", async () => {
    const body = JSON.stringify(envelope(event()));
    const sign = (t: number) => `t=${t},v1=${createHmac("sha256", "sign-secret").update(`${t}.${body}`).digest("hex")}`;

    const off = harness();
    assert.equal((await handleWebhook(off.deps, post(envelope(event()), { signature: "garbage" }))).status, 200);

    for (const signature of [null, "garbage", sign(Math.floor(BASE / 1000) - 3600)]) {
      const { deps, calls } = harness({ signingSecret: "sign-secret" });
      const r = await handleWebhook(deps, { method: "POST", authorization: "hook-secret", signature, rawBody: body });
      assert.equal(r.status, 401, String(signature));
      assert.equal(calls.record.length, 0);
    }

    const { deps } = harness({ signingSecret: "sign-secret" });
    const good = await handleWebhook(deps, {
      method: "POST",
      authorization: "hook-secret",
      signature: sign(Math.floor(BASE / 1000)),
      rawBody: body,
    });
    assert.equal(good.status, 200);
  });

  it("answers 400 to a body that is not JSON or not an event", async () => {
    for (const rawBody of ["{not json", JSON.stringify({ event: { type: "RENEWAL" } }), JSON.stringify([])]) {
      const { deps, calls } = harness();
      const r = await handleWebhook(deps, { method: "POST", authorization: "hook-secret", signature: null, rawBody });
      assert.equal(r.status, 400, rawBody);
      assert.equal(calls.record.length, 0);
    }
  });
});

describe("handleWebhook: what is recorded and re-read", () => {
  it("acknowledges a test event, recorded as ignored, without calling RevenueCat", async () => {
    const { deps, calls } = harness();
    const r = await handleWebhook(deps, post(envelope(event({ id: "evt_test", type: "TEST" }))));
    assert.equal(r.status, 200);
    assert.deepEqual(calls.finish, [{ id: "evt_test", outcome: "ignored", error: undefined }]);
    assert.equal(calls.fetched.length, 0);
  });

  it("skips an event that was already handled", async () => {
    const { deps, calls } = harness({ record: "repeat_done" });
    const r = await handleWebhook(deps, post(envelope(event())));
    assert.equal(r.status, 200);
    assert.equal(r.body.duplicate, true);
    assert.equal(calls.fetched.length, 0);
    assert.equal(calls.finish.length, 0);
  });

  it("runs an event again that was seen but never finished (a retry after a failure)", async () => {
    const { deps, calls } = harness({ record: "repeat_retry" });
    const r = await handleWebhook(deps, post(envelope(event())));
    assert.equal(r.status, 200);
    assert.deepEqual(calls.fetched, [U1]);
    assert.equal(calls.finish.at(-1)?.outcome, "synced");
  });

  it("records a type that never changes access as ignored", async () => {
    const { deps, calls } = harness();
    const r = await handleWebhook(deps, post(envelope(event({ type: "EXPERIMENT_ENROLLMENT" }))));
    assert.equal(r.status, 200);
    assert.equal(calls.finish.at(-1)?.outcome, "ignored");
    assert.equal(calls.fetched.length, 0);
  });

  it("answers 200 and never calls RevenueCat for an id with no profile or no UUID", async () => {
    for (const e of [
      event({ app_user_id: U1 }), // a UUID, but no such profile
      event({ app_user_id: "$RCAnonymousID:abc" }), // not a UUID at all
    ]) {
      const { deps, calls } = harness({ known: [] });
      const r = await handleWebhook(deps, post(envelope(e)));
      assert.equal(r.status, 200);
      assert.equal(calls.finish.at(-1)?.outcome, "unknown_user");
      assert.equal(calls.fetched.length, 0);
    }
  });

  it("re-reads the user, applies the patch with the fetch time and the event, and finishes synced", async () => {
    const { deps, calls } = harness();
    const r = await handleWebhook(deps, post(envelope(event())));
    assert.equal(r.status, 200);
    assert.deepEqual(calls.fetched, [U1]);
    assert.equal(calls.applied.length, 1);
    const a = calls.applied[0];
    assert.equal(a.userId, U1);
    assert.equal(a.patch.is_premium, true);
    assert.equal(a.patch.environment, "sandbox");
    assert.equal(a.patch.rc_app_user_id, U1);
    assert.equal(a.eventId, "evt_1");
    assert.equal(a.eventAt?.getTime(), BASE - 60_000);
    // The fetch time was read before the call to RevenueCat, so a slower, older
    // answer can never be stored over a newer one.
    assert.equal(a.fetchedAt.getTime(), calls.fetchedClock[0]);
    assert.equal(calls.finish.at(-1)?.outcome, "synced");
  });

  it("re-reads both users of a transfer", async () => {
    const { deps, calls } = harness();
    const e: RcEvent = { id: "evt_tr", type: "TRANSFER", transferred_from: [U1], transferred_to: [U2] };
    const r = await handleWebhook(deps, post(envelope(e)));
    assert.equal(r.status, 200);
    assert.deepEqual(calls.fetched, [U1, U2]);
    assert.deepEqual(calls.applied.map((a) => a.userId), [U1, U2]);
  });

  it("answers 500 when RevenueCat fails, still tries the other user, and records why", async () => {
    const { deps, calls } = harness({ fetchFails: [U1] });
    const e: RcEvent = { id: "evt_tr", type: "TRANSFER", transferred_from: [U1], transferred_to: [U2] };
    const r = await handleWebhook(deps, post(envelope(e)));
    assert.equal(r.status, 500);
    assert.deepEqual(calls.applied.map((a) => a.userId), [U2]);
    const done = calls.finish.at(-1);
    assert.equal(done?.outcome, "failed");
    assert.match(done?.error ?? "", /RevenueCat answered 500/);
    assert.match(done?.error ?? "", new RegExp(U1));
  });

  it("answers 500 when the database fails, so RevenueCat retries", async () => {
    const { deps } = harness({ recordThrows: true });
    const r = await handleWebhook(deps, post(envelope(event())));
    assert.equal(r.status, 500);
  });

  it("counts a stale answer as handled", async () => {
    const { deps, calls } = harness({ apply: "stale" });
    const r = await handleWebhook(deps, post(envelope(event())));
    assert.equal(r.status, 200);
    assert.equal(calls.finish.at(-1)?.outcome, "synced");
  });
});

describe("syncUser and syncOwnAccount", () => {
  it("returns what the database said", async () => {
    for (const result of ["applied", "stale", "skipped"] as const) {
      const { deps } = harness({ apply: result });
      assert.equal(await syncUser(deps, U1), result);
    }
  });

  it("lets a sync fail loudly when RevenueCat does", async () => {
    const { deps } = harness({ fetchFails: [U1] });
    await assert.rejects(() => syncUser(deps, U1), /RevenueCat answered 500/);
  });

  it("does not call RevenueCat when the cooldown slot is taken", async () => {
    const { deps, calls } = harness({ slot: false });
    assert.equal(await syncOwnAccount(deps, U1), "cooldown");
    assert.deepEqual(calls.slots, [U1]);
    assert.equal(calls.fetched.length, 0);
  });

  it("takes the slot for the caller's own id, then re-reads that account", async () => {
    const { deps, calls } = harness({ slot: true });
    assert.equal(await syncOwnAccount(deps, U1), "applied");
    assert.deepEqual(calls.slots, [U1]);
    assert.deepEqual(calls.fetched, [U1]);
  });
});
