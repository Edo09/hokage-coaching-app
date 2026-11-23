import { useSyncExternalStore } from "react";
import { AppState, type NativeEventSubscription } from "react-native";

// The clock the Premium screens read «has access ended?» against. A store, like
// src/lib/today.ts, so a screen can flip to locked when the moment comes
// without a round trip (docs/superpowers/specs/2026-11-16-premium-
// subscriptions-design.md, «usePremiumAccess»).
//
// Its value only moves when `tickAccessClock` is called: by the provider's
// timer at the end of access, on returning to the foreground (timers stall in
// the background), and when the first reader mounts. Every decision that
// depends on the clock (access ending) has a tick aimed at it, so a stale
// value never changes an answer. Reading the real clock inside a snapshot
// would hand React a new object on every call.

let current = new Date();
const listeners = new Set<() => void>();
let appState: NativeEventSubscription | null = null;

/** Re-reads the clock and re-renders everyone reading it. */
export function tickAccessClock(): void {
  current = new Date();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    // Nobody was reading, so nothing kept it fresh.
    current = new Date();
    appState = AppState.addEventListener("change", (status) => {
      if (status === "active") tickAccessClock();
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      appState?.remove();
      appState = null;
    }
  };
}

const snapshot = () => current;

/** The access clock: the same Date until the next tick, safe in effect deps. */
export function useAccessClock(): Date {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
