/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  flowReducer,
  INITIAL_FLOW,
  settledByAccess,
  type FlowEvent,
  type FlowState,
} from "@/src/utils/purchase-flow";
import type { PurchaseFailure } from "@/src/utils/purchase";

const run = (events: FlowEvent[], from: FlowState = INITIAL_FLOW) =>
  events.reduce(flowReducer, from);

const phase = (p: FlowState["phase"]): FlowState => ({ phase: p, failure: null, restored: null });
const failed = (kind: PurchaseFailure["kind"], detail: string | null = null): FlowEvent => ({
  type: "failed",
  failure: { kind, detail },
});

describe("flowReducer: buying", () => {
  it("starts idle", () => {
    assert.deepEqual(INITIAL_FLOW, { phase: "idle", failure: null, restored: null });
  });

  it("buy starts a purchase and clears the last message", () => {
    const stale: FlowState = {
      phase: "idle",
      failure: { kind: "store_problem", detail: "x" },
      restored: "none",
    };
    assert.deepEqual(flowReducer(stale, { type: "buy" }), phase("purchasing"));
  });

  it("buy is ignored while anything is in progress or already done", () => {
    for (const p of ["purchasing", "confirming", "processing", "confirmed", "restoring"] as const) {
      const state = phase(p);
      assert.equal(flowReducer(state, { type: "buy" }), state, p);
    }
  });

  it("a bought package is confirming, never confirmed: the SDK alone shows no success", () => {
    const state = run([{ type: "buy" }, { type: "bought" }]);
    assert.deepEqual(state, phase("confirming"));
    assert.notEqual(state.phase, "confirmed");
  });

  it("bought is ignored outside a purchase", () => {
    for (const p of ["idle", "confirming", "processing", "confirmed", "restoring"] as const) {
      assert.equal(flowReducer(phase(p), { type: "bought" }).phase, p, p);
    }
  });
});

describe("flowReducer: confirming", () => {
  it("only the server's answer confirms: from confirming or processing", () => {
    assert.equal(flowReducer(phase("confirming"), { type: "confirmed" }).phase, "confirmed");
    assert.equal(flowReducer(phase("processing"), { type: "confirmed" }).phase, "confirmed");
  });

  it("nothing else can jump to success", () => {
    for (const p of ["idle", "purchasing", "restoring", "confirmed"] as const) {
      const state = phase(p);
      assert.equal(flowReducer(state, { type: "confirmed" }), state, p);
    }
  });

  it("times out from confirming into processing, and nowhere else", () => {
    assert.equal(flowReducer(phase("confirming"), { type: "timedOut" }).phase, "processing");
    for (const p of ["idle", "purchasing", "processing", "confirmed", "restoring"] as const) {
      const state = phase(p);
      assert.equal(flowReducer(state, { type: "timedOut" }), state, p);
    }
  });

  it("a slow server still ends in success: processing turns confirmed when access arrives", () => {
    const state = run([
      { type: "buy" },
      { type: "bought" },
      { type: "timedOut" },
      { type: "confirmed" },
    ]);
    assert.deepEqual(state, phase("confirmed"));
  });
});

describe("flowReducer: failures", () => {
  it("a cancelled purchase is silent", () => {
    assert.deepEqual(run([{ type: "buy" }, failed("cancelled")]), phase("idle"));
  });

  it("every other failure goes back to idle keeping its message", () => {
    for (const kind of ["pending", "offline", "already_purchased", "store_problem"] as const) {
      const state = run([{ type: "buy" }, failed(kind, "why")]);
      assert.deepEqual(state, { phase: "idle", failure: { kind, detail: "why" }, restored: null }, kind);
    }
  });

  it("the message stays until the next buy, restore or dismiss", () => {
    const withFailure = run([{ type: "buy" }, failed("offline")]);
    assert.equal(withFailure.failure?.kind, "offline");
    assert.equal(flowReducer(withFailure, { type: "buy" }).failure, null);
    assert.equal(flowReducer(withFailure, { type: "restore" }).failure, null);
    assert.equal(flowReducer(withFailure, { type: "dismiss" }).failure, null);
  });

  it("failed is ignored when nothing was in progress", () => {
    for (const p of ["idle", "confirming", "processing", "confirmed"] as const) {
      const state = phase(p);
      assert.equal(flowReducer(state, failed("store_problem")), state, p);
    }
  });
});

describe("flowReducer: restoring", () => {
  it("restore starts only from idle", () => {
    assert.deepEqual(flowReducer(INITIAL_FLOW, { type: "restore" }), phase("restoring"));
    for (const p of ["purchasing", "confirming", "processing", "confirmed", "restoring"] as const) {
      const state = phase(p);
      assert.equal(flowReducer(state, { type: "restore" }), state, p);
    }
  });

  it("finding nothing goes back to idle with a message", () => {
    assert.deepEqual(run([{ type: "restore" }, { type: "restoredNone" }]), {
      phase: "idle",
      failure: null,
      restored: "none",
    });
  });

  it("finding a purchase goes on to confirm it with the server", () => {
    assert.deepEqual(run([{ type: "restore" }, { type: "restoredFound" }]), {
      phase: "confirming",
      failure: null,
      restored: "found",
    });
  });

  it("a restore's success keeps its message", () => {
    const state = run([{ type: "restore" }, { type: "restoredFound" }, { type: "confirmed" }]);
    assert.equal(state.phase, "confirmed");
    assert.equal(state.restored, "found");
  });

  it("restore results are ignored outside a restore", () => {
    for (const event of [{ type: "restoredFound" }, { type: "restoredNone" }] as const) {
      const state = phase("idle");
      assert.equal(flowReducer(state, event), state, event.type);
    }
  });

  it("dismiss clears the restore message", () => {
    const state = run([{ type: "restore" }, { type: "restoredNone" }, { type: "dismiss" }]);
    assert.deepEqual(state, INITIAL_FLOW);
  });
});

describe("flowReducer: reset", () => {
  it("a finished flow goes back to idle, so the next restore or purchase can start", () => {
    for (const p of ["confirmed", "processing"] as const) {
      assert.deepEqual(flowReducer({ ...phase(p), restored: "found" }, { type: "reset" }), INITIAL_FLOW, p);
    }
  });

  it("never cuts a flow short: it is ignored while anything is in progress, and at rest", () => {
    for (const p of ["idle", "purchasing", "confirming", "restoring"] as const) {
      const state = phase(p);
      assert.equal(flowReducer(state, { type: "reset" }), state, p);
    }
  });
});

describe("settledByAccess", () => {
  it("the server already showing the subscription ends a wait that is still confirming or has given up", () => {
    // A sync that stalls must not keep «Confirmando tu compra…» up once Realtime
    // or the webhook has put the subscription in the access query.
    assert.equal(settledByAccess("confirming", true), true);
    assert.equal(settledByAccess("processing", true), true);
  });

  it("needs the subscription, and a wait to end", () => {
    assert.equal(settledByAccess("confirming", false), false);
    assert.equal(settledByAccess("processing", false), false);
    for (const p of ["idle", "purchasing", "restoring", "confirmed"] as const) {
      assert.equal(settledByAccess(p, true), false, p);
    }
  });
});
