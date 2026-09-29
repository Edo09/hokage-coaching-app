import { useSyncExternalStore } from "react";
import { AppState, type NativeEventSubscription } from "react-native";

import { dateKeyToDate, toDateKey } from "@/src/utils/dates";

// The device's local calendar day as a store. Screens keyed on it (the
// program's current week, "starts on", the Solo-semana-actual lock) move to
// the new day on their own: at local midnight while the app is open, and on
// returning to the foreground after the day changed in the background. A
// `new Date()` read inside a memo only moves when something else re-renders.

/** Milliseconds from `now` to the next local midnight. Calendar math, not
    now + 24h, so a 23- or 25-hour DST day still lands on 00:00. */
export function msUntilNextLocalMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

let key = toDateKey();
// Noon of the day (dateKeyToDate): one stable object per day for
// useSyncExternalStore, and far from any DST edge.
let today = dateKeyToDate(key);
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let appState: NativeEventSubscription | null = null;

/** Today (noon), re-read from the clock on every call, so any render after
    midnight already gets the new day; the timer and AppState below make sure
    one happens. The same object all day. */
export function getToday(): Date {
  const next = toDateKey();
  if (next !== key) {
    key = next;
    today = dateKeyToDate(next);
  }
  return today;
}

function emit() {
  listeners.forEach((listener) => listener());
}

// +1s: a timer that fires a hair early would still read the old day.
function scheduleMidnight() {
  if (timer != null) clearTimeout(timer);
  timer = setTimeout(() => {
    emit();
    scheduleMidnight();
  }, msUntilNextLocalMidnight(new Date()) + 1000);
}

/** Calls `listener` at local midnight and on returning to the foreground.
    The clock only runs while someone listens: the first subscriber starts the
    midnight timer and the AppState listener, the last one stops both. */
export function subscribeToday(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    scheduleMidnight();
    appState = AppState.addEventListener("change", (status) => {
      if (status !== "active") return;
      // Timers stall in the background: re-aim at the coming midnight.
      scheduleMidnight();
      emit();
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (timer != null) clearTimeout(timer);
      timer = null;
      appState?.remove();
      appState = null;
    }
  };
}

/** Today's local date (at noon). Re-renders when the day changes, and is the
    same object all day, so it is safe in memo and effect deps. */
export function useToday(): Date {
  return useSyncExternalStore(subscribeToday, getToday, getToday);
}
