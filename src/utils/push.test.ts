/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isCoachPushData,
  NUTRITION_PUSH_KIND,
  PROGRAM_PUSH_KIND,
  pushPlatform,
  SUPPLEMENT_PUSH_KIND,
} from "@/src/utils/push";

describe("isCoachPushData", () => {
  it("true for each of the coach's pushes, as the database sends them", () => {
    assert.equal(
      isCoachPushData({ kind: "program-assigned", url: "/(tabs)/routines", program_id: "p1" }),
      true,
    );
    assert.equal(
      isCoachPushData({ kind: "nutrition-plan-assigned", url: "/(tabs)/nutrition", plan_id: "n1" }),
      true,
    );
    assert.equal(
      isCoachPushData({ kind: "supplement-plan-assigned", url: "/(tabs)/nutrition", plan_id: "s1" }),
      true,
    );
    assert.equal(PROGRAM_PUSH_KIND, "program-assigned");
    assert.equal(NUTRITION_PUSH_KIND, "nutrition-plan-assigned");
    assert.equal(SUPPLEMENT_PUSH_KIND, "supplement-plan-assigned");
  });

  it("false for reminders, the rest alert and anything without data", () => {
    assert.equal(isCoachPushData({ kind: "reminder", url: "/(tabs)/routines" }), false);
    assert.equal(isCoachPushData({}), false);
    assert.equal(isCoachPushData(null), false);
    assert.equal(isCoachPushData(undefined), false);
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
