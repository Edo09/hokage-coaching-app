/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createRenewalChecker,
  RENEWAL_CHECK_DELAY_MS,
  RENEWAL_CHECK_MIN_GAP_MS,
  type RenewalCheckDeps,
} from "@/src/lib/renewal-check";
import type { MyAccess } from "@/src/types/database";
import { OPEN_ACCESS, RENEWAL_SETTLE_MS } from "@/src/utils/subscription";

const T0 = Date.parse("2026-11-23T12:00:00Z");
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** A client paying through the store, renewing: the period the answer holds ended `endedAgo` ms before T0. */
function renewing(endedAgo: number): MyAccess {
  return {
    enforced: true,
    has_access: true,
    source: "subscription",
    access_ends_at: iso(T0 - endedAgo),
    subscription: {
      status: "active",
      store: "play_store",
      product_id: "monthly",
      environment: "production",
      is_premium: true,
      will_renew: true,
      started_at: null,
      current_period_started_at: null,
      expires_at: iso(T0 - endedAgo),
      grace_expires_at: null,
      access_until: iso(T0 - endedAgo),
      last_synced_at: iso(T0 - 40 * 24 * H),
    },
    membership: null,
    has_program: false,
    has_nutrition_plan: false,
    has_supplement_plan: false,
  };
}

/** What the answer holds before the renewal arrives. */
const STALE = renewing(H);
/** What it holds once the renewal has arrived: the period ends in a month. */
const RENEWED = renewing(-30 * 24 * H);

/** `answers` are what each sync() reports, in order (an Error is thrown); a fake clock moves only through `advance`. */
function fake(answers: (boolean | Error)[] = []) {
  let t = T0;
  let syncs = 0;
  const queue = [...answers];
  const deps: RenewalCheckDeps = {
    now: () => new Date(t),
    sync: async () => {
      syncs += 1;
      const next = queue.shift() ?? true;
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { deps, syncs: () => syncs, advance: (ms: number) => void (t += ms) };
}

describe("createRenewalChecker", () => {
  it("waits 3 s before looking and 5 min between syncs", () => {
    assert.equal(RENEWAL_CHECK_DELAY_MS, 3_000);
    assert.equal(RENEWAL_CHECK_MIN_GAP_MS, 5 * 60_000);
  });

  it("does nothing when no renewal is missing", async () => {
    const { deps, syncs } = fake();
    const check = createRenewalChecker(deps);
    assert.equal(await check(null), "skipped");
    assert.equal(await check(OPEN_ACCESS), "skipped");
    assert.equal(await check(RENEWED), "skipped");
    assert.equal(await check(renewing(RENEWAL_SETTLE_MS - 1)), "skipped");
    assert.equal(syncs(), 0);
  });

  it("asks sync-subscription when the answer in hand still holds the old period", async () => {
    const { deps, syncs } = fake();
    assert.equal(await createRenewalChecker(deps)(STALE), "synced");
    assert.equal(syncs(), 1);
  });

  it("also syncs for a client the server already says has no access, its row never having moved", async () => {
    const locked: MyAccess = { ...renewing(5 * 24 * H), has_access: false, source: null, access_ends_at: null };
    const { deps, syncs } = fake();
    assert.equal(await createRenewalChecker(deps)(locked), "synced");
    assert.equal(syncs(), 1);
  });

  it("a sync the server did not answer is no look at all: the next one tries at once", async () => {
    const { deps, syncs } = fake([false, true]);
    const check = createRenewalChecker(deps);
    assert.equal(await check(STALE), "unanswered");
    assert.equal(await check(STALE), "synced");
    assert.equal(syncs(), 2);
  });

  it("never rejects: a sync that throws is unanswered", async () => {
    const { deps } = fake([new Error("Network request failed")]);
    assert.equal(await createRenewalChecker(deps)(STALE), "unanswered");
  });

  it("never runs two syncs at once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let syncs = 0;
    const deps: RenewalCheckDeps = {
      now: () => new Date(T0),
      sync: async () => {
        syncs += 1;
        await gate;
        return true;
      },
    };
    const check = createRenewalChecker(deps);
    const first = check(STALE);
    assert.equal(await check(STALE), "skipped");
    release();
    assert.equal(await first, "synced");
    assert.equal(syncs, 1);
  });

  it("syncs again only after the gap, however often it is asked", async () => {
    const { deps, syncs, advance } = fake();
    const check = createRenewalChecker(deps);
    assert.equal(await check(STALE), "synced");
    advance(RENEWAL_CHECK_MIN_GAP_MS - 1);
    assert.equal(await check(STALE), "skipped");
    assert.equal(syncs(), 1);
    advance(1);
    assert.equal(await check(STALE), "synced");
    assert.equal(syncs(), 2);
  });

  it("once it throws or is unanswered it can run again, so a hung request never blocks the next look", async () => {
    const { deps, syncs } = fake([new Error("boom"), false, true]);
    const check = createRenewalChecker(deps);
    assert.equal(await check(STALE), "unanswered");
    assert.equal(await check(STALE), "unanswered");
    assert.equal(await check(STALE), "synced");
    assert.equal(syncs(), 3);
  });
});
