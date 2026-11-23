/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONFIRM_POLL_MS,
  CONFIRM_SYNC_MS,
  CONFIRM_TIMEOUT_MS,
  confirmPurchase,
  type ConfirmDeps,
} from "@/src/lib/confirm-purchase";

/** A fake clock: `sleep` is the only thing that moves it. */
function fake(opts: {
  /** `confirmed()` turns true once a sync has run. */
  syncConfirms?: boolean;
  /** `confirmed()` turns true at this time (the Realtime update landing). */
  confirmedAt?: number;
  syncFails?: boolean;
  cancelAt?: number;
  /** The screen goes away while the first sync is in flight. */
  cancelDuringSync?: boolean;
}) {
  let t = 0;
  let gone = false;
  const syncs: number[] = [];
  const deps: ConfirmDeps = {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    sync: async () => {
      syncs.push(t);
      if (opts.cancelDuringSync) gone = true;
      if (opts.syncFails) throw new Error("sync-subscription failed");
    },
    confirmed: () =>
      (opts.syncConfirms === true && syncs.length > 0) ||
      (opts.confirmedAt != null && t >= opts.confirmedAt),
    cancelled: () => gone || (opts.cancelAt != null && t >= opts.cancelAt),
  };
  return { deps, syncs, time: () => t };
}

describe("confirmPurchase", () => {
  it("has the spec's timings: sync at once, again every 12 s, give up after 60 s", () => {
    assert.equal(CONFIRM_SYNC_MS, 12_000);
    assert.equal(CONFIRM_TIMEOUT_MS, 60_000);
    assert.ok(CONFIRM_POLL_MS > 0 && CONFIRM_POLL_MS < CONFIRM_SYNC_MS);
  });

  it("confirms after the first sync when the server already knows", async () => {
    const { deps, syncs } = fake({ syncConfirms: true });
    assert.equal(await confirmPurchase(deps), "confirmed");
    assert.deepEqual(syncs, [0]);
  });

  it("times out at 60 s with five syncs and never a sixth", async () => {
    const { deps, syncs, time } = fake({});
    assert.equal(await confirmPurchase(deps), "timeout");
    assert.deepEqual(syncs, [0, 12_000, 24_000, 36_000, 48_000]);
    assert.equal(time(), 60_000);
  });

  it("sees an update that lands between syncs, without syncing again", async () => {
    const { deps, syncs } = fake({ confirmedAt: 7_000 });
    assert.equal(await confirmPurchase(deps), "confirmed");
    assert.deepEqual(syncs, [0]);
  });

  it("ignores a sync that fails and keeps waiting for the webhook", async () => {
    const { deps, syncs } = fake({ syncFails: true, confirmedAt: 20_000 });
    assert.equal(await confirmPurchase(deps), "confirmed");
    assert.deepEqual(syncs, [0, 12_000]);
  });

  it("stops at once when cancelled, with no further sync", async () => {
    const { deps, syncs } = fake({ cancelAt: 5_000 });
    assert.equal(await confirmPurchase(deps), "cancelled");
    assert.deepEqual(syncs, [0]);
  });

  it("stops right after a sync that outlived the screen, without waiting again", async () => {
    const { deps, syncs, time } = fake({ cancelDuringSync: true });
    assert.equal(await confirmPurchase(deps), "cancelled");
    assert.deepEqual(syncs, [0]);
    assert.equal(time(), 0);
  });

  it("does not even sync when it is cancelled before it starts", async () => {
    const { deps, syncs } = fake({ cancelAt: 0 });
    assert.equal(await confirmPurchase(deps), "cancelled");
    assert.deepEqual(syncs, []);
  });
});
