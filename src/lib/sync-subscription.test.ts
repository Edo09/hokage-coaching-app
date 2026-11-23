/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SYNC_TIMEOUT_MS, syncSubscription, type SyncInvoke } from "@/src/lib/sync-subscription";

// What get_my_access() answers, inside sync-subscription's `{ result, access }`.
const ACCESS = {
  enforced: true,
  has_access: true,
  source: "subscription",
  access_ends_at: "2026-12-23T12:00:00Z",
  subscription: null,
  membership: null,
  has_program: false,
  has_nutrition_plan: false,
  has_supplement_plan: false,
};

const answers =
  (access: unknown): SyncInvoke =>
  async () => ({ data: { result: "synced", access }, error: null });

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("syncSubscription", () => {
  it("waits at most 15 s for the function: a stalled request must not hold a screen", () => {
    assert.equal(SYNC_TIMEOUT_MS, 15_000);
  });

  it("returns the access the function answers with", async () => {
    const fresh = await syncSubscription(answers(ACCESS));
    assert.equal(fresh?.enforced, true);
    assert.equal(fresh?.has_access, true);
    assert.equal(fresh?.source, "subscription");
    assert.equal(fresh?.access_ends_at, "2026-12-23T12:00:00Z");
  });

  it("is null, never a throw, for an error, a failed call and an answer that is not an access", async () => {
    assert.equal(await syncSubscription(async () => ({ data: null, error: new Error("503") })), null);
    assert.equal(
      await syncSubscription(async () => {
        throw new Error("Network request failed");
      }),
      null,
    );
    assert.equal(await syncSubscription(async () => ({ data: { result: "synced" }, error: null })), null);
    assert.equal(await syncSubscription(async () => ({ data: "nope", error: null })), null);
    assert.equal(await syncSubscription(async () => ({ data: null, error: null })), null);
  });

  it("gives up on a request that never answers, and aborts it", async () => {
    let signal: AbortSignal | undefined;
    const stalled: SyncInvoke = (s) => {
      signal = s;
      return new Promise(() => {});
    };
    const started = Date.now();
    assert.equal(await syncSubscription(stalled, 30), null);
    assert.ok(Date.now() - started < 2_000, "returned long after the timeout");
    assert.equal(signal?.aborted, true);
  });

  it("is not aborted when the call answers in time", async () => {
    let signal: AbortSignal | undefined;
    const quick: SyncInvoke = async (s) => {
      signal = s;
      return { data: { access: ACCESS }, error: null };
    };
    assert.notEqual(await syncSubscription(quick, 1_000), null);
    assert.equal(signal?.aborted, false);
  });

  it("leaves no timer running once the call has answered", async () => {
    const realSet = globalThis.setTimeout;
    const realClear = globalThis.clearTimeout;
    const live = new Set<ReturnType<typeof setTimeout>>();
    globalThis.setTimeout = ((handler: () => void, ms?: number) => {
      const timer = realSet(() => {
        live.delete(timer);
        handler();
      }, ms);
      live.add(timer);
      return timer;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((timer?: ReturnType<typeof setTimeout>) => {
      if (timer != null) live.delete(timer);
      realClear(timer);
    }) as typeof clearTimeout;
    try {
      await syncSubscription(answers(ACCESS));
      assert.equal(live.size, 0);
    } finally {
      globalThis.setTimeout = realSet;
      globalThis.clearTimeout = realClear;
    }
  });

  it("ignores an answer, or a failure, that arrives after the timeout", async () => {
    const late: SyncInvoke = () =>
      new Promise((resolve) => setTimeout(() => resolve({ data: { access: ACCESS }, error: null }), 60));
    assert.equal(await syncSubscription(late, 20), null);
    const lateFailure: SyncInvoke = () =>
      new Promise((_, reject) => setTimeout(() => reject(new Error("aborted")), 60));
    assert.equal(await syncSubscription(lateFailure, 20), null);
    // Both settle after we returned; neither may surface as an unhandled rejection.
    await pause(120);
  });
});
