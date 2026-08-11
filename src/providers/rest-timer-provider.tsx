import * as Haptics from "expo-haptics";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

/**
 * The rest timer between sets.
 *
 * ONE timer app-wide, deliberately: you rest once at a time, and a countdown
 * has to survive scrolling the day, opening an exercise sheet, or hopping to
 * another tab. Per-row state would die on unmount and let two timers run at
 * once.
 *
 * Time is derived from an END TIMESTAMP, never accumulated by counting ticks.
 * setInterval drifts, and JS timers are throttled or frozen while the app is
 * backgrounded — a counter would silently under-report exactly when the client
 * has put the phone down to lift. Recomputing `endsAt - now` means backgrounding
 * for the whole rest and coming back reads correctly.
 *
 * No sound and no local notification: the app ships neither expo-av nor
 * expo-notifications, so completion is signalled with haptics while the app is
 * foregrounded. A backgrounded finish is silent — documented, not hidden.
 */

type RestTimer = {
  /** Seconds left, floored. 0 when idle or finished. */
  remaining: number;
  /** What the timer was started with, for the progress bar. */
  total: number;
  /** Exercise name it was started from, shown in the bar. */
  label: string | null;
  running: boolean;
  paused: boolean;
  start: (seconds: number, label?: string) => void;
  stop: () => void;
  togglePause: () => void;
  /** Add (or subtract, with a negative) seconds mid-rest. Never goes below 0. */
  addTime: (seconds: number) => void;
};

const RestTimerContext = createContext<RestTimer | null>(null);

export function RestTimerProvider({ children }: { children: React.ReactNode }) {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [label, setLabel] = useState<string | null>(null);
  // While paused we hold the frozen remainder instead of an end timestamp.
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Guards the completion haptic so it fires once, not on every tick after 0.
  const firedRef = useRef(false);

  const running = endsAt != null || pausedAt != null;
  const paused = pausedAt != null;

  const remaining = useMemo(() => {
    if (pausedAt != null) return pausedAt;
    if (endsAt == null) return 0;
    return Math.max(0, Math.ceil((endsAt - now) / 1000));
  }, [endsAt, pausedAt, now]);

  // Tick only while actively counting down. Paused or idle costs nothing.
  // `now` is seeded by whoever sets endsAt, never here — a stale `now` at the
  // moment a timer starts would render a remainder LARGER than the prescribed
  // rest until the first tick corrected it.
  useEffect(() => {
    if (endsAt == null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [endsAt]);

  // Coming back from the background: the interval above may not have fired for
  // minutes, so resync immediately rather than showing a stale number.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") setNow(Date.now());
    });
    return () => sub.remove();
  }, []);

  // Completion: buzz once, then clear so the bar leaves the screen.
  useEffect(() => {
    if (endsAt == null || firedRef.current || remaining > 0) return;
    firedRef.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // Hold at 00:00 briefly so the client sees it land instead of the bar just
    // vanishing under their thumb.
    const id = setTimeout(() => {
      setEndsAt(null);
      setLabel(null);
      setTotal(0);
    }, 1200);
    return () => clearTimeout(id);
  }, [endsAt, remaining]);

  const start = useCallback((seconds: number, nextLabel?: string) => {
    if (seconds <= 0) return;
    const t0 = Date.now();
    firedRef.current = false;
    setTotal(seconds);
    setLabel(nextLabel ?? null);
    setPausedAt(null);
    setNow(t0);
    setEndsAt(t0 + seconds * 1000);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);

  const stop = useCallback(() => {
    firedRef.current = true;
    setEndsAt(null);
    setPausedAt(null);
    setLabel(null);
    setTotal(0);
  }, []);

  const togglePause = useCallback(() => {
    if (pausedAt != null) {
      // Resuming: rebuild the end timestamp from the frozen remainder.
      const t0 = Date.now();
      setNow(t0);
      setEndsAt(t0 + pausedAt * 1000);
      setPausedAt(null);
    } else if (endsAt != null) {
      // Pausing: freeze what's left and drop the timestamp, so no tick can move it.
      setPausedAt(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
      setEndsAt(null);
    }
    Haptics.selectionAsync().catch(() => {});
  }, [endsAt, pausedAt]);

  const addTime = useCallback((seconds: number) => {
    firedRef.current = false;
    setPausedAt((p) => (p == null ? null : Math.max(0, p + seconds)));
    setEndsAt((e) => (e == null ? null : Math.max(Date.now(), e + seconds * 1000)));
    setTotal((tt) => Math.max(0, tt + seconds));
    Haptics.selectionAsync().catch(() => {});
  }, []);

  const value = useMemo<RestTimer>(
    () => ({ remaining, total, label, running, paused, start, stop, togglePause, addTime }),
    [remaining, total, label, running, paused, start, stop, togglePause, addTime],
  );

  return <RestTimerContext.Provider value={value}>{children}</RestTimerContext.Provider>;
}

export function useRestTimer(): RestTimer {
  const ctx = useContext(RestTimerContext);
  if (ctx == null) {
    throw new Error("useRestTimer must be used inside <RestTimerProvider>");
  }
  return ctx;
}

/** "90" -> "1:30". Rest is always shown as m:ss so 90s never reads as 90 min. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
