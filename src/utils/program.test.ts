/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { addDays } from "@/src/utils/dates";
import { currentWeekOf, weekLock, weekOpensOn } from "@/src/utils/program";

// Run a suite's tests in a fixed time zone, so results don't depend on the
// machine's. Node re-reads TZ when process.env.TZ is assigned (Windows too;
// Git Bash drops a TZ set on the command line, so it has to be set here).
function inTimeZone(tz: string) {
  let saved: string | undefined;
  before(() => {
    saved = process.env.TZ;
    process.env.TZ = tz;
  });
  after(() => {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  });
}

/** A local clock time on a "YYYY-MM-DD" day. */
function at(key: string, hours = 12, minutes = 0): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, hours, minutes);
}

// `lock` undefined stands for a program cached before the column existed.
function program(lock: boolean | undefined, startDate = "2026-10-05", durationWeeks = 4) {
  return {
    lock_future_weeks: lock as boolean,
    start_date: startDate,
    duration_weeks: durationWeeks,
  };
}

// The coach's zone (UTC-4, no DST).
describe("in America/Santo_Domingo", () => {
  inTimeZone("America/Santo_Domingo");

  describe("weekOpensOn", () => {
    it("opens week 1 on the start date", () => {
      assert.equal(weekOpensOn("2026-10-05", 1), "2026-10-05");
    });

    it("opens each later week 7 days after the one before", () => {
      assert.equal(weekOpensOn("2026-10-05", 2), "2026-10-12");
      assert.equal(weekOpensOn("2026-10-05", 4), "2026-10-26");
    });

    it("crosses month and year ends", () => {
      assert.equal(weekOpensOn("2026-12-28", 2), "2027-01-04");
    });
  });

  describe("currentWeekOf", () => {
    it("is week 1 before the start and on the start date", () => {
      assert.equal(currentWeekOf("2026-10-05", 4, at("2026-09-20")), 1);
      assert.equal(currentWeekOf("2026-10-05", 4, at("2026-10-05", 0, 0)), 1);
    });

    it("moves to week 2 on day 8, whatever the time of day", () => {
      assert.equal(currentWeekOf("2026-10-05", 4, at("2026-10-11", 23, 59)), 1);
      assert.equal(currentWeekOf("2026-10-05", 4, at("2026-10-12", 0, 0)), 2);
    });

    it("stays on the last week after the block", () => {
      assert.equal(currentWeekOf("2026-10-05", 4, at("2027-01-15")), 4);
    });
  });

  describe("weekLock", () => {
    it("never locks when the flag is off", () => {
      assert.equal(weekLock(program(false), 1, at("2026-09-20")), null);
      assert.equal(weekLock(program(false), 4, at("2026-10-14")), null);
    });

    it("never locks when the flag is missing", () => {
      assert.equal(weekLock(program(undefined), 1, at("2026-09-20")), null);
      assert.equal(weekLock(program(undefined), 4, at("2026-10-14")), null);
    });

    it("locks every week until the start date", () => {
      const now = at("2026-10-04", 23, 59);
      assert.deepEqual(weekLock(program(true), 1, now), { kind: "start", opensOn: "2026-10-05" });
      assert.deepEqual(weekLock(program(true), 3, now), { kind: "start", opensOn: "2026-10-05" });
    });

    it("opens week 1 on the start date", () => {
      assert.equal(weekLock(program(true), 1, at("2026-10-05", 0, 0)), null);
    });

    it("keeps the current week and past weeks open", () => {
      const now = at("2026-10-14"); // week 2
      assert.equal(weekLock(program(true), 2, now), null);
      assert.equal(weekLock(program(true), 1, now), null);
    });

    it("locks later weeks until the date each one opens", () => {
      const now = at("2026-10-14"); // week 2
      assert.deepEqual(weekLock(program(true), 3, now), { kind: "week", opensOn: "2026-10-19" });
      assert.deepEqual(weekLock(program(true), 4, now), { kind: "week", opensOn: "2026-10-26" });
    });

    it("opens the next week at local midnight", () => {
      assert.deepEqual(weekLock(program(true), 3, at("2026-10-18", 23, 59)), {
        kind: "week",
        opensOn: "2026-10-19",
      });
      assert.equal(weekLock(program(true), 3, at("2026-10-19", 0, 0)), null);
    });

    it("opens every week after the block", () => {
      for (let w = 1; w <= 4; w++) {
        assert.equal(weekLock(program(true), w, at("2026-11-20")), null);
      }
    });
  });
});

// US Eastern: DST starts 2027-03-14 (a 23-hour day) and ends 2027-11-07 (a
// 25-hour day). Counting days by dividing local-midnight gaps by 24h and
// flooring came out a day short across the spring change.
describe("across DST changes (America/New_York)", () => {
  inTimeZone("America/New_York");

  it("runs in the zone (EST before, EDT after 2027-03-14)", () => {
    assert.equal(new Date(2027, 2, 13, 12).getTimezoneOffset(), 300);
    assert.equal(new Date(2027, 2, 15, 12).getTimezoneOffset(), 240);
  });

  it("moves to week 2 on day 8 across the spring change", () => {
    assert.equal(currentWeekOf("2027-03-08", 4, at("2027-03-15", 0, 30)), 2);
  });

  it("moves to week 2 on day 8 across the fall change", () => {
    assert.equal(currentWeekOf("2027-11-01", 4, at("2027-11-08", 0, 30)), 2);
  });

  // Blocks starting on every day of a four-week window around each change,
  // so every week boundary near it is crossed, at both ends of the day.
  it("opens each week on its date and not the day before", () => {
    const starts = [
      ...Array.from({ length: 28 }, (_, i) => addDays("2027-02-20", i)),
      ...Array.from({ length: 28 }, (_, i) => addDays("2027-10-20", i)),
    ];
    for (const start of starts) {
      const p = program(true, start, 4);
      for (let w = 2; w <= 4; w++) {
        const opensOn = weekOpensOn(start, w);
        const dayBefore = addDays(opensOn, -1);
        for (const [h, m] of [
          [0, 0],
          [23, 59],
        ]) {
          assert.equal(
            weekLock(p, w, at(opensOn, h, m)),
            null,
            `start ${start}: week ${w} open on ${opensOn} ${h}:${m}`,
          );
          assert.deepEqual(
            weekLock(p, w, at(dayBefore, h, m)),
            { kind: "week", opensOn },
            `start ${start}: week ${w} locked on ${dayBefore} ${h}:${m}`,
          );
        }
      }
    }
  });
});
