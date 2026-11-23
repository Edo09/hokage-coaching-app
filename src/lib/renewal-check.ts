import type { MyAccess } from "@/src/types/database";
import { needsRenewalSync } from "@/src/utils/subscription";

// A renewing subscription's period end is not an end (src/utils/subscription.ts:
// RENEWAL_GRACE_MS), but the app still has to learn the new period. Normally
// the store's notification reaches RevenueCat, its webhook the database, and
// Realtime (or the refetch when the app comes back) the app, all by itself.
// When the answer in hand still holds the old period some minutes after its
// end, nothing did: this asks sync-subscription, which has the server re-read
// the store (the repair for a lost webhook) and answers with the fresh access.
// Its dependencies are arguments, so `npm test` runs it.

/** The provider waits this long before looking, so a renewal that Realtime or
    the refetch on returning to the app delivers a moment later is never chased. */
export const RENEWAL_CHECK_DELAY_MS = 3_000;

/** Between two syncs for a renewal: one the store has not delivered is not
    chased more often than this (sync-subscription has a cooldown of its own). */
export const RENEWAL_CHECK_MIN_GAP_MS = 5 * 60_000;

export type RenewalCheckDeps = {
  /** Asks sync-subscription and stores its answer in the access query; true when the function answered. */
  sync(): Promise<boolean>;
  now(): Date;
};

export type RenewalCheckResult =
  /** Nothing was missing, a sync was already running, or the last one was too recent. */
  | "skipped"
  /** The function did not answer (offline, a failure, a timeout): the next look tries again at once. */
  | "unanswered"
  /** Asked, and the server answered. */
  | "synced";

/**
 * Looks for a renewal the app has not heard of, for the given answer in hand.
 * One sync at a time, and never more than one per RENEWAL_CHECK_MIN_GAP_MS
 * (counted from the last one the server answered). Never rejects.
 */
export function createRenewalChecker(
  deps: RenewalCheckDeps,
): (access: MyAccess | null) => Promise<RenewalCheckResult> {
  let busy = false;
  let lastAnsweredAt: number | null = null;

  return async (access) => {
    if (busy || !needsRenewalSync(access, deps.now())) return "skipped";
    if (lastAnsweredAt != null && deps.now().getTime() - lastAnsweredAt < RENEWAL_CHECK_MIN_GAP_MS) {
      return "skipped";
    }
    busy = true;
    try {
      let answered: boolean;
      try {
        answered = await deps.sync();
      } catch {
        answered = false;
      }
      if (!answered) return "unanswered";
      lastAnsweredAt = deps.now().getTime();
      return "synced";
    } finally {
      busy = false;
    }
  };
}
