import { DEFAULT_REMINDER_PREFS, type ReminderPrefs } from "@/src/utils/reminders";

// The pure half of the reminder preferences store (src/lib/reminder-prefs.ts):
// reading back what AsyncStorage holds and applying a change. No React, no
// storage, so `npm test` can run it.

/** The reminder hour picker in Ajustes: whole hours from 5:00 to 22:00. */
export const REMINDER_HOUR_MIN = 5;
export const REMINDER_HOUR_MAX = 22;
export const REMINDER_HOURS: number[] = Array.from(
  { length: REMINDER_HOUR_MAX - REMINDER_HOUR_MIN + 1 },
  (_, i) => REMINDER_HOUR_MIN + i,
);

function isReminderHour(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= REMINDER_HOUR_MIN &&
    value <= REMINDER_HOUR_MAX
  );
}

/** `value`'s valid fields over `base`. Field by field, so one bad or missing
    field (an older or newer app version wrote it) keeps the others. */
function mergeValid(base: ReminderPrefs, value: unknown): ReminderPrefs {
  if (value == null || typeof value !== "object") return base;
  const v = value as Record<string, unknown>;
  return {
    training: typeof v.training === "boolean" ? v.training : base.training,
    inactivity: typeof v.inactivity === "boolean" ? v.inactivity : base.inactivity,
    weekOpened: typeof v.weekOpened === "boolean" ? v.weekOpened : base.weekOpened,
    hour: isReminderHour(v.hour) ? v.hour : base.hour,
  };
}

/** The stored JSON → prefs. Nothing stored, unreadable JSON or an invalid
    field falls back to the defaults. */
export function parseReminderPrefs(raw: string | null): ReminderPrefs {
  if (raw == null) return DEFAULT_REMINDER_PREFS;
  try {
    return mergeValid(DEFAULT_REMINDER_PREFS, JSON.parse(raw));
  } catch {
    return DEFAULT_REMINDER_PREFS;
  }
}

/** `current` with the patch's valid fields applied; invalid ones are ignored. */
export function applyReminderPrefsPatch(
  current: ReminderPrefs,
  patch: Partial<ReminderPrefs>,
): ReminderPrefs {
  return mergeValid(current, patch);
}

export function sameReminderPrefs(a: ReminderPrefs, b: ReminderPrefs): boolean {
  return (
    a.training === b.training &&
    a.inactivity === b.inactivity &&
    a.weekOpened === b.weekOpened &&
    a.hour === b.hour
  );
}
