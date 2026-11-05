// Local-date keys ("YYYY-MM-DD"). Meals and check-offs belong to the device's
// local calendar day — toISOString() is UTC and shifts evening entries to
// "tomorrow" for anyone west of UTC.

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

/** "6 oct" / "Oct 6": day and short month, no weekday or year. */
export function formatShortDate(key: string, lang: string): string {
  return dateKeyToDate(key).toLocaleDateString(
    lang === "es" ? "es-ES" : "en-US",
    { day: "numeric", month: "short" },
  );
}
