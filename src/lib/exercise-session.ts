import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * The exercise in progress.
 *
 * Opening an exercise only shows it (to read the instructions, watch the
 * demo); "Empezar" makes it the one being done, and its clock runs until the
 * client pauses, finishes or quits it. One is timed at a time; starting
 * another banks the first one's time, which picks up again ("Continuar") if
 * they come back to it. Finishing keeps the time as the exercise's duration
 * (the day-complete stamp adds them up); quitting drops it.
 *
 * Time is derived from timestamps (like the rest timer), never counted by
 * ticks, so it stays right through backgrounding. Kept per user on the device
 * (AsyncStorage), so an app restart mid-exercise doesn't lose it. Which sheet
 * is on screen (`sheet`) is UI state and isn't persisted.
 */

export type SessionKey = string;
export const sessionKey = (exerciseId: string, week: number): SessionKey => `${exerciseId}|${week}`;

type Active = {
  exerciseId: string;
  week: number;
  /** When the clock last started; null while paused. */
  runningSince: number | null;
};

type Persisted = {
  active: Active | null;
  /** ms already on the clock, per exercise-week, not counting a running stretch. */
  banked: Record<SessionKey, number>;
  /** Seconds, per finished exercise-week. */
  finished: Record<SessionKey, number>;
};

export type SessionState = Persisted & {
  /** The exercise whose sheet is open; null = none (or minimized to the bar). */
  sheet: { exerciseId: string; week: number } | null;
};

const EMPTY: SessionState = { active: null, banked: {}, finished: {}, sheet: null };

let state: SessionState = EMPTY;
let userId: string | null = null;
const listeners = new Set<() => void>();

const storageKey = (id: string) => `exercise_session_v1:${id}`;

function commit(next: SessionState) {
  state = next;
  listeners.forEach((listener) => listener());
  if (userId != null) {
    const { active, banked, finished } = next;
    void AsyncStorage.setItem(storageKey(userId), JSON.stringify({ active, banked, finished })).catch(
      () => {},
    );
  }
}

/** Load (and from now on save) the signed-in user's sessions; null clears. */
export function setSessionUser(id: string | null) {
  if (id === userId) return;
  userId = id;
  state = EMPTY;
  listeners.forEach((listener) => listener());
  if (id == null) return;
  void AsyncStorage.getItem(storageKey(id))
    .then((raw) => {
      if (raw == null || userId !== id) return;
      const saved = JSON.parse(raw) as Partial<Persisted>;
      state = {
        active: saved.active ?? null,
        banked: saved.banked ?? {},
        finished: saved.finished ?? {},
        sheet: null,
      };
      listeners.forEach((listener) => listener());
    })
    .catch(() => {});
}

const isActive = (s: SessionState, exerciseId: string, week: number) =>
  s.active != null && s.active.exerciseId === exerciseId && s.active.week === week;

/** Time on an exercise's clock, ms. */
export function elapsedMs(s: SessionState, exerciseId: string, week: number, now = Date.now()): number {
  const banked = s.banked[sessionKey(exerciseId, week)] ?? 0;
  const since = isActive(s, exerciseId, week) ? s.active!.runningSince : null;
  return since != null ? banked + Math.max(0, now - since) : banked;
}

/** Stop the active clock (if running), moving its stretch into `banked`. */
function bankActive(s: SessionState, now: number): SessionState {
  const a = s.active;
  if (a == null || a.runningSince == null) return s;
  const key = sessionKey(a.exerciseId, a.week);
  return {
    ...s,
    banked: { ...s.banked, [key]: (s.banked[key] ?? 0) + Math.max(0, now - a.runningSince) },
    active: { ...a, runningSince: null },
  };
}

/** Drop an exercise from the clock; closes its sheet if it's the one open. */
function without(s: SessionState, exerciseId: string, week: number): SessionState {
  const { [sessionKey(exerciseId, week)]: _dropped, ...banked } = s.banked;
  const sheetOpen = s.sheet != null && s.sheet.exerciseId === exerciseId && s.sheet.week === week;
  return {
    ...s,
    banked,
    active: isActive(s, exerciseId, week) ? null : s.active,
    sheet: sheetOpen ? null : s.sheet,
  };
}

export const exerciseSession = {
  /** Show an exercise's sheet. Nothing starts until `start`. */
  open(exerciseId: string, week: number) {
    commit({ ...state, sheet: { exerciseId, week } });
  },

  /**
   * "Empezar": this exercise becomes the one in progress and its clock runs,
   * from any time it already had. A different one in progress is banked.
   */
  start(exerciseId: string, week: number) {
    if (isActive(state, exerciseId, week)) return;
    const now = Date.now();
    commit({ ...bankActive(state, now), active: { exerciseId, week, runningSince: now } });
  },

  /** Close the sheet; an exercise in progress keeps going in the bar. */
  hide() {
    commit({ ...state, sheet: null });
  },

  /** Reopen the exercise in progress. */
  expand() {
    const a = state.active;
    if (a != null) commit({ ...state, sheet: { exerciseId: a.exerciseId, week: a.week } });
  },

  togglePause() {
    const a = state.active;
    if (a == null) return;
    commit(a.runningSince != null ? bankActive(state, Date.now()) : { ...state, active: { ...a, runningSince: Date.now() } });
  },

  /** Stop an exercise's clock and keep its time as its duration. Returns seconds. */
  finish(exerciseId: string, week: number): number {
    const seconds = Math.round(elapsedMs(state, exerciseId, week) / 1000);
    const next = without(state, exerciseId, week);
    commit(
      seconds > 0
        ? { ...next, finished: { ...next.finished, [sessionKey(exerciseId, week)]: seconds } }
        : next,
    );
    return seconds;
  },

  /** Leave an exercise without finishing it: its time is dropped. */
  quit(exerciseId: string, week: number) {
    commit(without(state, exerciseId, week));
  },

  /** Seconds a finished exercise took, or null if it wasn't timed. */
  finishedSeconds(exerciseId: string, week: number): number | null {
    return state.finished[sessionKey(exerciseId, week)] ?? null;
  },
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getState = () => state;

export function useExerciseSession(): SessionState {
  return useSyncExternalStore(subscribe, getState, getState);
}

/** Current time, re-rendering twice a second while `running`. */
export function useClock(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(Date.now());
    // First tick right away: `now` may be from before the clock started.
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 500);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [running]);
  return now;
}
