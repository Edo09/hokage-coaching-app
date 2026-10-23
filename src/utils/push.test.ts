/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isProgramPushData, PROGRAM_PUSH_KIND, pushPlatform } from "@/src/utils/push";

describe("isProgramPushData", () => {
  it("true for the program push, as the database sends it", () => {
    assert.equal(
      isProgramPushData({ kind: "program-assigned", url: "/(tabs)/routines", program_id: "p1" }),
      true,
    );
    assert.equal(PROGRAM_PUSH_KIND, "program-assigned");
  });

  it("false for reminders, the rest alert and anything without data", () => {
    assert.equal(isProgramPushData({ kind: "reminder", url: "/(tabs)/routines" }), false);
    assert.equal(isProgramPushData({}), false);
    assert.equal(isProgramPushData(null), false);
    assert.equal(isProgramPushData(undefined), false);
  });
});

describe("pushPlatform", () => {
  it("ios and android register; web and the rest don't", () => {
    assert.equal(pushPlatform("ios"), "ios");
    assert.equal(pushPlatform("android"), "android");
    assert.equal(pushPlatform("web"), null);
    assert.equal(pushPlatform("windows"), null);
  });
});
