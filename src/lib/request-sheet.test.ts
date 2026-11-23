/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { DISMISS_FALLBACK_MS, getRequestSheet, requestSheet } from "@/src/lib/request-sheet";

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The store is a module singleton: start each test closed with nothing waiting. */
beforeEach(() => {
  requestSheet.open("program");
  requestSheet.close();
});

describe("requestSheet", () => {
  it("opens for a kind and closes", () => {
    assert.equal(getRequestSheet(), null);
    requestSheet.open("nutrition_plan");
    assert.equal(getRequestSheet(), "nutrition_plan");
    requestSheet.close();
    assert.equal(getRequestSheet(), null);
  });
});

// «Ver planes» from the sheet pushes the paywall, a native modal screen. On iOS
// that must wait until the sheet's own Modal has finished dismissing, or the
// screen is not presented: closeThen closes the sheet and runs the action when
// the sheet reports it is gone (`dismissed`).
describe("requestSheet.closeThen", () => {
  it("closes the sheet at once and runs the action only after the dismissal", () => {
    requestSheet.open("program");
    let ran = 0;
    requestSheet.closeThen(() => void (ran += 1));
    assert.equal(getRequestSheet(), null);
    assert.equal(ran, 0, "ran while the sheet was still sliding out");
    requestSheet.dismissed();
    assert.equal(ran, 1);
  });

  it("runs the action at once when the sheet is already closed", () => {
    let ran = 0;
    requestSheet.closeThen(() => void (ran += 1));
    assert.equal(ran, 1);
  });

  it("runs it only once, however often the dismissal is reported", () => {
    requestSheet.open("program");
    let ran = 0;
    requestSheet.closeThen(() => void (ran += 1));
    requestSheet.dismissed();
    requestSheet.dismissed();
    assert.equal(ran, 1);
  });

  it("a dismissal with nothing waiting does nothing", () => {
    requestSheet.dismissed();
    assert.equal(getRequestSheet(), null);
  });

  it("runs it anyway if the dismissal is never reported, so «Ver planes» cannot do nothing", async () => {
    assert.equal(DISMISS_FALLBACK_MS, 1_000);
    requestSheet.open("program");
    let ran = 0;
    requestSheet.closeThen(() => void (ran += 1), 20);
    assert.equal(ran, 0);
    await pause(60);
    assert.equal(ran, 1);
    requestSheet.dismissed();
    assert.equal(ran, 1, "ran again when the dismissal came late");
  });

  it("the dismissal arriving first cancels the fallback", async () => {
    requestSheet.open("program");
    let ran = 0;
    requestSheet.closeThen(() => void (ran += 1), 30);
    requestSheet.dismissed();
    await pause(80);
    assert.equal(ran, 1);
  });

  it("opening the sheet again before it has gone voids the action", async () => {
    requestSheet.open("program");
    let ran = 0;
    requestSheet.closeThen(() => void (ran += 1), 30);
    requestSheet.open("nutrition_plan");
    requestSheet.dismissed();
    await pause(80);
    assert.equal(ran, 0);
    assert.equal(getRequestSheet(), "nutrition_plan");
  });

  it("asked twice while the sheet is going, the last action wins and runs once", () => {
    requestSheet.open("program");
    const ran: string[] = [];
    requestSheet.closeThen(() => void ran.push("first"));
    requestSheet.closeThen(() => void ran.push("second"));
    assert.deepEqual(ran, []);
    requestSheet.dismissed();
    assert.deepEqual(ran, ["second"]);
  });
});
