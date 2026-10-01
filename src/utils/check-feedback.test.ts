/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CheckCardState } from "@/src/lib/check-card";
import { cardIncludes, checkFeedback } from "@/src/utils/check-feedback";

// A plain check: not the day's last, not in a quick run, the current week,
// no other exercise in progress.
const PLAIN = {
  finishesDay: false,
  celebrated: false,
  batch: false,
  pastWeek: false,
  otherInProgress: false,
};

const item = (exerciseId: string, week = 2) => ({ exerciseId, week });

const single = (exerciseId: string, week = 2): CheckCardState => ({
  kind: "single",
  exerciseId,
  dayId: "day-1",
  week,
  seconds: null,
  undoOnly: false,
});

describe("checkFeedback", () => {
  it("shows the full card for a check that doesn't finish the day", () => {
    assert.deepEqual(checkFeedback(PLAIN), { kind: "card", collapse: false, undoOnly: false });
  });

  it("leaves the day's last check to the day modal", () => {
    assert.deepEqual(checkFeedback({ ...PLAIN, finishesDay: true }), { kind: "dayModal" });
  });

  it("doesn't replay a day already celebrated: a «Día n completo» card instead", () => {
    assert.deepEqual(checkFeedback({ ...PLAIN, finishesDay: true, celebrated: true }), {
      kind: "dayAgain",
    });
  });

  it("lets finishing the day win over a quick run, a past week and another clock", () => {
    const all = { ...PLAIN, finishesDay: true, batch: true, pastWeek: true, otherInProgress: true };
    assert.deepEqual(checkFeedback(all), { kind: "dayModal" });
    assert.deepEqual(checkFeedback({ ...all, celebrated: true }), { kind: "dayAgain" });
  });

  it("ignores an earlier celebration when the check doesn't finish the day", () => {
    assert.deepEqual(checkFeedback({ ...PLAIN, celebrated: true }), {
      kind: "card",
      collapse: false,
      undoOnly: false,
    });
  });

  it("keeps the collapsed card for a check in a quick run", () => {
    assert.deepEqual(checkFeedback({ ...PLAIN, batch: true }), {
      kind: "card",
      collapse: true,
      undoOnly: false,
    });
  });

  it("offers only «Deshacer» on a past week", () => {
    assert.deepEqual(checkFeedback({ ...PLAIN, pastWeek: true }), {
      kind: "card",
      collapse: false,
      undoOnly: true,
    });
  });

  it("offers only «Deshacer» while another exercise is in progress", () => {
    assert.deepEqual(checkFeedback({ ...PLAIN, otherInProgress: true }), {
      kind: "card",
      collapse: false,
      undoOnly: true,
    });
  });
});

describe("cardIncludes", () => {
  it("is false with no card", () => {
    assert.equal(cardIncludes(null, item("a")), false);
  });

  it("matches a single card on exercise and week", () => {
    assert.equal(cardIncludes(single("a"), item("a")), true);
    assert.equal(cardIncludes(single("a"), item("b")), false);
    assert.equal(cardIncludes(single("a", 1), item("a", 2)), false);
  });

  it("looks through a collapsed card's exercises", () => {
    const card: CheckCardState = { kind: "batch", items: [item("a"), item("b")] };
    assert.equal(cardIncludes(card, item("b")), true);
    assert.equal(cardIncludes(card, item("c")), false);
  });

  it("matches a «Día n completo» card on its exercise", () => {
    const card: CheckCardState = { kind: "dayAgain", dayId: "day-1", week: 2, exerciseId: "a" };
    assert.equal(cardIncludes(card, item("a")), true);
  });
});
