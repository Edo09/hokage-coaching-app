/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { AppState, type AppStateStatus } from "react-native";

import { getToday, msUntilNextLocalMidnight, subscribeToday } from "@/src/lib/today";
import { addDays, toDateKey } from "@/src/utils/dates";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

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

describe("msUntilNextLocalMidnight", () => {
  describe("in America/Santo_Domingo", () => {
    inTimeZone("America/Santo_Domingo");

    it("counts to 00:00 of the next day", () => {
      assert.equal(msUntilNextLocalMidnight(new Date(2026, 9, 5, 12, 0)), 12 * HOUR);
      assert.equal(msUntilNextLocalMidnight(new Date(2026, 9, 5, 23, 59)), MINUTE);
    });

    it("is a whole day at midnight itself, never 0", () => {
      assert.equal(msUntilNextLocalMidnight(new Date(2026, 9, 5, 0, 0)), 24 * HOUR);
    });

    it("rolls over the end of the year", () => {
      assert.equal(msUntilNextLocalMidnight(new Date(2026, 11, 31, 18, 0)), 6 * HOUR);
    });
  });

  // US Eastern: 2027-03-14 has 23 hours, 2027-11-07 has 25.
  describe("across DST changes (America/New_York)", () => {
    inTimeZone("America/New_York");

    it("runs in the zone (EST before, EDT after 2027-03-14)", () => {
      assert.equal(new Date(2027, 2, 13, 12).getTimezoneOffset(), 300);
      assert.equal(new Date(2027, 2, 15, 12).getTimezoneOffset(), 240);
    });

    it("follows the calendar on a 23-hour day", () => {
      assert.equal(msUntilNextLocalMidnight(new Date(2027, 2, 14, 0, 30)), 22.5 * HOUR);
    });

    it("follows the calendar on a 25-hour day", () => {
      assert.equal(msUntilNextLocalMidnight(new Date(2027, 10, 7, 0, 30)), 24.5 * HOUR);
    });

    it("always lands on 00:00 of the next day", () => {
      for (const first of [new Date(2027, 2, 13, 0, 15), new Date(2027, 10, 6, 0, 15)]) {
        // Every half hour for three days around the change.
        for (let i = 0; i < 3 * 48; i++) {
          const now = new Date(first.getTime() + i * 30 * MINUTE);
          const ms = msUntilNextLocalMidnight(now);
          const then = new Date(now.getTime() + ms);
          assert.ok(ms > 0, now.toString());
          assert.equal(then.getHours(), 0, now.toString());
          assert.equal(then.getMinutes(), 0, now.toString());
          assert.equal(toDateKey(then), addDays(toDateKey(now), 1), now.toString());
        }
      }
    });
  });
});

// The store behind useToday, driven by mocked timers and a fake AppState
// ("react-native" is scripts/test-stubs/react-native.mjs under npm test).
describe("today store", () => {
  inTimeZone("America/Santo_Domingo");

  const realAddEventListener = AppState.addEventListener;
  let onAppState: ((status: AppStateStatus) => void) | null = null;
  let removed = 0;
  // Every subscription a test makes, so a failing test can't leave the
  // store's timer running into the next one.
  const stops: (() => void)[] = [];

  function listen(listener: () => void): () => void {
    const stop = subscribeToday(listener);
    stops.push(stop);
    return stop;
  }

  beforeEach(() => {
    onAppState = null;
    removed = 0;
    AppState.addEventListener = (_type, handler) => {
      onAppState = handler;
      return {
        remove() {
          removed++;
          onAppState = null;
        },
      };
    };
  });

  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
    mock.timers.reset();
    AppState.addEventListener = realAddEventListener;
  });

  it("is the same object all day", () => {
    mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date(2026, 9, 5, 8, 0) });
    const first = getToday();
    assert.equal(toDateKey(first), "2026-10-05");
    mock.timers.setTime(new Date(2026, 9, 5, 22, 0).getTime());
    assert.equal(getToday(), first);
  });

  it("notifies just after local midnight and moves to the new day", () => {
    mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date(2026, 9, 5, 23, 59) });
    let calls = 0;
    listen(() => calls++);
    mock.timers.tick(MINUTE); // 00:00:00; the timer aims 1s past it
    assert.equal(calls, 0);
    mock.timers.tick(1000);
    assert.equal(calls, 1);
    assert.equal(toDateKey(getToday()), "2026-10-06");
    mock.timers.tick(24 * HOUR); // and again the next night
    assert.equal(calls, 2);
    assert.equal(toDateKey(getToday()), "2026-10-07");
  });

  it("catches up on returning to the foreground", () => {
    mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date(2026, 9, 5, 10, 0) });
    let calls = 0;
    listen(() => calls++);
    // Two days in the background, with the timer never firing.
    mock.timers.setTime(new Date(2026, 9, 7, 9, 0).getTime());
    onAppState?.("background");
    assert.equal(calls, 0);
    onAppState?.("active");
    assert.equal(calls, 1);
    assert.equal(toDateKey(getToday()), "2026-10-07");
  });

  it("stops the timer and the AppState listener after the last unsubscribe", () => {
    mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date(2026, 9, 5, 23, 0) });
    let calls = 0;
    const stopA = listen(() => calls++);
    const stopB = listen(() => calls++);
    stopA();
    assert.ok(onAppState != null);
    assert.equal(removed, 0);
    stopB();
    assert.equal(onAppState, null);
    assert.equal(removed, 1);
    mock.timers.tick(2 * 24 * HOUR);
    assert.equal(calls, 0);
  });
});
