/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import en from "@/src/i18n/en";
import es from "@/src/i18n/es";
import type {
  ContentRequest,
  ContentRequestKind,
  MyAccess,
  MyAccessSubscription,
} from "@/src/types/database";
import {
  accessState,
  contentGate,
  effectiveAccess,
  gateCopy,
  hasAccessNow,
  isRenewing,
  isSubscribed,
  MAX_TIMEOUT_MS,
  msUntilAccessEnds,
  needsRenewalSync,
  nutritionPane,
  OPEN_ACCESS,
  parseMyAccess,
  pendingRequest,
  RENEWAL_GRACE_MS,
  RENEWAL_SETTLE_MS,
  requestKindOf,
  subscriptionCard,
  type AccessState,
  type GateKind,
  type ShownGate,
} from "@/src/utils/subscription";

// The access model of docs/superpowers/specs/2026-11-16-premium-subscriptions-
// design.md. Every function takes `now`, so one fixed clock serves the file.
const NOW = new Date("2026-11-23T12:00:00Z");
const H = 3_600_000;
const DAY = 24 * H;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

function sub(over: Partial<MyAccessSubscription> = {}): MyAccessSubscription {
  return {
    status: "active",
    store: "app_store",
    product_id: "monthly",
    environment: "production",
    is_premium: true,
    will_renew: true,
    started_at: at(-60 * DAY),
    current_period_started_at: at(-5 * DAY),
    expires_at: at(25 * DAY),
    grace_expires_at: null,
    access_until: at(25 * DAY),
    last_synced_at: at(-H),
    ...over,
  };
}

/** A client paying through the store, switch on. */
function access(over: Partial<MyAccess> = {}): MyAccess {
  return {
    enforced: true,
    has_access: true,
    source: "subscription",
    access_ends_at: at(25 * DAY),
    subscription: sub(),
    membership: null,
    has_program: false,
    has_nutrition_plan: false,
    has_supplement_plan: false,
    ...over,
  };
}

/** A client with nothing, switch on. */
const NONE = access({
  has_access: false,
  source: null,
  access_ends_at: null,
  subscription: null,
});

const stateOf = (a: MyAccess | null) => accessState(a, NOW);

function request(over: Partial<ContentRequest> = {}): ContentRequest {
  return {
    id: "r1",
    user_id: "u1",
    kind: "program",
    status: "pending",
    note: null,
    created_at: "2026-11-20T10:00:00Z",
    resolved_at: null,
    resolved_by: null,
    ...over,
  };
}

describe("parseMyAccess", () => {
  it("is not an answer for null, undefined, strings or arrays", () => {
    for (const raw of [null, undefined, "x", 3, true, []]) {
      assert.equal(parseMyAccess(raw), null);
    }
  });

  it("round-trips a full answer field for field", () => {
    const full = access({
      access_ends_at: at(2 * DAY),
      subscription: sub({ status: "cancelled", will_renew: false, environment: "sandbox" }),
      membership: { status: "active", expires_at: "2026-12-31" },
      has_program: true,
      has_nutrition_plan: true,
      has_supplement_plan: true,
    });
    assert.deepEqual(parseMyAccess(JSON.parse(JSON.stringify(full))), full);
  });

  it("opens on an empty answer: a malformed answer never locks", () => {
    assert.deepEqual(parseMyAccess({}), OPEN_ACCESS);
    assert.deepEqual(parseMyAccess({ enforced: false }), OPEN_ACCESS);
    // While the switch is off nobody is locked, whatever has_access says.
    assert.equal(parseMyAccess({ enforced: false, has_access: false })?.has_access, true);
  });

  it("gives nothing to a bare enforced answer", () => {
    assert.deepEqual(parseMyAccess({ enforced: true }), {
      enforced: true,
      has_access: false,
      source: null,
      access_ends_at: null,
      subscription: null,
      membership: null,
      has_program: false,
      has_nutrition_plan: false,
      has_supplement_plan: false,
    });
  });

  it("drops what it cannot use", () => {
    const parsed = parseMyAccess({
      enforced: true,
      has_access: true,
      source: "bogus",
      subscription: "x",
      membership: 5,
      surprise: true,
    });
    assert.equal(parsed?.source, null);
    assert.equal(parsed?.subscription, null);
    assert.equal(parsed?.membership, null);
    assert.equal(parsed != null && "surprise" in parsed, false);
    assert.equal(parseMyAccess({ enforced: true, membership: { status: "bogus", expires_at: null } })?.membership, null);
  });
});

describe("effectiveAccess", () => {
  it("lets a cached answer win, even while paused", () => {
    const cached = access();
    assert.equal(effectiveAccess(cached, { pending: false, paused: false }), cached);
    assert.equal(effectiveAccess(cached, { pending: true, paused: true }), cached);
  });

  it("is loading while the first fetch is in flight", () => {
    assert.equal(effectiveAccess(null, { pending: true, paused: false }), null);
  });

  it("opens when nothing is cached and the phone is offline (never locks a client it cannot read)", () => {
    assert.equal(effectiveAccess(null, { pending: true, paused: true }), OPEN_ACCESS);
  });

  it("opens when nothing is cached and the fetch failed", () => {
    assert.equal(effectiveAccess(null, { pending: false, paused: false }), OPEN_ACCESS);
  });
});

describe("accessState and hasAccessNow", () => {
  it("is loading without an answer", () => {
    assert.equal(stateOf(null), "loading");
  });

  it("is open while the switch is off, even when has_access says no", () => {
    assert.equal(stateOf(OPEN_ACCESS), "open");
    assert.equal(stateOf(access({ enforced: false, has_access: false })), "open");
  });

  it("is active for the coach, who never loses access", () => {
    assert.equal(
      stateOf(access({ source: "coach", access_ends_at: null, subscription: null })),
      "active",
    );
  });

  it("is active while access runs and lapsed at its end, for anything that does not renew", () => {
    const ending = (ends: string) =>
      access({ access_ends_at: ends, subscription: sub({ status: "cancelled", will_renew: false }) });
    assert.equal(stateOf(access({ access_ends_at: at(H) })), "active");
    assert.equal(stateOf(ending(at(0))), "lapsed");
    assert.equal(hasAccessNow(ending(at(1)), NOW), true);
    assert.equal(hasAccessNow(ending(at(0)), NOW), false);
  });

  it("flips to lapsed by the local clock when a stale answer still says yes, for anything that does not renew", () => {
    const stale = at(-1);
    const lapsing: MyAccess[] = [
      access({ access_ends_at: stale, subscription: sub({ status: "cancelled", will_renew: false }) }),
      access({ access_ends_at: stale, subscription: sub({ status: "billing_issue", will_renew: false }) }),
      access({ access_ends_at: stale, subscription: sub({ status: "active", will_renew: false }) }),
      access({
        access_ends_at: stale,
        source: "membership",
        subscription: null,
        membership: { status: "active", expires_at: stale },
      }),
    ];
    for (const a of lapsing) assert.equal(stateOf(a), "lapsed");
  });

  it("is lapsed without has_access, whatever the end date says", () => {
    assert.equal(stateOf(access({ has_access: false, access_ends_at: at(DAY) })), "lapsed");
    assert.equal(stateOf(NONE), "lapsed");
  });

  it("tells a billing problem and a cancellation from a plain subscription", () => {
    assert.equal(stateOf(access({ subscription: sub({ status: "billing_issue", will_renew: false }) })), "grace");
    assert.equal(stateOf(access({ subscription: sub({ status: "cancelled", will_renew: false }) })), "cancelled_active");
    assert.equal(stateOf(access({ subscription: sub({ status: "active" }) })), "active");
  });

  it("does not read a membership's access as a cancelled subscription", () => {
    assert.equal(
      stateOf(
        access({
          source: "membership",
          access_ends_at: null,
          subscription: sub({ status: "cancelled", will_renew: false }),
          membership: { status: "active", expires_at: null },
        }),
      ),
      "active",
    );
  });

  it("falls back to has_access when the end date cannot be read", () => {
    assert.equal(stateOf(access({ access_ends_at: "not a date" })), "active");
  });
});

describe("isSubscribed", () => {
  it("is true for a premium subscription with a future end, even an open-ended one", () => {
    assert.equal(isSubscribed(access({ subscription: sub({ access_until: at(H) }) }), NOW), true);
    assert.equal(isSubscribed(access({ subscription: sub({ access_until: "infinity" }) }), NOW), true);
  });

  it("is false once revoked, past its end, missing, or without an answer", () => {
    assert.equal(isSubscribed(access({ subscription: sub({ is_premium: false }) }), NOW), false);
    assert.equal(isSubscribed(access({ subscription: sub({ access_until: at(-1) }) }), NOW), false);
    assert.equal(isSubscribed(access({ subscription: null }), NOW), false);
    assert.equal(isSubscribed(null, NOW), false);
  });

  it("reads the subscription whether or not the switch is on", () => {
    assert.equal(isSubscribed(access({ enforced: false, subscription: sub() }), NOW), true);
  });
});

describe("msUntilAccessEnds", () => {
  it("has nothing to wait for without an end, an answer, access or enforcement", () => {
    assert.equal(msUntilAccessEnds(null, NOW), null);
    assert.equal(msUntilAccessEnds(access({ access_ends_at: null }), NOW), null);
    assert.equal(msUntilAccessEnds(access({ has_access: false }), NOW), null);
    assert.equal(msUntilAccessEnds(access({ enforced: false }), NOW), null);
  });

  // Anything that does not renew (a cancelled subscription, a billing problem,
  // a membership): the end is the end.
  const cancelled = (endsIn: number) =>
    access({ access_ends_at: at(endsIn), subscription: sub({ status: "cancelled", will_renew: false }) });

  it("has nothing to wait for once the end has passed", () => {
    assert.equal(msUntilAccessEnds(cancelled(0), NOW), null);
    assert.equal(msUntilAccessEnds(cancelled(-DAY), NOW), null);
  });

  it("waits until just after the end", () => {
    assert.equal(msUntilAccessEnds(cancelled(H), NOW), H + 1);
  });

  it("never exceeds what setTimeout can hold (a longer delay fires at once)", () => {
    assert.equal(MAX_TIMEOUT_MS, 2_147_483_647);
    assert.equal(msUntilAccessEnds(cancelled(90 * DAY), NOW), MAX_TIMEOUT_MS);
    assert.equal(msUntilAccessEnds(renewing(90 * DAY), NOW), MAX_TIMEOUT_MS);
  });

  it("for a renewing subscription waits for the renewal to arrive, then for the grace to run out", () => {
    // Before the period end: until the store's notification has had time to land.
    assert.equal(msUntilAccessEnds(renewing(H), NOW), H + RENEWAL_SETTLE_MS + 1);
    // A minute past it: the rest of that settling time.
    assert.equal(msUntilAccessEnds(renewing(-60_000), NOW), RENEWAL_SETTLE_MS - 60_000 + 1);
    // Settled and still unrenewed: the next change is the grace ending.
    assert.equal(msUntilAccessEnds(renewing(-H), NOW), RENEWAL_GRACE_MS - H + 1);
    // Right at the settle moment the settling is over (the boundary passed).
    assert.equal(msUntilAccessEnds(renewing(-RENEWAL_SETTLE_MS), NOW), RENEWAL_GRACE_MS - RENEWAL_SETTLE_MS + 1);
  });

  it("for a renewing subscription has nothing left once the grace has run out", () => {
    assert.equal(msUntilAccessEnds(renewing(-RENEWAL_GRACE_MS), NOW), null);
    assert.equal(msUntilAccessEnds(renewing(-4 * DAY), NOW), null);
  });
});

/** A client paying through the store whose subscription renews: its period ends `endsIn` ms from NOW. */
function renewing(endsIn: number): MyAccess {
  return access({ access_ends_at: at(endsIn), subscription: sub({ access_until: at(endsIn) }) });
}

describe("isRenewing", () => {
  it("is an active store subscription set to renew", () => {
    assert.equal(isRenewing(access()), true);
    assert.equal(isRenewing(access({ subscription: sub({ status: "active", will_renew: true }) })), true);
  });

  it("is not a cancelled, failing, ended or non-renewing subscription", () => {
    for (const s of [
      sub({ status: "cancelled", will_renew: false }),
      sub({ status: "billing_issue", will_renew: false }),
      sub({ status: "expired", will_renew: false }),
      sub({ status: "active", will_renew: false }),
      // The store keeps retrying a failed charge, so the row may still say it
      // will renew; the status decides, and none of these is an active renewal.
      sub({ status: "billing_issue", will_renew: true }),
      sub({ status: "cancelled", will_renew: true }),
      sub({ status: "expired", will_renew: true }),
    ]) {
      assert.equal(isRenewing(access({ subscription: s })), false, `${s.status} will_renew=${s.will_renew}`);
    }
  });

  it("is not access that comes from anywhere else, nor no subscription at all", () => {
    for (const source of ["coach", "membership", "open", null] as const) {
      assert.equal(isRenewing(access({ source })), false, String(source));
    }
    assert.equal(isRenewing(access({ subscription: null })), false);
    assert.equal(isRenewing(NONE), false);
  });
});

describe("a renewing subscription's period end", () => {
  it("is RENEWAL_GRACE_MS (72 h, like the database's content grace) and RENEWAL_SETTLE_MS (5 min)", () => {
    assert.equal(RENEWAL_GRACE_MS, 72 * H);
    assert.equal(RENEWAL_SETTLE_MS, 5 * 60_000);
  });

  it("is not a hard end: the app has not heard of the renewal yet, so access goes on for 72 h", () => {
    assert.equal(stateOf(renewing(H)), "active");
    for (const ago of [0, 1, H, 71 * H]) {
      const a = renewing(-ago);
      assert.equal(stateOf(a), "active", `${ago} ms past the period end`);
      assert.equal(hasAccessNow(a, NOW), true, `${ago} ms past the period end`);
    }
  });

  it("lapses once the 72 h have run out", () => {
    for (const ago of [RENEWAL_GRACE_MS, RENEWAL_GRACE_MS + 1, 73 * H, 10 * DAY]) {
      assert.equal(stateOf(renewing(-ago)), "lapsed", `${ago} ms past the period end`);
      assert.equal(hasAccessNow(renewing(-ago), NOW), false, `${ago} ms past the period end`);
    }
  });

  it("never outlives the server saying no: a fresh answer without access is lapsed, renewing row or not", () => {
    const no = (over: Partial<MyAccess>) =>
      access({ has_access: false, source: null, subscription: sub({ access_until: at(-H) }), ...over });
    assert.equal(stateOf(no({ access_ends_at: null })), "lapsed");
    assert.equal(stateOf(no({ access_ends_at: at(H) })), "lapsed");
    assert.equal(hasAccessNow(no({ access_ends_at: at(-H) }), NOW), false);
  });

  it("is a hard end for the other states, which the store will not extend", () => {
    const hard = (subscription: MyAccessSubscription) =>
      access({ access_ends_at: at(-H), subscription });
    assert.equal(stateOf(hard(sub({ status: "cancelled", will_renew: false }))), "lapsed");
    assert.equal(stateOf(hard(sub({ status: "billing_issue", will_renew: false }))), "lapsed");
    // A failing charge the store is still retrying: its grace is the end.
    assert.equal(stateOf(hard(sub({ status: "billing_issue", will_renew: true }))), "lapsed");
  });

  it("still tells a renewing subscriber's access from a billing problem or a cancellation", () => {
    assert.equal(stateOf(renewing(-H)), "active");
    assert.equal(stateOf(access({ subscription: sub({ status: "billing_issue", will_renew: false }) })), "grace");
  });
});

describe("needsRenewalSync", () => {
  const unrenewed = (endedAgo: number, over: Partial<MyAccessSubscription> = {}): MyAccess =>
    access({ subscription: sub({ access_until: at(-endedAgo), ...over }) });

  it("is false without an answer and while the switch is off: nothing is asked while dark", () => {
    assert.equal(needsRenewalSync(null, NOW), false);
    assert.equal(needsRenewalSync({ ...unrenewed(DAY), enforced: false }, NOW), false);
    assert.equal(needsRenewalSync(OPEN_ACCESS, NOW), false);
  });

  it("is true once a renewing subscription's period ended RENEWAL_SETTLE_MS ago and the answer still holds that end", () => {
    assert.equal(needsRenewalSync(unrenewed(RENEWAL_SETTLE_MS), NOW), true);
    assert.equal(needsRenewalSync(unrenewed(H), NOW), true);
    assert.equal(needsRenewalSync(unrenewed(30 * DAY), NOW), true);
  });

  it("waits while the store's notification may still be on its way", () => {
    assert.equal(needsRenewalSync(access(), NOW), false);
    assert.equal(needsRenewalSync(unrenewed(-H), NOW), false);
    assert.equal(needsRenewalSync(unrenewed(0), NOW), false);
    assert.equal(needsRenewalSync(unrenewed(RENEWAL_SETTLE_MS - 1), NOW), false);
  });

  it("also holds after the grace and for an answer that says no: that paying client needs the repair most", () => {
    const lost = access({
      has_access: false,
      source: null,
      access_ends_at: null,
      subscription: sub({ access_until: at(-4 * DAY) }),
    });
    assert.equal(needsRenewalSync(lost, NOW), true);
  });

  it("is false for what the store will not renew, and for no subscription", () => {
    for (const over of [
      { status: "cancelled", will_renew: false },
      { status: "billing_issue", will_renew: false },
      { status: "expired", will_renew: false },
      { status: "active", will_renew: false },
    ] as const) {
      assert.equal(needsRenewalSync(unrenewed(DAY, over), NOW), false, `${over.status} ${over.will_renew}`);
    }
    assert.equal(needsRenewalSync(access({ subscription: null }), NOW), false);
    assert.equal(needsRenewalSync(NONE, NOW), false);
  });

  it("is false when the period has no readable end", () => {
    assert.equal(needsRenewalSync(access({ subscription: sub({ access_until: "infinity" }) }), NOW), false);
    assert.equal(needsRenewalSync(access({ subscription: sub({ access_until: "" }) }), NOW), false);
    assert.equal(needsRenewalSync(access({ subscription: sub({ access_until: "not a date" }) }), NOW), false);
  });
});

describe("contentGate", () => {
  const GATES: GateKind[] = ["program", "nutrition_plan", "supplement_plan"];
  const FLAG = {
    program: "has_program",
    nutrition_plan: "has_nutrition_plan",
    supplement_plan: "has_supplement_plan",
  } as const;
  const PENDING_KIND: Record<GateKind, ContentRequestKind | null> = {
    program: "program",
    nutrition_plan: "nutrition_plan",
    supplement_plan: null,
  };

  for (const gate of GATES) {
    const kind = PENDING_KIND[gate];
    const withState = (a: MyAccess) => ({ gate, state: stateOf(a), access: a });

    describe(gate, () => {
      for (const label of ["active", "open"] as const) {
        const a = label === "active" ? access() : OPEN_ACCESS;
        // With requestsEnabledWhileOpen on (what the hook passes) requests are
        // offered while the switch is off; with it off they are not (see below).
        const dev = label === "open" ? { requestsEnabledWhileOpen: true } : {};

        it(`${label}: shows the content it has, even beside a pending request`, () => {
          assert.deepEqual(
            contentGate({
              ...withState(a),
              ...dev,
              hasContent: true,
              pending: kind ? request({ kind }) : null,
            }),
            { kind: "content" },
          );
        });

        if (kind != null) {
          it(`${label}: offers a request when there is no content and nothing pending`, () => {
            assert.deepEqual(contentGate({ ...withState(a), ...dev, hasContent: false, pending: null }), {
              kind: "empty",
              action: "request",
            });
          });

          it(`${label}: says the request was sent while one is pending`, () => {
            const pending = request({ kind, created_at: "2026-11-20T10:00:00Z" });
            assert.deepEqual(contentGate({ ...withState(a), ...dev, hasContent: false, pending }), {
              kind: "pending",
              since: "2026-11-20T10:00:00Z",
            });
          });
        } else {
          it(`${label}: has no request to offer, so an empty stack stays plain`, () => {
            assert.deepEqual(contentGate({ ...withState(a), ...dev, hasContent: false, pending: null }), {
              kind: "empty",
              action: null,
            });
          });
        }
      }

      if (kind != null) {
        it("open (the switch off) with requests not enabled: no request is offered, whatever the requests say: today's plain empty state", () => {
          // The option off is what a release build did before the panel showed
          // requests: a button would promise an answer nobody sees.
          const plain = { kind: "empty", action: null };
          const base = { ...withState(OPEN_ACCESS), hasContent: false };
          assert.deepEqual(contentGate({ ...base, pending: null }), plain);
          assert.deepEqual(contentGate({ ...base, pending: null, requestsEnabledWhileOpen: false }), plain);
          assert.deepEqual(contentGate({ ...base, pending: request({ kind }) }), plain);
          assert.deepEqual(contentGate({ ...base, pending: null, requestsLoading: true }), plain);
        });

        it("open with requests not enabled still shows the content it has", () => {
          assert.deepEqual(contentGate({ ...withState(OPEN_ACCESS), hasContent: true, pending: null }), {
            kind: "content",
          });
        });

        it("the switch on offers requests whatever requestsEnabledWhileOpen says", () => {
          for (const flag of [false, true]) {
            assert.deepEqual(
              contentGate({
                ...withState(access()),
                hasContent: false,
                pending: null,
                requestsEnabledWhileOpen: flag,
              }),
              { kind: "empty", action: "request" },
            );
          }
        });
      }

      it("lapsed with the content assigned: locked, even when a stale copy is cached", () => {
        const a = { ...NONE, [FLAG[gate]]: true } as MyAccess;
        assert.deepEqual(contentGate({ ...withState(a), hasContent: true, pending: null }), { kind: "locked" });
        assert.deepEqual(contentGate({ ...withState(a), hasContent: false, pending: null }), { kind: "locked" });
      });

      it("lapsed with nothing assigned: the paywall, except where there is no request", () => {
        assert.deepEqual(contentGate({ ...withState(NONE), hasContent: false, pending: null }), {
          kind: "empty",
          action: kind == null ? null : "paywall",
        });
      });

      it("lapsed: another gate's flag does not lock this one", () => {
        const other = GATES.find((g) => g !== gate)!;
        const a = { ...NONE, [FLAG[other]]: true } as MyAccess;
        assert.notEqual(contentGate({ ...withState(a), hasContent: false, pending: null }).kind, "locked");
      });

      it("the coach never sees a button that would be refused", () => {
        const coach = access({ source: "coach", access_ends_at: null, subscription: null });
        assert.deepEqual(contentGate({ ...withState(coach), hasContent: false, pending: null }), {
          kind: "empty",
          action: null,
        });
      });

      it("while the answer loads: content in hand shows, otherwise a loader", () => {
        const loading = { gate, state: "loading" as AccessState, access: null };
        assert.deepEqual(contentGate({ ...loading, hasContent: true, pending: null }), { kind: "content" });
        assert.deepEqual(contentGate({ ...loading, hasContent: false, pending: null }), { kind: "loading" });
      });

      it("while the client's requests still load, nothing is offered: no flash of «Solicitar» before «Solicitud enviada»", () => {
        const base = {
          gate,
          state: stateOf(access()),
          access: access(),
          hasContent: false,
          pending: null,
          requestsLoading: true,
        };
        // What would flash is the request button; a stack with no request has nothing to wait for.
        assert.deepEqual(contentGate(base), kind == null ? { kind: "empty", action: null } : { kind: "loading" });
        // Content in hand, a request already known and a locked client are not held back.
        assert.deepEqual(contentGate({ ...base, hasContent: true }), { kind: "content" });
        if (kind != null) assert.equal(contentGate({ ...base, pending: request({ kind }) }).kind, "pending");
        assert.deepEqual(contentGate({ ...base, state: stateOf(NONE), access: NONE }), {
          kind: "empty",
          action: kind == null ? null : "paywall",
        });
      });
    });
  }

  it("a request is for the program or the nutrition plan, never the supplements", () => {
    assert.equal(requestKindOf("program"), "program");
    assert.equal(requestKindOf("nutrition_plan"), "nutrition_plan");
    assert.equal(requestKindOf("supplement_plan"), null);
  });
});

describe("pendingRequest", () => {
  it("is the newest pending request of that kind", () => {
    const list = [
      request({ id: "old", created_at: "2026-11-01T00:00:00Z" }),
      request({ id: "new", created_at: "2026-11-20T00:00:00Z" }),
    ];
    assert.equal(pendingRequest(list, "program")?.id, "new");
  });

  it("ignores fulfilled and dismissed requests and the other kind", () => {
    const list = [
      request({ id: "done", status: "fulfilled" }),
      request({ id: "no", status: "dismissed" }),
      request({ id: "plan", kind: "nutrition_plan" }),
    ];
    assert.equal(pendingRequest(list, "program"), null);
    assert.equal(pendingRequest(list, "nutrition_plan")?.id, "plan");
    assert.equal(pendingRequest([], "program"), null);
  });
});

/** Does a dotted i18n key resolve to a text in this language? */
function resolves(lang: unknown, key: string): boolean {
  let node = lang;
  for (const part of key.split(".")) {
    if (node == null || typeof node !== "object") return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" && node !== "";
}

describe("gateCopy", () => {
  const GATES: GateKind[] = ["program", "nutrition_plan", "supplement_plan"];
  const SHOWN: ShownGate[] = [
    { kind: "empty", action: null },
    { kind: "empty", action: "request" },
    { kind: "empty", action: "paywall" },
    { kind: "pending", since: "2026-11-20T10:00:00Z" },
    { kind: "locked" },
  ];

  it("only uses keys that exist in both languages", () => {
    for (const gate of GATES) {
      for (const shown of SHOWN) {
        const copy = gateCopy(gate, shown);
        const keys = [copy.titleKey, copy.hintKey, copy.actionKey, copy.footnoteKey].filter(
          (k): k is string => k != null,
        );
        for (const key of keys) {
          assert.ok(resolves(es, key), `es ${key} (${gate}, ${shown.kind})`);
          assert.ok(resolves(en, key), `en ${key} (${gate}, ${shown.kind})`);
        }
      }
    }
  });

  it("keeps the app's own empty texts when there is nothing to offer", () => {
    assert.equal(gateCopy("program", { kind: "empty", action: null }).titleKey, "coach.noProgramTitle");
    assert.equal(gateCopy("nutrition_plan", { kind: "empty", action: null }).titleKey, "mealReg.noPlanTitle");
    assert.equal(gateCopy("supplement_plan", { kind: "empty", action: null }).titleKey, "supplements.noPlanTitle");
    assert.equal(gateCopy("program", { kind: "empty", action: null }).actionKey, null);
  });

  it("marks the plain empty state, which Home shows as it did before Premium: the hint, with no title", () => {
    for (const gate of GATES) {
      assert.equal(gateCopy(gate, { kind: "empty", action: null }).plain, true, gate);
      for (const shown of SHOWN) {
        if (shown.kind === "empty" && shown.action == null) continue;
        assert.equal(gateCopy(gate, shown).plain, false, `${gate} ${shown.kind}`);
      }
    }
  });

  it("offers a request, or the paywall, with the spec's copy", () => {
    const request = gateCopy("program", { kind: "empty", action: "request" });
    assert.equal(request.titleKey, "premium.gate.program.title");
    assert.equal(request.hintKey, "premium.gate.program.requestHint");
    assert.equal(request.actionKey, "premium.gate.program.requestAction");
    assert.equal(request.action, "request");
    assert.equal(request.icon, "ribbon-outline");

    const paywall = gateCopy("nutrition_plan", { kind: "empty", action: "paywall" });
    assert.equal(paywall.hintKey, "premium.gate.nutrition.noneHint");
    assert.equal(paywall.actionKey, "premium.gate.nutrition.requestAction");
    assert.equal(paywall.action, "paywall");
    assert.equal(paywall.icon, "nutrition-outline");
  });

  it("says the request was sent, with the date as a footnote and no button", () => {
    const copy = gateCopy("program", { kind: "pending", since: "2026-11-20T10:00:00Z" });
    assert.equal(copy.titleKey, "premium.gate.pendingTitle");
    assert.equal(copy.hintKey, "premium.gate.pendingHint");
    assert.equal(copy.footnoteKey, "premium.gate.pendingSince");
    assert.equal(copy.actionKey, null);
    assert.equal(copy.action, null);
  });

  it("says the access ended and offers the renewal, naming what is locked", () => {
    const program = gateCopy("program", { kind: "locked" });
    assert.equal(program.titleKey, "premium.gate.lockedTitle");
    assert.equal(program.hintKey, "premium.gate.program.lockedHint");
    assert.equal(program.actionKey, "premium.gate.renewAction");
    assert.equal(program.action, "paywall");
    assert.equal(program.icon, "lock-closed-outline");
    assert.equal(gateCopy("nutrition_plan", { kind: "locked" }).hintKey, "premium.gate.nutrition.lockedHint");
    assert.equal(gateCopy("supplement_plan", { kind: "locked" }).hintKey, "premium.gate.supplements.lockedHint");
  });
});

describe("nutritionPane", () => {
  const base = { state: "active" as AccessState, access: access() };

  it("opens the plan, else the supplements, else the plan", () => {
    assert.equal(nutritionPane({ ...base, hasPlan: true, hasSupplements: true }), "plan");
    assert.equal(nutritionPane({ ...base, hasPlan: false, hasSupplements: true }), "supplements");
    assert.equal(nutritionPane({ ...base, hasPlan: false, hasSupplements: false }), "plan");
  });

  it("when locked, the flags decide: nothing can be read to look at", () => {
    const locked = { state: "lapsed" as AccessState, hasPlan: false, hasSupplements: false };
    assert.equal(nutritionPane({ ...locked, access: { ...NONE, has_supplement_plan: true } }), "supplements");
    assert.equal(
      nutritionPane({ ...locked, access: { ...NONE, has_nutrition_plan: true, has_supplement_plan: true } }),
      "plan",
    );
    assert.equal(nutritionPane({ ...locked, access: NONE }), "plan");
  });
});

describe("subscriptionCard", () => {
  /** The card for an answer, with the state derived the way the hook does. */
  function card(a: MyAccess | null, opts: { purchasable?: boolean; dev?: boolean } = {}) {
    return subscriptionCard({
      access: a,
      state: stateOf(a),
      purchasable: opts.purchasable ?? true,
      dev: opts.dev ?? false,
      now: NOW,
    });
  }

  it("is hidden while loading, for the coach, and while dark with no subscription", () => {
    assert.equal(card(null).show, false);
    assert.equal(card(access({ source: "coach", access_ends_at: null, subscription: null })).show, false);
    assert.equal(card(OPEN_ACCESS).show, false);
    assert.equal(card(OPEN_ACCESS, { purchasable: false, dev: true }).show, false);
  });

  it("shows while dark for a tester: a dev client that can buy, or a subscription already there", () => {
    const dev = card(OPEN_ACCESS, { dev: true });
    assert.equal(dev.show, true);
    assert.equal(dev.status, "none");
    assert.equal(dev.action, "plans");
    assert.equal(card({ ...OPEN_ACCESS, subscription: sub() }).show, true);
  });

  it("names the status", () => {
    assert.equal(card(NONE).status, "none");
    assert.equal(card({ ...NONE, subscription: sub({ status: "expired", is_premium: false }) }).status, "expired");
    assert.equal(card(access()).status, "active");
    assert.equal(card(access({ subscription: sub({ status: "cancelled", will_renew: false }) })).status, "cancelled");
    assert.equal(card(access({ subscription: sub({ status: "billing_issue", will_renew: false }) })).status, "billing_issue");
    assert.equal(
      card(access({ source: "membership", access_ends_at: null, subscription: null, membership: { status: "active", expires_at: null } })).status,
      "membership",
    );
  });

  it("dates it: renews, ends or ended", () => {
    assert.deepEqual(card(access()).date, { kind: "renews", iso: at(25 * DAY) });
    assert.deepEqual(
      card(access({ access_ends_at: at(3 * DAY), subscription: sub({ status: "cancelled", will_renew: false, expires_at: at(2 * DAY) }) })).date,
      { kind: "ends", iso: at(3 * DAY) },
    );
    assert.deepEqual(
      card(access({ access_ends_at: at(DAY), subscription: sub({ status: "billing_issue", will_renew: false }) })).date,
      { kind: "ends", iso: at(DAY) },
    );
    assert.deepEqual(
      card({ ...NONE, subscription: sub({ status: "expired", is_premium: false, access_until: at(-2 * DAY) }) }).date,
      { kind: "ended", iso: at(-2 * DAY) },
    );
    assert.deepEqual(
      card(access({ source: "membership", access_ends_at: at(9 * DAY), subscription: null, membership: { status: "active", expires_at: "2026-12-02" } })).date,
      { kind: "ends", iso: at(9 * DAY) },
    );
  });

  it("shows no date it cannot stand behind", () => {
    assert.equal(card(NONE).date, null);
    assert.equal(
      card(access({ source: "membership", access_ends_at: null, subscription: null, membership: { status: "active", expires_at: null } })).date,
      null,
    );
    assert.equal(card({ ...NONE, subscription: sub({ status: "expired", is_premium: false, access_until: "infinity" }) }).date, null);
    assert.equal(card(access({ subscription: sub({ expires_at: "garbage" }) })).date, null);
    // The renewal is being processed: «se renueva el <ayer>» would be wrong.
    assert.equal(card(access({ subscription: sub({ expires_at: at(-H) }) })).date, null);
  });

  it("flags a sandbox subscription", () => {
    assert.equal(card(access({ subscription: sub({ environment: "sandbox" }) })).sandbox, true);
    assert.equal(card(access()).sandbox, false);
  });

  it("offers plans or a renewal only where buying is possible and the switch is on (or a dev client)", () => {
    assert.equal(card(NONE).action, "plans");
    assert.equal(card({ ...NONE, subscription: sub({ status: "expired", is_premium: false }) }).action, "renew");
    assert.equal(card(access()).action, null);
    assert.equal(card(NONE, { purchasable: false }).action, null);
    // Dark, with a subscription row, and not a dev client: nothing to sell yet.
    assert.equal(card({ ...OPEN_ACCESS, subscription: sub({ status: "expired", is_premium: false }) }).action, null);
    assert.equal(card({ ...OPEN_ACCESS, subscription: sub({ status: "expired", is_premium: false }) }, { dev: true }).action, "renew");
  });

  it("manages and restores only where there is a store to talk to", () => {
    const paying = card(access());
    assert.equal(paying.manage, true);
    assert.equal(paying.restore, true);
    assert.equal(card(NONE).manage, false);
    assert.equal(card(NONE).restore, true);
    const web = card(access(), { purchasable: false });
    assert.equal(web.manage, false);
    assert.equal(web.restore, false);
  });

  it("tells the web client that the store apps do the buying", () => {
    assert.equal(card(NONE, { purchasable: false }).storeOnly, true);
    assert.equal(card({ ...NONE, subscription: sub({ status: "expired", is_premium: false }) }, { purchasable: false }).storeOnly, true);
    assert.equal(card(access(), { purchasable: false }).storeOnly, false);
    assert.equal(card(NONE).storeOnly, false);
  });
});
