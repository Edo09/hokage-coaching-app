import { useSyncExternalStore } from "react";

/**
 * A request for the Programa tab to show one day: its week selected, the day
 * open and scrolled into view. The day-complete modal's «Ir al Día n» asks,
 * then navigates to the tab; the tab takes the request once its program is
 * on screen, so one made before the tab ever mounted waits for it.
 *
 * Only the latest request counts, and it's handed over once: a tab that
 * mounts later doesn't replay an old one.
 */

export type ProgramFocus = { week: number; dayId: string };

let pending: ProgramFocus | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export const programFocus = {
  /** Ask the Programa tab to show this week and day. Replaces any request
      still waiting. */
  request(focus: ProgramFocus) {
    pending = { week: focus.week, dayId: focus.dayId };
    emit();
  },

  /** The waiting request, now handed over (null when there's none). */
  take(): ProgramFocus | null {
    const focus = pending;
    if (focus != null) {
      pending = null;
      emit();
    }
    return focus;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

const getPending = () => pending;

/** The request waiting for the Programa tab, or null. A new object for every
    request, so asking for the same day twice still counts twice. */
export function useProgramFocus(): ProgramFocus | null {
  return useSyncExternalStore(programFocus.subscribe, getPending, getPending);
}
