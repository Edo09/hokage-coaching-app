import type { ResolvedDay } from "@/src/utils/nutrition-plan";

// The pure half of the day-type override store (src/lib/day-override.ts):
// reading back what AsyncStorage holds, and whether it still applies. No React,
// no storage, so `npm test` can run it.

/** The client's pick, stamped with the day it was made for. */
export type StoredOverride = { dateKey: string; day: ResolvedDay };

/** The stored JSON → an override, or null for nothing stored, unreadable JSON
    or a value an older or newer app wrote that isn't a real day. */
export function parseStoredOverride(raw: string | null): StoredOverride | null {
  if (raw == null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (v == null || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    if (typeof o.dateKey !== "string" || (o.day !== "training" && o.day !== "rest")) return null;
    return { dateKey: o.dateKey, day: o.day };
  } catch {
    return null;
  }
}

/** The override only lasts the day it was set: it resets at midnight. */
export function overrideFor(stored: StoredOverride | null, todayKey: string): ResolvedDay | null {
  return stored != null && stored.dateKey === todayKey ? stored.day : null;
}
