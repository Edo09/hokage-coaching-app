// Meal registrations: what the client says they ate for each of today's plan
// meals. Pure, so `npm test` covers it (see meal-registration.test.ts).

import { uuidV5 } from "@/src/lib/ids";
import type { MealType } from "@/src/types/database";

// Fixed forever: changing it would give every registration a new id.
export const REGISTRATION_NAMESPACE = "3f6d1c9e-8a2b-4e57-b0c4-9d2e7f1a6b38";

/** One registration per client, date and plan meal: every device and every
 *  repeated save derives the same id, so the last write updates one row. */
export function registrationId(userId: string, dateKey: string, planMealId: string): string {
  return uuidV5(`registration:${userId}:${dateKey}:${planMealId}`, REGISTRATION_NAMESPACE);
}

/** The day's container for a diary type, the same on every device. */
export function containerId(userId: string, dateKey: string, mealType: MealType): string {
  return uuidV5(`container:${userId}:${dateKey}:${mealType}`, REGISTRATION_NAMESPACE);
}
