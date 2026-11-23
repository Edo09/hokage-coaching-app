/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

import {
  APPLE_STANDARD_EULA_URL,
  ENTITLEMENT_ID,
  PLAN_KINDS,
  PLAN_PACKAGE_TYPES,
  resolveSdkKey,
  termsUrl,
} from "@/src/config/purchases";

const nodeRequire = createRequire(import.meta.url);

describe("resolveSdkKey", () => {
  const keys = { ios: "appl_ios", android: "goog_android" };

  it("picks the key of the platform", () => {
    assert.equal(resolveSdkKey("ios", keys, false), "appl_ios");
    assert.equal(resolveSdkKey("android", keys, false), "goog_android");
  });

  it("has no key on web or any other platform", () => {
    assert.equal(resolveSdkKey("web", keys, false), null);
    assert.equal(resolveSdkKey("windows", keys, true), null);
  });

  it("has no key when the platform's variable is missing, empty or blank", () => {
    assert.equal(resolveSdkKey("ios", {}, false), null);
    assert.equal(resolveSdkKey("ios", { android: "goog_android" }, false), null);
    assert.equal(resolveSdkKey("ios", { ios: "" }, false), null);
    assert.equal(resolveSdkKey("android", { android: "   " }, false), null);
  });

  it("trims whitespace around a key", () => {
    assert.equal(resolveSdkKey("ios", { ios: "  appl_ios \n" }, false), "appl_ios");
  });

  it("refuses a Test Store key outside a dev client (release builds crash with it)", () => {
    assert.equal(resolveSdkKey("ios", { ios: "test_abc" }, false), null);
    assert.equal(resolveSdkKey("android", { android: "test_abc" }, false), null);
  });

  it("lets a Test Store key through in a dev client", () => {
    assert.equal(resolveSdkKey("ios", { ios: "test_abc" }, true), "test_abc");
    assert.equal(resolveSdkKey("android", { android: "test_abc" }, true), "test_abc");
  });

  it("lets a store key through in a release build", () => {
    assert.equal(resolveSdkKey("ios", { ios: "appl_x" }, false), "appl_x");
  });
});

describe("termsUrl", () => {
  it("uses the configured page on every platform, trimmed", () => {
    for (const os of ["ios", "android", "web"]) {
      assert.equal(termsUrl(os, " https://coach.example/terminos "), "https://coach.example/terminos");
    }
  });

  it("falls back to Apple's standard EULA on iOS", () => {
    assert.equal(termsUrl("ios", undefined), APPLE_STANDARD_EULA_URL);
    assert.equal(termsUrl("ios", "   "), APPLE_STANDARD_EULA_URL);
    assert.equal(
      APPLE_STANDARD_EULA_URL,
      "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/",
    );
  });

  it("has no link on Android or web when none is configured", () => {
    assert.equal(termsUrl("android", undefined), null);
    assert.equal(termsUrl("android", ""), null);
    assert.equal(termsUrl("web", undefined), null);
    assert.equal(termsUrl("web", "  "), null);
  });
});

describe("plans", () => {
  it("lists the kinds in display order", () => {
    assert.deepEqual([...PLAN_KINDS], ["monthly", "quarterly", "annual"]);
  });

  it("names the entitlement the server grants", () => {
    assert.equal(ENTITLEMENT_ID, "premium_access");
  });

  it("matches the SDK's package types behind $rc_monthly, $rc_three_month and $rc_annual", () => {
    // The real enum, so an SDK upgrade that renames a package type fails here.
    const { PACKAGE_TYPE } = nodeRequire("@revenuecat/purchases-typescript-internal") as {
      PACKAGE_TYPE: Record<string, string>;
    };
    assert.equal(PLAN_PACKAGE_TYPES.monthly, PACKAGE_TYPE.MONTHLY);
    assert.equal(PLAN_PACKAGE_TYPES.quarterly, PACKAGE_TYPE.THREE_MONTH);
    assert.equal(PLAN_PACKAGE_TYPES.annual, PACKAGE_TYPE.ANNUAL);
  });
});
