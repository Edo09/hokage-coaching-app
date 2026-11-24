/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createSingleFlight } from "@/src/lib/single-flight";

/** A task that goes on until `finish()` is called. */
function gate() {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { done, finish };
}

describe("createSingleFlight", () => {
  it("ignores a call made in the same tick as a running one", async () => {
    const once = createSingleFlight();
    const first = gate();
    let runs = 0;
    const task = async () => {
      runs += 1;
      await first.done;
    };
    // Two taps before React has rendered anything in between.
    const a = once(task);
    const b = once(task);
    first.finish();
    assert.deepEqual(await Promise.all([a, b]), [true, false]);
    assert.equal(runs, 1);
  });

  it("runs the next call once the running one has finished", async () => {
    const once = createSingleFlight();
    let runs = 0;
    const task = async () => {
      runs += 1;
    };
    assert.equal(await once(task), true);
    assert.equal(await once(task), true);
    assert.equal(runs, 2);
  });

  it("is free again after a task that throws, and passes the error on", async () => {
    const once = createSingleFlight();
    await assert.rejects(
      once(async () => {
        throw new Error("boom");
      }),
      /boom/,
    );
    let ran = false;
    assert.equal(
      await once(async () => {
        ran = true;
      }),
      true,
    );
    assert.equal(ran, true);
  });
});
