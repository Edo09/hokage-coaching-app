import { useSyncExternalStore } from "react";

import type { ContentRequestKind } from "@/src/types/database";

// Which request sheet is open, if any: «Solicitar programa» or «Solicitar Plan
// de nutrición». A tiny store, like src/lib/exercise-session.ts, so the training
// tab, the nutrition tab and Home open the one sheet the tabs layout hosts
// (src/components/premium/request-sheet.tsx) without owning a Modal each.

let current: ContentRequestKind | null = null;
const listeners = new Set<() => void>();

function set(next: ContentRequestKind | null) {
  if (next === current) return;
  current = next;
  listeners.forEach((listener) => listener());
}

/** The sheet's Modal reports its dismissal only on iOS, and only through
    onDismiss. If it never does, the action waiting for it runs after this
    long anyway, so a button that closes the sheet to go elsewhere cannot do
    nothing. */
export const DISMISS_FALLBACK_MS = 1_000;

let waiting: { action: () => void; timer: ReturnType<typeof setTimeout> } | null = null;

function runWaiting() {
  const task = waiting;
  if (task == null) return;
  waiting = null;
  clearTimeout(task.timer);
  task.action();
}

function dropWaiting() {
  if (waiting == null) return;
  clearTimeout(waiting.timer);
  waiting = null;
}

export const requestSheet = {
  /** Opening again before the sheet has gone voids what was waiting for it. */
  open: (kind: ContentRequestKind) => {
    dropWaiting();
    set(kind);
  },
  close: () => set(null),
  /**
   * Closes the sheet and runs `action` once it has gone: pushing a native modal
   * screen (the paywall) while the sheet's own Modal is still dismissing leaves
   * the screen unpresented on iOS. Runs at once if the sheet is already
   * closed; once only, the last action asked for winning; a late or missing
   * dismissal is covered by `fallbackMs`.
   */
  closeThen: (action: () => void, fallbackMs: number = DISMISS_FALLBACK_MS) => {
    if (current == null && waiting == null) {
      action();
      return;
    }
    dropWaiting();
    waiting = { action, timer: setTimeout(runWaiting, fallbackMs) };
    set(null);
  },
  /** The sheet's Modal has finished dismissing (BottomSheet's onDismiss). */
  dismissed: runWaiting,
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The kind the sheet is open for; null while it is closed. */
export const getRequestSheet = (): ContentRequestKind | null => current;

/** The kind the sheet is open for; null while it is closed. */
export function useRequestSheet(): ContentRequestKind | null {
  return useSyncExternalStore(subscribe, getRequestSheet, getRequestSheet);
}
