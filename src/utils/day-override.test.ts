/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { overrideFor, parseStoredOverride } from "@/src/utils/day-override";

describe("day-type override", () => {
  it("applies only on its own date", () => {
    assert.equal(overrideFor({ dateKey: "2026-11-05", day: "rest" }, "2026-11-05"), "rest");
    assert.equal(overrideFor({ dateKey: "2026-11-04", day: "rest" }, "2026-11-05"), null);
    assert.equal(overrideFor(null, "2026-11-05"), null);
  });
  it("parses defensively", () => {
    assert.equal(parseStoredOverride(null), null);
    assert.equal(parseStoredOverride("garbage"), null);
    assert.equal(parseStoredOverride(JSON.stringify({ dateKey: "2026-11-05", day: "both" })), null);
    assert.deepEqual(parseStoredOverride(JSON.stringify({ dateKey: "2026-11-05", day: "training" })), {
      dateKey: "2026-11-05",
      day: "training",
    });
  });
});
