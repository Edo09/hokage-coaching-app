import type { TFunction } from "i18next";

import type { ProgramDay } from "@/src/types/database";

// day_of_week is stored as an English day name — lowercase from the create
// form ("thursday"), though some seed/legacy rows are capitalized ("Thursday").
// Normalize, then translate via the daysLong catalog. Falls back to the raw
// value for anything unexpected so it never renders blank.
export function dayLabel(
  day: string | null | undefined,
  t: TFunction,
): string | null {
  if (day == null || day.trim() === "") return null;
  const key = day.trim().toLowerCase();
  return t(`daysLong.${key}`, { defaultValue: day });
}

/** A program day's name for text outside the program screens (the local
    reminders): its label, else its weekday, the same pick as the home card's
    day title, else «Día n». That last one is reminders.dayN, in sentence
    case, not the home card's all-caps eyebrow (program.dayN, «DÍA n»). */
export function programDayName(
  day: Pick<ProgramDay, "label" | "weekday" | "day_index">,
  t: TFunction,
): string {
  if (day.label != null && day.label !== "") return day.label;
  return dayLabel(day.weekday, t) ?? t("reminders.dayN", { n: day.day_index });
}
