import type { PlanKind } from "@/src/config/purchases";
import type { Plan } from "@/src/utils/purchase";

/**
 * Everything the app asks of the store, behind one interface with two
 * implementations (docs/superpowers/specs/2026-11-16-premium-subscriptions-
 * design.md, «The app»): src/lib/purchases.ts on iOS and Android, and the
 * inert src/lib/purchases.web.ts, which keeps the SDK out of the web bundle.
 * Both are typed with this interface, so `tsc` keeps them in step.
 *
 * Nothing here decides access: that is the server's answer (rpc
 * get_my_access). The SDK buys, restores, prices and opens the store's manage
 * page, and tells the app when its customer changed so the access query can
 * be read again.
 *
 * Every method that talks to the store rejects with `PurchaseFailed`
 * (src/utils/purchase.ts), already classified.
 */
export interface PurchasesGateway {
  /** Purchasing can work here: native, with a usable SDK key. When false the
      app shows no purchase control at all. */
  readonly available: boolean;
  /** Starts the SDK once, without a user. Safe to call again. */
  configure(): void;
  /** Makes the SDK's user the signed-in client (the Supabase user id). */
  identify(userId: string): Promise<void>;
  /** The client signed out: back to an anonymous SDK user. Never rejects. */
  reset(): Promise<void>;
  /** The three plans of the current offering, with the store's prices. */
  loadPlans(): Promise<Plan[]>;
  /** Buys a plan as this user. Resolves when the store says it is done,
      which is not yet access: the server confirms that. A cancel rejects with
      kind `cancelled`. */
  purchase(kind: PlanKind, userId: string): Promise<void>;
  /** Asks the store to restore. `found` says the SDK sees an active
      entitlement; it still takes the server to grant access. */
  restore(userId: string): Promise<{ found: boolean }>;
  /** Opens the store's manage-subscription page: Apple's sheet on iOS, the
      customer's management URL (else Google Play's page) on Android. */
  manage(): Promise<"opened" | "unavailable">;
  /** Calls `listener` whenever the SDK's customer changes. Returns the
      unsubscribe. */
  onCustomerInfoChange(listener: () => void): () => void;
}
