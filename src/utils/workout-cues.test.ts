/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
// When the timed cues fire: the «10 seconds left» of a rest, and the
// «¿Sigues con…?» reminder of an exercise clock left running.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CLOCK_REMINDER_MS, clockReminderDelay, restWarningDelay } from "@/src/utils/workout-cues";

const NOW = 1_000_000;

describe("restWarningDelay", () => {
  it("sounds 10 seconds before the rest ends", () => {
    assert.equal(restWarningDelay(NOW + 120_000, NOW), 110_000);
  });

  it("still fits with 15 seconds left", () => {
    assert.equal(restWarningDelay(NOW + 15_000, NOW), 5_000);
  });

  it("stays quiet when there is no room left before the warning point", () => {
    // A 14-second rest: the cue would land right on top of the start cue.
    assert.equal(restWarningDelay(NOW + 14_000, NOW), null);
    // Resumed with 8 seconds left: already inside the last 10.
    assert.equal(restWarningDelay(NOW + 8_000, NOW), null);
  });
});

describe("clockReminderDelay", () => {
  it("fires 30 minutes after a fresh start", () => {
    assert.equal(clockReminderDelay({ runningSince: NOW, bankedMs: 0, now: NOW }), CLOCK_REMINDER_MS);
  });

  it("counts the time the clock already had", () => {
    // 10 minutes banked, running for 5: 15 to go.
    assert.equal(clockReminderDelay({ runningSince: NOW - 5 * 60_000, bankedMs: 10 * 60_000, now: NOW }), 15 * 60_000);
  });

  it("is off while the clock is paused", () => {
    assert.equal(clockReminderDelay({ runningSince: null, bankedMs: 10 * 60_000, now: NOW }), null);
  });

  it("is off once the clock is already past 30 minutes", () => {
    assert.equal(clockReminderDelay({ runningSince: NOW - 31 * 60_000, bankedMs: 0, now: NOW }), null);
  });
});
