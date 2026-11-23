import type { PurchaseFailure } from "@/src/utils/purchase";

// What follows what on the paywall (docs/superpowers/specs/2026-11-16-premium-
// subscriptions-design.md, «Purchase states»). A pure reducer, so `npm test`
// pins the one rule that matters most: the store finishing a purchase is not
// a success. «bought» only starts confirming; only «confirmed», raised when
// the access query shows the subscription, ends in success, and a purchase
// the server is slow to confirm still turns to success when it arrives.

export type FlowState = {
  phase:
    | "idle"
    | "purchasing"
    /** Bought; waiting for the server (sync-subscription, then Realtime) to say so. */
    | "confirming"
    /** The wait ran out: «Tu compra se está procesando». Still listening. */
    | "processing"
    | "confirmed"
    | "restoring";
  /** The last failure to show, until the next action. A cancel never sets it. */
  failure: PurchaseFailure | null;
  /** A restore's outcome message, until the next action. */
  restored: "found" | "none" | null;
};

export const INITIAL_FLOW: FlowState = { phase: "idle", failure: null, restored: null };

export type FlowEvent =
  | { type: "buy" }
  | { type: "restore" }
  | { type: "bought" }
  | { type: "restoredFound" }
  | { type: "restoredNone" }
  | { type: "failed"; failure: PurchaseFailure }
  | { type: "confirmed" }
  | { type: "timedOut" }
  | { type: "dismiss" };

export function flowReducer(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case "buy":
      return state.phase === "idle" ? { phase: "purchasing", failure: null, restored: null } : state;
    case "restore":
      return state.phase === "idle" ? { phase: "restoring", failure: null, restored: null } : state;
    case "bought":
      return state.phase === "purchasing" ? { ...state, phase: "confirming" } : state;
    case "restoredFound":
      return state.phase === "restoring"
        ? { phase: "confirming", failure: null, restored: "found" }
        : state;
    case "restoredNone":
      return state.phase === "restoring"
        ? { phase: "idle", failure: null, restored: "none" }
        : state;
    case "failed":
      if (state.phase !== "purchasing" && state.phase !== "restoring") return state;
      return {
        phase: "idle",
        // Cancelling is the client's own choice: nothing to say.
        failure: event.failure.kind === "cancelled" ? null : event.failure,
        restored: null,
      };
    case "confirmed":
      return state.phase === "confirming" || state.phase === "processing"
        ? { ...state, phase: "confirmed" }
        : state;
    case "timedOut":
      return state.phase === "confirming" ? { ...state, phase: "processing" } : state;
    case "dismiss":
      return state.failure == null && state.restored == null
        ? state
        : { ...state, failure: null, restored: null };
  }
}
