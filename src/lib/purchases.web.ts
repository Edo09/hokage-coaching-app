import type { PurchasesGateway } from "@/src/lib/purchases-gateway";
import { PurchaseFailed } from "@/src/utils/purchase";

// Web has no purchases (docs/superpowers/specs/2026-11-16-premium-subscriptions-
// design.md, «Web»): subscribing happens in the iOS or Android app, and access
// that exists works here as anywhere. Metro picks this file instead of
// src/lib/purchases.ts, so the SDK is never bundled. Typed with the same
// interface, so `tsc` keeps the two in step.
export const purchases: PurchasesGateway = {
  available: false,
  configure() {},
  async identify() {},
  async reset() {},
  async loadPlans() {
    return [];
  },
  async purchase() {
    throw new PurchaseFailed({ kind: "store_problem", detail: null });
  },
  async restore() {
    return { found: false };
  },
  async manage() {
    return "unavailable";
  },
  onCustomerInfoChange() {
    return () => {};
  },
};
