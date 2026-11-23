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

export const requestSheet = {
  open: (kind: ContentRequestKind) => set(kind),
  close: () => set(null),
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => current;

/** The kind the sheet is open for; null while it is closed. */
export function useRequestSheet(): ContentRequestKind | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
