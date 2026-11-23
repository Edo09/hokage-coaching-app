import type { PURCHASES_ERROR_CODE } from "react-native-purchases";

import { PLAN_KINDS, PLAN_PACKAGE_TYPES, type PlanKind } from "@/src/config/purchases";

// What the store tells the paywall, in plain data: the offering turned into
// the three plans the screen sells, and an SDK error turned into one of the
// outcomes the spec names (docs/superpowers/specs/2026-11-16-premium-
// subscriptions-design.md, «Purchase states»). No React, no Expo, and no SDK
// at runtime (the type import below is erased), so `npm test` pins them; the
// gateway (src/lib/purchases.ts) is the only place that talks to the SDK.

/** The part of the SDK's PurchasesPackage this module reads. */
export type StorePackage = {
  identifier: string;
  /** The SDK's PACKAGE_TYPE value: "MONTHLY", "THREE_MONTH", "ANNUAL", … */
  packageType: string;
  product: {
    /** The store's formatted price: the number the paywall shows biggest. */
    priceString: string;
    price: number;
    currencyCode: string;
    pricePerMonth: number | null;
    pricePerMonthString: string | null;
  };
};

/** A plan as the paywall sells it. */
export type Plan = {
  kind: PlanKind;
  /** The package identifier ($rc_monthly, $rc_three_month, $rc_annual). */
  identifier: string;
  priceString: string;
  price: number;
  currencyCode: string;
  /** The store's own per-month string, null when it gives none. */
  perMonthString: string | null;
  /** How much cheaper a month is than on the monthly plan, in whole percent. */
  savingPercent: number | null;
};

const MONTHS: Record<PlanKind, number> = { monthly: 1, quarterly: 3, annual: 12 };

function costPerMonth(product: StorePackage["product"], kind: PlanKind): number | null {
  if (product.pricePerMonth != null && Number.isFinite(product.pricePerMonth)) {
    return product.pricePerMonth;
  }
  return Number.isFinite(product.price) ? product.price / MONTHS[kind] : null;
}

/** No claim without a monthly price in the same currency to compare with, and
    none under 1 % (or negative). */
function savingOf(kind: PlanKind, plan: StorePackage, monthly: StorePackage | null): number | null {
  if (kind === "monthly" || monthly == null) return null;
  const base = monthly.product;
  if (!Number.isFinite(base.price) || base.price <= 0) return null;
  if (base.currencyCode !== plan.product.currencyCode) return null;
  const cost = costPerMonth(plan.product, kind);
  if (cost == null) return null;
  const percent = Math.round(100 * (1 - cost / base.price));
  return percent >= 1 ? percent : null;
}

/**
 * The plans to sell from an offering's packages: monthly, quarterly and
 * annual, found by package type (never by product id), in that order. What the
 * dashboard does not hold is skipped, and the first package wins when a type
 * is configured twice.
 */
export function pickPlans(packages: readonly StorePackage[]): Plan[] {
  const byKind = new Map<PlanKind, StorePackage>();
  for (const candidate of packages) {
    const kind = PLAN_KINDS.find((k) => PLAN_PACKAGE_TYPES[k] === candidate.packageType);
    if (kind != null && !byKind.has(kind)) byKind.set(kind, candidate);
  }
  const monthly = byKind.get("monthly") ?? null;
  return PLAN_KINDS.flatMap((kind): Plan[] => {
    const found = byKind.get(kind);
    if (found == null) return [];
    return [
      {
        kind,
        identifier: found.identifier,
        priceString: found.product.priceString,
        price: found.product.price,
        currencyCode: found.product.currencyCode,
        perMonthString: found.product.pricePerMonthString,
        savingPercent: savingOf(kind, found, monthly),
      },
    ];
  });
}

/** What went wrong with a purchase or a restore, as far as the screen cares. */
export type FailureKind =
  | "cancelled"
  | "pending"
  | "offline"
  | "already_purchased"
  | "store_problem";

export type PurchaseFailure = {
  kind: FailureKind;
  /** The store's own message, when it gave one worth showing. */
  detail: string | null;
};

/** The SDK's error codes this module looks at, typed from the SDK so a rename
    breaks the build; the real values are checked in purchase.test.ts. */
export type ErrorCodes = Pick<
  typeof PURCHASES_ERROR_CODE,
  | "PURCHASE_CANCELLED_ERROR"
  | "PAYMENT_PENDING_ERROR"
  | "NETWORK_ERROR"
  | "OFFLINE_CONNECTION_ERROR"
  | "PRODUCT_ALREADY_PURCHASED_ERROR"
  | "RECEIPT_ALREADY_IN_USE_ERROR"
  | "RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR"
>;

const message = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

/**
 * An SDK error as one of: cancelled (stay silent), pending approval, offline,
 * already purchased or receipt in use (offer restore), or a store problem
 * (show the store's message, offer retry). Anything it does not know is a
 * store problem. The caller hands in the SDK's PURCHASES_ERROR_CODE.
 */
export function classifyPurchaseError(error: unknown, codes: ErrorCodes): PurchaseFailure {
  const e = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : null;
  const code = typeof e?.code === "string" ? e.code : null;

  if (e?.userCancelled === true || code === codes.PURCHASE_CANCELLED_ERROR) {
    return { kind: "cancelled", detail: null };
  }
  if (code === codes.PAYMENT_PENDING_ERROR) return { kind: "pending", detail: null };
  if (code === codes.NETWORK_ERROR || code === codes.OFFLINE_CONNECTION_ERROR) {
    return { kind: "offline", detail: null };
  }
  if (
    code === codes.PRODUCT_ALREADY_PURCHASED_ERROR ||
    code === codes.RECEIPT_ALREADY_IN_USE_ERROR ||
    code === codes.RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR
  ) {
    return { kind: "already_purchased", detail: null };
  }
  return {
    kind: "store_problem",
    detail: message(e?.underlyingErrorMessage) ?? message(e?.message),
  };
}

/** Thrown by the gateway for every store call that fails. */
export class PurchaseFailed extends Error {
  readonly failure: PurchaseFailure;

  constructor(failure: PurchaseFailure) {
    super(failure.detail ?? failure.kind);
    this.name = "PurchaseFailed";
    this.failure = failure;
  }
}
