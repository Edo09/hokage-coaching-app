// Local-date keys ("YYYY-MM-DD"). The diary makes dates user-visible, so keys
// must follow the device's local calendar day — toISOString() is UTC and
// shifts evening entries to "tomorrow" for anyone west of UTC.

export function toDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Noon-anchored: ±24h arithmetic can never cross a DST transition into the
// wrong calendar day when anchored at 12:00.
export function dateKeyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

export function addDays(key: string, delta: number): string {
  const d = dateKeyToDate(key);
  d.setDate(d.getDate() + delta);
  return toDateKey(d);
}

export function isDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** "Today" / "Yesterday" / localized short date. t() passed in to keep this a plain util. */
export function formatDayLabel(
  key: string,
  lang: string,
  t: (k: string) => string,
): string {
  const today = toDateKey();
  if (key === today) return t("meals.today");
  if (key === addDays(today, -1)) return t("meals.yesterday");
  return dateKeyToDate(key).toLocaleDateString(
    lang === "es" ? "es-ES" : "en-US",
    { weekday: "short", month: "short", day: "numeric" },
  );
}

/** "6 oct" / "Oct 6": day and short month, no weekday or year. */
export function formatShortDate(key: string, lang: string): string {
  return dateKeyToDate(key).toLocaleDateString(
    lang === "es" ? "es-ES" : "en-US",
    { day: "numeric", month: "short" },
  );
}
