import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useSyncExternalStore } from "react";

import { overrideFor, parseStoredOverride, type StoredOverride } from "@/src/utils/day-override";
import type { ResolvedDay } from "@/src/utils/nutrition-plan";

// The day-type override from Nutrición's chip: it lasts for the day it was set
// on, survives a restart (or Android killing the app), and resets at midnight.
// Inicio's calorie goal reads the same store, so both screens agree. Kept per
// user, so it never carries over to the next account on this device. Same
// module-store shape as src/lib/muscle-map-view.ts.

const key = (userId: string) => `day_override_v1:${userId}`;

let stored: StoredOverride | null = null;
/** The user `stored` belongs to. */
let storedFor: string | null = null;
/** A pick made before the restore landed wins over the restore. */
let changed = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function load(userId: string) {
  if (storedFor === userId) return;
  storedFor = userId;
  stored = null;
  changed = false;
  emit();
  void AsyncStorage.getItem(key(userId))
    .then((raw) => {
      if (storedFor !== userId || changed) return;
      stored = parseStoredOverride(raw);
      emit();
    })
    .catch(() => {});
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getStored(): StoredOverride | null {
  return stored;
}

/** Today's override for this user, or null to follow the program. Until the
 *  restore lands the first render follows the program. */
export function useDayOverride(userId: string | undefined, todayKey: string): ResolvedDay | null {
  useEffect(() => {
    if (userId != null) load(userId);
  }, [userId]);
  const current = useSyncExternalStore(subscribe, getStored, getStored);
  return userId != null && storedFor === userId ? overrideFor(current, todayKey) : null;
}

/** Apply + persist; null clears it (back to the program's day). */
export async function setDayOverride(userId: string, todayKey: string, day: ResolvedDay | null): Promise<void> {
  storedFor = userId;
  changed = true;
  stored = day == null ? null : { dateKey: todayKey, day };
  emit();
  try {
    if (stored == null) await AsyncStorage.removeItem(key(userId));
    else await AsyncStorage.setItem(key(userId), JSON.stringify(stored));
  } catch {
    // Non-fatal: the pick still applies for this session
  }
}
