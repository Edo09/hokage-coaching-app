import { dayNameToIndex } from "@/src/utils/progress";

// profiles.available_days, the client's training days: read and toggled by
// the day chips in Ajustes → Notificaciones. Pure, so `npm test` runs it.
// The same field feeds the reminders (src/utils/reminders.ts), Progreso's
// planned days and the coach's panel, so it's written the way onboarding and
// the panel write it.

/** The stored values, Monday first, like onboarding's DAY_VALUES and the
    panel's WEEK_DAYS. */
export const TRAINING_DAY_VALUES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** The weekdays (0 = Monday … 6 = Sunday) the stored list holds, read like
    the planner and Progreso read it (dayNameToIndex): "Mon", "monday" and
    "Monday" are all Monday; anything else is no day. */
export function trainingDayIndexes(days: readonly string[] | null | undefined): Set<number> {
  return new Set((days ?? []).map(dayNameToIndex).filter((i) => i >= 0));
}

/** `days` with weekday `index` switched on or off, written back as the
    stored values in Monday-first order (so the panel, which matches them
    exactly, shows them). */
export function toggleTrainingDay(
  days: readonly string[] | null | undefined,
  index: number,
): string[] {
  const picked = trainingDayIndexes(days);
  if (picked.has(index)) picked.delete(index);
  else picked.add(index);
  return TRAINING_DAY_VALUES.filter((_, i) => picked.has(i));
}
