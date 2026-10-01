/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { barStackOffset, bottomBars } from "@/src/lib/bottom-bars";

describe("barStackOffset", () => {
  it("is the tab bar alone when no bar shows", () => {
    assert.equal(
      barStackOffset(74, { restShown: false, sessionShown: false }, { rest: 120, session: 90 }),
      74,
    );
  });

  it("stacks on the bars' measured heights (a large system font makes them taller)", () => {
    assert.equal(
      barStackOffset(74, { restShown: true, sessionShown: true }, { rest: 112, session: 84 }),
      74 + 112 + 84,
    );
  });

  it("falls back to the 1x footprints until a bar has been measured", () => {
    assert.equal(
      barStackOffset(74, { restShown: true, sessionShown: true }, { rest: null, session: null }),
      74 + 81 + 66,
    );
    assert.equal(
      barStackOffset(74, { restShown: false, sessionShown: true }, { rest: 112, session: null }),
      74 + 66,
    );
  });

  it("ignores a measured bar that isn't showing", () => {
    assert.equal(
      barStackOffset(74, { restShown: false, sessionShown: true }, { rest: 112, session: 84 }),
      74 + 84,
    );
  });
});

describe("bottomBars", () => {
  it("keeps each bar's last height, and forgets it when the bar unmounts", () => {
    const seen: number[] = [];
    const off = bottomBars.subscribe(() => seen.push(1));
    bottomBars.set("rest", 97);
    bottomBars.set("session", 70);
    assert.deepEqual(bottomBars.get(), { rest: 97, session: 70 });
    bottomBars.set("rest", null);
    assert.deepEqual(bottomBars.get(), { rest: null, session: 70 });
    assert.equal(seen.length, 3);
    off();
    bottomBars.set("session", null);
  });

  it("doesn't notify for a height that didn't change", () => {
    let calls = 0;
    const off = bottomBars.subscribe(() => calls++);
    bottomBars.set("rest", 90);
    bottomBars.set("rest", 90);
    assert.equal(calls, 1);
    off();
    bottomBars.set("rest", null);
  });
});
