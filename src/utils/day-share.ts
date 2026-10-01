import type { TFunction } from "i18next";

// The day-complete modal's «Contarle a {coach}»: the finished day's summary,
// typed into a WhatsApp chat with the coach. Pure (the caller passes `t`), so
// it runs under `npm test`.

/** What the message says about the finished day. */
export type DayShare = {
  /** The day's number (day_index). */
  n: number;
  /** Its label, or its weekday; null when it has neither. */
  label: string | null;
  exercises: number;
  /** The day modal's count: logged sets, or the prescribed ones when none were. */
  sets: number;
  /** Minutes on the exercise clock; null when nothing was timed. */
  minutes: number | null;
  /** The day's first new record, in the client's unit; null when none. */
  record: { name: string; weight: number; unit: string; reps: number } | null;
};

/** «¡Terminé el Día 3 (Pierna)! 5 ejercicios · 18 series · 42 min · Récord en
    Sentadilla: 100 kg × 5». The minutes and the record only when there are
    any. */
export function dayShareText(t: TFunction, day: DayShare): string {
  const stats = [
    t("dayDone.summaryExercises", { count: day.exercises }),
    t("dayDone.summarySets", { count: day.sets }),
  ];
  if (day.minutes != null) stats.push(t("dayDone.summaryMinutes", { minutes: day.minutes }));
  if (day.record != null) stats.push(t("dayDone.summaryRecord", { ...day.record }));
  return day.label != null
    ? t("dayDone.whatsappSummary", { n: day.n, label: day.label, stats: stats.join(" · ") })
    : t("dayDone.whatsappSummaryBare", { n: day.n, stats: stats.join(" · ") });
}

/** A wa.me chat with this number, the message typed in (the coach section's
    link). Any formatting in the number is dropped; null without digits. */
export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  const digits = (phone ?? "").replace(/[^0-9]/g, "");
  return digits === "" ? null : `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
