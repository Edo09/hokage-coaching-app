// Keeps RevenueCat's user the same person as the signed-in Supabase user
// (docs/superpowers/specs/2026-11-16-premium-subscriptions-design.md: the app
// user id is the Supabase Auth UUID). A purchase made while the SDK is still
// anonymous, or still on the previous account, lands on an id the webhook
// cannot map, so every identity call joins one queue and a purchase asks
// `ensure` first. No React Native import: the SDK is passed in, so `npm test`
// drives it with a fake.

/** The part of the SDK's Purchases class this helper uses. */
export type IdentitySdk = {
  logIn(id: string): Promise<unknown>;
  logOut(): Promise<unknown>;
  getAppUserID(): Promise<string>;
  isAnonymous(): Promise<boolean>;
};

export type Identity = {
  /** Logs the user in, unless they already are (what the last login said). */
  identify(userId: string): Promise<void>;
  /** Resolves only when the SDK is on this user: waits for calls in flight,
      asks the SDK who it is, and logs in again if that differs. Rejects when
      it cannot, so a purchase must not go ahead. */
  ensure(userId: string): Promise<void>;
  /** Logs out (the SDK rejects that for an anonymous user, so it is skipped).
      Never rejects. */
  reset(): Promise<void>;
};

export function createIdentity(sdk: IdentitySdk): Identity {
  // One queue: a logOut can never overtake a logIn still in flight.
  let queue: Promise<unknown> = Promise.resolve();
  /** Who the last successful logIn was for; null after a reset. */
  let identified: string | null = null;

  function enqueue(task: () => Promise<void>): Promise<void> {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  }

  async function logIn(userId: string): Promise<void> {
    await sdk.logIn(userId);
    identified = userId;
  }

  return {
    identify: (userId) =>
      enqueue(async () => {
        if (identified !== userId) await logIn(userId);
      }),

    ensure: (userId) =>
      enqueue(async () => {
        if (identified === userId && (await sdk.getAppUserID()) === userId) return;
        await logIn(userId);
      }),

    reset: () =>
      enqueue(async () => {
        identified = null;
        try {
          if (!(await sdk.isAnonymous())) await sdk.logOut();
        } catch {}
      }),
  };
}
