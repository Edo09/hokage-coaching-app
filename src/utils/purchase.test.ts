/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

import {
  classifyPurchaseError,
  pickPlans,
  PurchaseFailed,
  type ErrorCodes,
  type StorePackage,
} from "@/src/utils/purchase";

// The SDK's real enum, so an upgrade that renames or renumbers a code fails
// these tests instead of silently turning a cancelled purchase into an error.
const nodeRequire = createRequire(import.meta.url);
const CODES = (
  nodeRequire("@revenuecat/purchases-typescript-internal") as {
    PURCHASES_ERROR_CODE: Record<string, string>;
  }
).PURCHASES_ERROR_CODE;
const classify = (error: unknown) => classifyPurchaseError(error, CODES as unknown as ErrorCodes);

/** An error as the SDK throws it. */
function sdkError(name: string, extra: Record<string, unknown> = {}) {
  assert.ok(CODES[name] != null, `the SDK has no ${name}`);
  return {
    code: CODES[name],
    message: "message",
    readableErrorCode: name,
    userInfo: { readableErrorCode: name },
    underlyingErrorMessage: "",
    userCancelled: null,
    ...extra,
  };
}

function pkg(
  packageType: string,
  price: number,
  perMonth: number | null,
  product: Partial<StorePackage["product"]> = {},
): StorePackage {
  return {
    identifier: `$rc_${packageType.toLowerCase()}`,
    packageType,
    product: {
      priceString: `$${price.toFixed(2)}`,
      price,
      currencyCode: "USD",
      pricePerMonth: perMonth,
      pricePerMonthString: perMonth == null ? null : `$${perMonth.toFixed(2)}`,
      ...product,
    },
  };
}

const MONTHLY = pkg("MONTHLY", 9.99, 9.99);
const QUARTERLY = pkg("THREE_MONTH", 24.99, 8.33);
const ANNUAL = pkg("ANNUAL", 79.99, 6.67);
// Packages a dashboard may hold that the paywall does not sell.
const NOISE = [
  pkg("WEEKLY", 2.99, 12.96),
  pkg("LIFETIME", 199.99, null),
  pkg("CUSTOM", 5, null),
  pkg("UNKNOWN", 1, null),
];

describe("pickPlans", () => {
  it("offers monthly, quarterly and annual in that order, whatever the dashboard's order", () => {
    const plans = pickPlans([ANNUAL, ...NOISE, MONTHLY, QUARTERLY]);
    assert.deepEqual(plans.map((p) => p.kind), ["monthly", "quarterly", "annual"]);
    assert.deepEqual(plans.map((p) => p.identifier), ["$rc_monthly", "$rc_three_month", "$rc_annual"]);
  });

  it("shows the store's own price strings, and the store's per-month string", () => {
    const plans = pickPlans([MONTHLY, QUARTERLY, ANNUAL]);
    assert.deepEqual(plans.map((p) => p.priceString), ["$9.99", "$24.99", "$79.99"]);
    assert.deepEqual(plans.map((p) => p.perMonthString), ["$9.99", "$8.33", "$6.67"]);
    assert.deepEqual(plans.map((p) => p.price), [9.99, 24.99, 79.99]);
    assert.deepEqual(plans.map((p) => p.currencyCode), ["USD", "USD", "USD"]);
  });

  it("computes the saving against the monthly plan", () => {
    const plans = pickPlans([MONTHLY, QUARTERLY, ANNUAL]);
    assert.deepEqual(plans.map((p) => p.savingPercent), [null, 17, 33]);
  });

  it("sells what the dashboard has: one plan, two plans, or none", () => {
    assert.deepEqual(pickPlans([MONTHLY]).map((p) => [p.kind, p.savingPercent]), [["monthly", null]]);
    assert.deepEqual(pickPlans([ANNUAL, QUARTERLY]).map((p) => [p.kind, p.savingPercent]), [
      ["quarterly", null],
      ["annual", null],
    ]);
    assert.deepEqual(pickPlans([]), []);
    assert.deepEqual(pickPlans(NOISE), []);
  });

  it("takes the first package when a type is configured twice", () => {
    const second = pkg("MONTHLY", 1.99, 1.99);
    assert.equal(pickPlans([MONTHLY, second]).length, 1);
    assert.equal(pickPlans([MONTHLY, second])[0].priceString, "$9.99");
  });

  it("claims no saving across currencies or without a usable monthly price", () => {
    const euroAnnual = pkg("ANNUAL", 79.99, 6.67, { currencyCode: "EUR" });
    assert.equal(pickPlans([MONTHLY, euroAnnual])[1].savingPercent, null);
    assert.equal(pickPlans([pkg("MONTHLY", 0, 0), ANNUAL])[1].savingPercent, null);
    assert.equal(pickPlans([pkg("MONTHLY", Number.NaN, null), ANNUAL])[1].savingPercent, null);
  });

  it("works the per-month price out when the store gives none", () => {
    const plans = pickPlans([MONTHLY, pkg("THREE_MONTH", 24.99, null), pkg("ANNUAL", 79.99, null)]);
    assert.deepEqual(plans.map((p) => p.savingPercent), [null, 17, 33]);
    assert.equal(plans[1].perMonthString, null);
  });

  it("claims no saving under 1 %, nor a negative one", () => {
    assert.equal(pickPlans([MONTHLY, pkg("THREE_MONTH", 29.85, 9.95)])[1].savingPercent, null);
    assert.equal(pickPlans([MONTHLY, pkg("THREE_MONTH", 36, 12)])[1].savingPercent, null);
  });
});

describe("classifyPurchaseError", () => {
  it("is silent about a cancelled purchase", () => {
    assert.deepEqual(classify(sdkError("PURCHASE_CANCELLED_ERROR")), { kind: "cancelled", detail: null });
    assert.deepEqual(classify(sdkError("UNKNOWN_ERROR", { userCancelled: true })), {
      kind: "cancelled",
      detail: null,
    });
  });

  it("knows a purchase waiting for approval (Ask to Buy, Google pending)", () => {
    assert.deepEqual(classify(sdkError("PAYMENT_PENDING_ERROR")), { kind: "pending", detail: null });
  });

  it("knows a lost connection", () => {
    assert.equal(classify(sdkError("NETWORK_ERROR")).kind, "offline");
    assert.equal(classify(sdkError("OFFLINE_CONNECTION_ERROR")).kind, "offline");
  });

  it("offers restore when the store says it is already bought or the receipt is in use", () => {
    assert.equal(classify(sdkError("PRODUCT_ALREADY_PURCHASED_ERROR")).kind, "already_purchased");
    assert.equal(classify(sdkError("RECEIPT_ALREADY_IN_USE_ERROR")).kind, "already_purchased");
    assert.equal(classify(sdkError("RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR")).kind, "already_purchased");
  });

  it("passes the store's message along for a store problem", () => {
    assert.deepEqual(
      classify(sdkError("STORE_PROBLEM_ERROR", { underlyingErrorMessage: "Billing unavailable" })),
      { kind: "store_problem", detail: "Billing unavailable" },
    );
    assert.deepEqual(classify(sdkError("PURCHASE_NOT_ALLOWED_ERROR", { message: "Not allowed" })), {
      kind: "store_problem",
      detail: "Not allowed",
    });
  });

  it("calls anything else a store problem too, with what it can say about it", () => {
    assert.deepEqual(classify(sdkError("UNKNOWN_ERROR")), { kind: "store_problem", detail: "message" });
    assert.deepEqual(classify(new Error("boom")), { kind: "store_problem", detail: "boom" });
    assert.deepEqual(classify("boom"), { kind: "store_problem", detail: null });
    assert.deepEqual(classify(null), { kind: "store_problem", detail: null });
    assert.deepEqual(classify(undefined), { kind: "store_problem", detail: null });
    assert.deepEqual(classify({ code: 42 }), { kind: "store_problem", detail: null });
  });
});

describe("PurchaseFailed", () => {
  it("carries the failure and is an Error", () => {
    const failure = { kind: "offline", detail: null } as const;
    const error = new PurchaseFailed(failure);
    assert.ok(error instanceof Error);
    assert.ok(error instanceof PurchaseFailed);
    assert.equal(error.failure, failure);
    assert.equal(error.name, "PurchaseFailed");
  });
});
