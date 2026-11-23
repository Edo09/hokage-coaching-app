// The wait after a purchase or a restore: the store answers before the server
// knows (docs/superpowers/specs/2026-11-16-premium-subscriptions-design.md,
// «Purchase states»). Ask sync-subscription at once, then keep watching the
// access query (the webhook's Realtime update lands there) and ask again
// every CONFIRM_SYNC_MS, the function's own cooldown being 10 s, until the
// subscription shows or CONFIRM_TIMEOUT_MS pass. Its dependencies are
// arguments, so `npm test` runs it on a fake clock.

/** How often the access query is looked at. */
export const CONFIRM_POLL_MS = 3_000;
/** How often sync-subscription is asked again. */
export const CONFIRM_SYNC_MS = 12_000;
/** After this long the screen says the purchase is being processed. */
export const CONFIRM_TIMEOUT_MS = 60_000;

export type ConfirmDeps = {
  /** Calls sync-subscription and stores its answer in the access query. May reject. */
  sync(): Promise<unknown>;
  /** The access query now shows a subscription that grants access. */
  confirmed(): boolean;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** The screen went away: stop. */
  cancelled(): boolean;
};

export async function confirmPurchase(
  deps: ConfirmDeps,
): Promise<"confirmed" | "timeout" | "cancelled"> {
  // A failed sync is not a failed purchase: the webhook may still get there.
  const trySync = async () => {
    try {
      await deps.sync();
    } catch {}
  };

  const start = deps.now();
  let lastSync = start;
  // The first sync runs even when the screen is already gone: the store has
  // been paid, so the server must hear of it (the paywall can be swiped away
  // between the store sheet closing and the purchase resolving). Only the
  // waiting after it depends on the screen.
  await trySync();
  if (deps.cancelled()) return "cancelled";
  if (deps.confirmed()) return "confirmed";

  for (;;) {
    await deps.sleep(CONFIRM_POLL_MS);
    if (deps.cancelled()) return "cancelled";
    if (deps.confirmed()) return "confirmed";
    const t = deps.now();
    if (t - start >= CONFIRM_TIMEOUT_MS) return "timeout";
    if (t - lastSync >= CONFIRM_SYNC_MS) {
      lastSync = t;
      await trySync();
      if (deps.cancelled()) return "cancelled";
      if (deps.confirmed()) return "confirmed";
    }
  }
}
