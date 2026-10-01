/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { BATCH_WINDOW_MS, checkCard, type CheckCardState } from "@/src/lib/check-card";

const single = (exerciseId: string, week = 2): CheckCardState => ({
  kind: "single",
  exerciseId,
  dayId: "day-1",
  week,
  seconds: null,
  undoOnly: false,
});

// The store is one module-wide card: every test starts with none up and no
// burst of checks going (dismiss() ends the burst too).
beforeEach(() => checkCard.dismiss());

describe("checkCard: show, replace, dismiss", () => {
  it("has no card up to begin with", () => {
    assert.equal(checkCard.get(), null);
  });

  it("shows a card and tells its listeners", () => {
    let calls = 0;
    const unsubscribe = checkCard.subscribe(() => calls++);
    const card = single("bench");
    checkCard.show(card);
    unsubscribe();
    assert.equal(checkCard.get(), card);
    assert.equal(calls, 1);
  });

  it("replaces the card that's up: cards never stack", () => {
    checkCard.show(single("bench"));
    const next = single("row");
    checkCard.show(next);
    assert.equal(checkCard.get(), next);
  });

  it("takes the card down", () => {
    checkCard.show(single("bench"));
    let calls = 0;
    const unsubscribe = checkCard.subscribe(() => calls++);
    checkCard.dismiss();
    unsubscribe();
    assert.equal(checkCard.get(), null);
    assert.equal(calls, 1);
  });

  it("doesn't notify for a dismiss with nothing up", () => {
    let calls = 0;
    const unsubscribe = checkCard.subscribe(() => calls++);
    checkCard.dismiss();
    unsubscribe();
    assert.equal(calls, 0);
  });

  it("stops notifying once unsubscribed", () => {
    let calls = 0;
    const unsubscribe = checkCard.subscribe(() => calls++);
    unsubscribe();
    checkCard.show(single("bench"));
    assert.equal(calls, 0);
  });
});

describe("checkCard.noteCheck: checks in quick succession", () => {
  it("is 8 seconds", () => {
    assert.equal(BATCH_WINDOW_MS, 8000);
  });

  it("calls a first check single and leaves the card to the caller", () => {
    assert.equal(checkCard.noteCheck("bench", 2, 1_000), "single");
    assert.equal(checkCard.get(), null);
  });

  it("collapses a second check within 8 s into a batch card with both", () => {
    checkCard.noteCheck("bench", 2, 1_000);
    checkCard.show(single("bench"));
    assert.equal(checkCard.noteCheck("row", 2, 4_000), "batch");
    assert.deepEqual(checkCard.get(), {
      kind: "batch",
      items: [
        { exerciseId: "bench", week: 2 },
        { exerciseId: "row", week: 2 },
      ],
    });
  });

  it("counts exactly 8 s as within the window", () => {
    checkCard.noteCheck("bench", 2, 1_000);
    assert.equal(checkCard.noteCheck("row", 2, 9_000), "batch");
  });

  it("measures the window from the check before, not the first", () => {
    checkCard.noteCheck("bench", 2, 0);
    checkCard.noteCheck("row", 2, 6_000);
    assert.equal(checkCard.noteCheck("curl", 2, 12_000), "batch");
    const card = checkCard.get();
    assert.equal(card?.kind, "batch");
    assert.deepEqual(
      card?.kind === "batch" ? card.items.map((i) => i.exerciseId) : null,
      ["bench", "row", "curl"],
    );
  });

  it("starts over after more than 8 s", () => {
    checkCard.noteCheck("bench", 2, 0);
    assert.equal(checkCard.noteCheck("row", 2, 8_001), "single");
    assert.equal(checkCard.noteCheck("curl", 2, 9_000), "batch");
    assert.deepEqual(checkCard.get(), {
      kind: "batch",
      items: [
        { exerciseId: "row", week: 2 },
        { exerciseId: "curl", week: 2 },
      ],
    });
  });

  it("lists an exercise checked twice in a burst once", () => {
    checkCard.noteCheck("bench", 2, 0);
    checkCard.noteCheck("row", 2, 1_000);
    checkCard.noteCheck("bench", 2, 2_000);
    const card = checkCard.get();
    assert.equal(card?.kind === "batch" ? card.items.length : null, 2);
  });

  it("keeps a re-check of the burst's only exercise single", () => {
    // Checked, unchecked without ending the burst (the card had closed by
    // itself), checked again: one check, not «1 hechos».
    checkCard.noteCheck("bench", 2, 0);
    assert.equal(checkCard.noteCheck("bench", 2, 3_000), "single");
    assert.equal(checkCard.get(), null);
    assert.equal(checkCard.noteCheck("row", 2, 6_000), "batch");
  });

  it("counts the same exercise in two weeks as two checks", () => {
    checkCard.noteCheck("bench", 1, 0);
    checkCard.noteCheck("bench", 2, 1_000);
    assert.deepEqual(checkCard.get(), {
      kind: "batch",
      items: [
        { exerciseId: "bench", week: 1 },
        { exerciseId: "bench", week: 2 },
      ],
    });
  });

  it("ends the burst on dismiss(): the next check is single again", () => {
    checkCard.noteCheck("bench", 2, 0);
    checkCard.noteCheck("row", 2, 1_000);
    checkCard.dismiss();
    assert.equal(checkCard.noteCheck("curl", 2, 2_000), "single");
  });

  it("keeps the burst going through dismiss({ keepRun: true })", () => {
    checkCard.noteCheck("bench", 2, 0);
    checkCard.show(single("bench"));
    checkCard.dismiss({ keepRun: true });
    assert.equal(checkCard.get(), null);
    assert.equal(checkCard.noteCheck("row", 2, 6_000), "batch");
    assert.deepEqual(checkCard.get(), {
      kind: "batch",
      items: [
        { exerciseId: "bench", week: 2 },
        { exerciseId: "row", week: 2 },
      ],
    });
  });
});

describe("checkCard: days celebrated this session", () => {
  it("knows no day before one is marked", () => {
    assert.equal(checkCard.wasCelebrated("day-a", 1), false);
  });

  it("remembers a marked day for that week only", () => {
    checkCard.markCelebrated("day-b", 3);
    assert.equal(checkCard.wasCelebrated("day-b", 3), true);
    assert.equal(checkCard.wasCelebrated("day-b", 4), false);
    assert.equal(checkCard.wasCelebrated("day-c", 3), false);
  });

  it("keeps it through the card coming and going", () => {
    checkCard.markCelebrated("day-d", 1);
    checkCard.show(single("bench"));
    checkCard.dismiss();
    assert.equal(checkCard.wasCelebrated("day-d", 1), true);
  });
});
