/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createSdkStarter } from "@/src/lib/sdk-starter";

function fake(opts: { key?: string | null; throws?: boolean }) {
  const started: (string | null)[] = [];
  const errors: unknown[] = [];
  const starter = createSdkStarter({
    key: opts.key === undefined ? "appl_key" : opts.key,
    start(key) {
      started.push(key);
      if (opts.throws) throw new Error("native module missing");
    },
    onError: (error) => errors.push(error),
  });
  return { starter, started, errors };
}

describe("createSdkStarter", () => {
  it("starts the SDK once with the key, however often it is asked", () => {
    const { starter, started } = fake({});
    assert.equal(starter.ensure(), true);
    assert.equal(starter.ensure(), true);
    assert.deepEqual(started, ["appl_key"]);
    assert.equal(starter.available, true);
  });

  it("never starts without a key", () => {
    const { starter, started } = fake({ key: null });
    assert.equal(starter.ensure(), false);
    assert.deepEqual(started, []);
    assert.equal(starter.available, false);
  });

  it("a start that throws turns purchasing off instead of throwing", () => {
    const { starter, errors } = fake({ throws: true });
    assert.equal(starter.ensure(), false);
    assert.equal(starter.available, false);
    assert.equal(errors.length, 1);
    assert.match((errors[0] as Error).message, /native module missing/);
  });

  it("does not try a failed start again", () => {
    const { starter, started, errors } = fake({ throws: true });
    starter.ensure();
    assert.equal(starter.ensure(), false);
    assert.equal(starter.ensure(), false);
    assert.equal(started.length, 1);
    assert.equal(errors.length, 1);
  });
});
