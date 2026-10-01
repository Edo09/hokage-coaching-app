/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runPull } from "@/src/hooks/use-pull-refresh";

describe("runPull", () => {
  it("shows the indicator only while the pull's own refresh runs", async () => {
    const states: boolean[] = [];
    let release!: () => void;
    const done = runPull(
      () => new Promise<void>((resolve) => (release = resolve)),
      (value) => states.push(value),
    );
    assert.deepEqual(states, [true]);
    release();
    await done;
    assert.deepEqual(states, [true, false]);
  });

  it("hides the indicator when the refresh fails, without throwing", async () => {
    const states: boolean[] = [];
    await runPull(
      () => Promise.reject(new Error("offline")),
      (value) => states.push(value),
    );
    assert.deepEqual(states, [true, false]);
  });

  it("hides the indicator right away for a refresh that returns nothing", async () => {
    const states: boolean[] = [];
    await runPull(
      () => undefined,
      (value) => states.push(value),
    );
    assert.deepEqual(states, [true, false]);
  });
});
