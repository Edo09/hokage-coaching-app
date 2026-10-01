/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { programFocus } from "@/src/lib/program-focus";

describe("programFocus", () => {
  // One store for the whole module: start every test with nothing pending.
  beforeEach(() => {
    programFocus.take();
  });

  it("has nothing to take before a request", () => {
    assert.equal(programFocus.take(), null);
  });

  it("hands a request over once", () => {
    programFocus.request({ week: 2, dayId: "day-3" });
    assert.deepEqual(programFocus.take(), { week: 2, dayId: "day-3" });
    assert.equal(programFocus.take(), null);
  });

  it("keeps only the latest request that nobody took", () => {
    programFocus.request({ week: 2, dayId: "day-3" });
    programFocus.request({ week: 3, dayId: "day-1" });
    assert.deepEqual(programFocus.take(), { week: 3, dayId: "day-1" });
    assert.equal(programFocus.take(), null);
  });

  it("tells subscribers about a request and about it being taken", () => {
    let calls = 0;
    const unsubscribe = programFocus.subscribe(() => {
      calls += 1;
    });
    programFocus.request({ week: 1, dayId: "day-2" });
    assert.equal(calls, 1);
    programFocus.take();
    assert.equal(calls, 2);
    // Nothing pending: nothing changed, nobody is told.
    programFocus.take();
    assert.equal(calls, 2);
    unsubscribe();
    programFocus.request({ week: 1, dayId: "day-2" });
    assert.equal(calls, 2);
  });
});
