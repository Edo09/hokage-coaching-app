import { useSyncExternalStore } from "react";

/**
 * The card that answers a check-off: which one is up, if any. One at a time,
 * so a new check replaces the card instead of stacking a second one. The
 * host (`CheckCardHost`, mounted in the tabs layout) renders it, up until the
 * client closes it.
 *
 * Also the session's memory around it:
 *   - the burst of checks going on: a check within 8 s of the one before is
 *     logging after the fact, and the card collapses to a count of them;
 *   - the days whose day-complete modal already played, so re-checking a
 *     day's last exercise doesn't replay it.
 * Memory only: an app restart starts clean.
 */

export type CheckCardState =
  | {
      kind: "single";
      exerciseId: string;
      dayId: string;
      week: number;
      /** Time on its clock when «Terminar» checked it; null for a plain check. */
      seconds: number | null;
      /** Nothing but «Deshacer»: a past week, or another exercise's clock is running. */
      undoOnly: boolean;
    }
  | { kind: "batch"; items: { exerciseId: string; week: number }[] }
  | { kind: "dayAgain"; dayId: string; week: number; exerciseId: string };

/** Checks this close to the one before (ms) are one burst. */
export const BATCH_WINDOW_MS = 8000;

type Item = { exerciseId: string; week: number };

let state: CheckCardState | null = null;
/** The burst going on: its checks, and when the last one came. */
let run: { items: Item[]; lastMs: number } | null = null;
const celebrated = new Set<string>();
const listeners = new Set<() => void>();

function commit(next: CheckCardState | null) {
  state = next;
  listeners.forEach((listener) => listener());
}

const dayKey = (dayId: string, week: number) => `${dayId}|${week}`;

export const checkCard = {
  /** Put a card up, replacing the one that's up. */
  show(s: CheckCardState) {
    commit(s);
  },

  /**
   * Take the card down, and end the burst of checks (Deshacer, Siguiente, a
   * sheet opening, the day modal). The client closing the card (its ✕, the
   * backdrop, back, a swipe) passes `keepRun`: the next quick check still
   * collapses into the count.
   */
  dismiss(opts?: { keepRun?: boolean }) {
    if (opts?.keepRun !== true) run = null;
    if (state != null) commit(null);
  },

  get(): CheckCardState | null {
    return state;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /**
   * Count a check-off. Within 8 s of the check before, it joins the burst,
   * and once the burst holds two checks the card becomes the batch («3
   * hechos»): "batch", and the card is already up. Otherwise "single": the
   * caller puts up the card it wants.
   */
  noteCheck(exerciseId: string, week: number, nowMs: number): "single" | "batch" {
    const item = { exerciseId, week };
    if (run != null && nowMs - run.lastMs <= BATCH_WINDOW_MS) {
      const known = run.items.some((i) => i.exerciseId === exerciseId && i.week === week);
      run = { items: known ? run.items : [...run.items, item], lastMs: nowMs };
      // The burst's only exercise checked again (unchecked meanwhile): one
      // check, not «1 hechos».
      if (run.items.length < 2) return "single";
      commit({ kind: "batch", items: run.items });
      return "batch";
    }
    run = { items: [item], lastMs: nowMs };
    return "single";
  },

  /** The day-complete modal played for this day and week. */
  markCelebrated(dayId: string, week: number) {
    celebrated.add(dayKey(dayId, week));
  },

  wasCelebrated(dayId: string, week: number): boolean {
    return celebrated.has(dayKey(dayId, week));
  },
};

export function useCheckCard(): CheckCardState | null {
  return useSyncExternalStore(checkCard.subscribe, checkCard.get, checkCard.get);
}
