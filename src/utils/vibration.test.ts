/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
// How long the phone buzzes at each moment of a workout (Android honours the
// lengths; iOS has its own).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buzzesOf, MIN_BUZZ_MS, VIBRATIONS } from "@/src/utils/vibration";

describe("VIBRATIONS", () => {
  it("never buzzes shorter than what is felt through a pocket or on a bench", () => {
    for (const [moment, pattern] of Object.entries(VIBRATIONS)) {
      for (const ms of buzzesOf(pattern)) {
        assert.ok(ms >= MIN_BUZZ_MS, `${moment}: a ${ms} ms buzz is too short`);
      }
    }
    assert.ok(MIN_BUZZ_MS >= 150);
  });

  it("makes the end of a rest the longest: the phone is often face-down on a bench", () => {
    const total = (p: readonly number[]) => buzzesOf(p).reduce((a, b) => a + b, 0);
    assert.ok(total(VIBRATIONS.done) >= 1200, `done buzzes ${total(VIBRATIONS.done)} ms`);
    for (const [moment, pattern] of Object.entries(VIBRATIONS)) {
      if (moment !== "done") assert.ok(total(pattern) < total(VIBRATIONS.done), `${moment} outlasts done`);
    }
  });

  it("starts a rest with one buzz, and gives the heads-up two", () => {
    assert.equal(buzzesOf(VIBRATIONS.start).length, 1);
    assert.equal(buzzesOf(VIBRATIONS.warn).length, 2);
  });
});

describe("buzzesOf", () => {
  it("reads the buzzes of an Android pattern ([wait, buzz, wait, buzz…])", () => {
    assert.deepEqual(buzzesOf([0, 400, 180, 300]), [400, 300]);
  });
});
