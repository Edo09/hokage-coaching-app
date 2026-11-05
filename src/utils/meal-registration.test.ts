/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { containerId, registrationId } from "@/src/utils/meal-registration";

describe("registration ids", () => {
  it("derives stable, distinct ids", () => {
    const a = registrationId("u1", "2026-11-05", "m1");
    assert.equal(a, registrationId("u1", "2026-11-05", "m1"));
    assert.notEqual(a, registrationId("u1", "2026-11-06", "m1"));
    assert.notEqual(containerId("u1", "2026-11-05", "snack"), registrationId("u1", "2026-11-05", "snack"));
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
