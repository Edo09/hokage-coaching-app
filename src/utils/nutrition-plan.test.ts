/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatRange } from "@/src/utils/nutrition-plan";

describe("formatRange", () => {
  it("joins two bounds and collapses equal ones", () => {
    assert.equal(formatRange(150, 155), "150–155");
    assert.equal(formatRange(150, 150), "150");
  });

  it("keeps a one-sided target and has nothing for none", () => {
    assert.equal(formatRange(150, null), "150");
    assert.equal(formatRange(null, 155), "155");
    assert.equal(formatRange(null, null), null);
  });

  it("formats each bound with the given formatter", () => {
    const en = (n: number) => n.toLocaleString("en-US");
    assert.equal(formatRange(1800, 1850, en), "1,800–1,850");
    assert.equal(formatRange(1800, 1800, en), "1,800");
    assert.equal(formatRange(null, 2100, en), "2,100");
  });
});
