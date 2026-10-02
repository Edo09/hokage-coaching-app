import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

import {
  applyReminderPrefsPatch,
  parseReminderPrefs,
  sameReminderPrefs,
} from "@/src/utils/reminder-prefs";
import { DEFAULT_REMINDER_PREFS, type ReminderPrefs } from "@/src/utils/reminders";

// Which local reminders this phone schedules, and at what hour (Ajustes →
// Notificaciones). A per-device choice, like the rest-alert mode: the phone
// schedules the reminders, so the phone keeps the choice. Kept across
// sign-outs for the same reason.

const PREFS_KEY = "app_reminder_prefs";

let prefs: ReminderPrefs = DEFAULT_REMINDER_PREFS;
/** Set by the first change, so a slow restore can't undo it. */
let changed = false;
/** The stored choice has been read (or there was none, or it couldn't be
    read). Until then `prefs` are only the defaults, and a plan built from
    them could schedule 8:00 reminders the client turned off. */
let ready = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

// Restore once at module load; the defaults until it resolves.
void AsyncStorage.getItem(PREFS_KEY)
  .then((stored) => {
    if (changed || stored == null) return;
    const restored = parseReminderPrefs(stored);
    if (!sameReminderPrefs(prefs, restored)) prefs = restored;
  })
  .catch(() => {})
  .finally(() => {
    ready = true;
    emit();
  });

export function getReminderPrefs(): ReminderPrefs {
  return prefs;
}

/** True once the stored preferences have been read (see `ready`). */
export function reminderPrefsReady(): boolean {
  return ready;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useReminderPrefs(): ReminderPrefs {
  return useSyncExternalStore(subscribe, getReminderPrefs, getReminderPrefs);
}

export function useReminderPrefsReady(): boolean {
  return useSyncExternalStore(subscribe, reminderPrefsReady, reminderPrefsReady);
}

/** Merge, apply, persist. Invalid values in the patch are ignored. */
export async function setReminderPrefs(patch: Partial<ReminderPrefs>): Promise<void> {
  changed = true;
  const next = applyReminderPrefsPatch(prefs, patch);
  if (!sameReminderPrefs(prefs, next)) {
    prefs = next;
    emit();
  }
  try {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // Non-fatal: the choice still applies for this session
  }
}
