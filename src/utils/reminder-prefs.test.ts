/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyReminderPrefsPatch,
  parseReminderPrefs,
  REMINDER_HOURS,
  sameReminderPrefs,
} from "@/src/utils/reminder-prefs";
import { DEFAULT_REMINDER_PREFS } from "@/src/utils/reminders";

describe("parseReminderPrefs", () => {
  it("nothing stored gives the defaults", () => {
    assert.deepEqual(parseReminderPrefs(null), {
      training: true,
      inactivity: false,
      weekOpened: false,
      hour: 8,
    });
  });

  it("unreadable JSON gives the defaults", () => {
    assert.deepEqual(parseReminderPrefs("{not json"), DEFAULT_REMINDER_PREFS);
    assert.deepEqual(parseReminderPrefs(""), DEFAULT_REMINDER_PREFS);
  });

  it("JSON that is not an object gives the defaults", () => {
    assert.deepEqual(parseReminderPrefs("null"), DEFAULT_REMINDER_PREFS);
    assert.deepEqual(parseReminderPrefs("42"), DEFAULT_REMINDER_PREFS);
    assert.deepEqual(parseReminderPrefs('"on"'), DEFAULT_REMINDER_PREFS);
  });

  it("a saved value round-trips", () => {
    const saved = { training: false, inactivity: true, weekOpened: true, hour: 19 };
    assert.deepEqual(parseReminderPrefs(JSON.stringify(saved)), saved);
  });

  it("missing fields keep their defaults", () => {
    assert.deepEqual(parseReminderPrefs('{"inactivity":true}'), {
      ...DEFAULT_REMINDER_PREFS,
      inactivity: true,
    });
  });

  it("fields of the wrong type keep their defaults", () => {
    assert.deepEqual(
      parseReminderPrefs('{"training":"no","weekOpened":1,"hour":"9","inactivity":true}'),
      { ...DEFAULT_REMINDER_PREFS, inactivity: true },
    );
  });

  it("an hour outside 5..22 or not whole keeps the default", () => {
    for (const hour of [4, 23, 8.5, -1, null]) {
      assert.equal(parseReminderPrefs(JSON.stringify({ hour })).hour, 8, `hour ${hour}`);
    }
    assert.equal(parseReminderPrefs('{"hour":5}').hour, 5);
    assert.equal(parseReminderPrefs('{"hour":22}').hour, 22);
  });
});

describe("applyReminderPrefsPatch", () => {
  it("applies the patched fields only", () => {
    assert.deepEqual(applyReminderPrefsPatch(DEFAULT_REMINDER_PREFS, { hour: 21 }), {
      ...DEFAULT_REMINDER_PREFS,
      hour: 21,
    });
    assert.deepEqual(
      applyReminderPrefsPatch(DEFAULT_REMINDER_PREFS, { training: false, weekOpened: true }),
      { ...DEFAULT_REMINDER_PREFS, training: false, weekOpened: true },
    );
  });

  it("ignores invalid values", () => {
    const current = { training: false, inactivity: true, weekOpened: false, hour: 7 };
    assert.deepEqual(applyReminderPrefsPatch(current, { hour: 30 }), current);
    assert.deepEqual(applyReminderPrefsPatch(current, { hour: undefined }), current);
    assert.deepEqual(applyReminderPrefsPatch(current, {}), current);
  });
});

describe("sameReminderPrefs", () => {
  it("compares every field", () => {
    assert.equal(sameReminderPrefs(DEFAULT_REMINDER_PREFS, { ...DEFAULT_REMINDER_PREFS }), true);
    assert.equal(sameReminderPrefs(DEFAULT_REMINDER_PREFS, { ...DEFAULT_REMINDER_PREFS, hour: 9 }), false);
    assert.equal(
      sameReminderPrefs(DEFAULT_REMINDER_PREFS, { ...DEFAULT_REMINDER_PREFS, weekOpened: true }),
      false,
    );
  });
});

describe("REMINDER_HOURS", () => {
  it("is every whole hour from 5 to 22", () => {
    assert.equal(REMINDER_HOURS.length, 18);
    assert.equal(REMINDER_HOURS[0], 5);
    assert.equal(REMINDER_HOURS[REMINDER_HOURS.length - 1], 22);
    assert.ok(REMINDER_HOURS.includes(DEFAULT_REMINDER_PREFS.hour));
  });
});
