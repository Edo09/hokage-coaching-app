/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
// The coach's pick of workout sounds: one set per moment, from the sets built
// into the app (the panel's «Sonidos de la app», public.app_sound_settings).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CUES,
  DEFAULT_SOUND_CHOICE,
  restChannelId,
  SOUND_SETS,
  soundChoiceFromRow,
  soundFileName,
  staleRestChannelIds,
} from "@/src/utils/sound-sets";

describe("soundChoiceFromRow", () => {
  it("reads the coach's row, one column per moment", () => {
    assert.deepEqual(
      soundChoiceFromRow({
        rest_start: "ring",
        rest_warn: "bells",
        rest_done: "ring",
        new_record: "arcade",
        day_complete: "classic",
      }),
      { start: "ring", warn: "bells", done: "ring", record: "arcade", day: "classic" },
    );
  });

  it("is the classic set everywhere without a row", () => {
    assert.deepEqual(DEFAULT_SOUND_CHOICE, {
      start: "classic",
      warn: "classic",
      done: "classic",
      record: "classic",
      day: "classic",
    });
    assert.deepEqual(soundChoiceFromRow(null), DEFAULT_SOUND_CHOICE);
    assert.deepEqual(soundChoiceFromRow(undefined), DEFAULT_SOUND_CHOICE);
  });

  it("plays classic for a set this build doesn't have", () => {
    // A later panel may offer a set that an older app build lacks.
    assert.deepEqual(
      soundChoiceFromRow({ rest_start: "whistle", rest_warn: 7, rest_done: null, new_record: "bells" }),
      { start: "classic", warn: "classic", done: "classic", record: "bells", day: "classic" },
    );
  });
});

describe("soundFileName", () => {
  it("keeps the classic files' names; the other sets prefix theirs", () => {
    assert.equal(soundFileName("classic", "start"), "rest_start.wav");
    assert.equal(soundFileName("classic", "warn"), "rest_warn.wav");
    assert.equal(soundFileName("classic", "done"), "rest_done.wav");
    assert.equal(soundFileName("classic", "record"), "record.wav");
    assert.equal(soundFileName("classic", "day"), "day_done.wav");
    assert.equal(soundFileName("ring", "done"), "ring_done.wav");
    assert.equal(soundFileName("arcade", "day"), "arcade_day.wav");
  });

  it("names only files that exist, with names Android allows for resources", () => {
    for (const set of SOUND_SETS) {
      for (const cue of CUES) {
        const name = soundFileName(set, cue);
        assert.match(name, /^[a-z][a-z0-9_]*\.wav$/);
        assert.ok(existsSync(`assets/sounds/${name}`), `assets/sounds/${name} is missing`);
      }
    }
  });

  it("bundles every set's «Rest over» sound for notifications (app.json)", () => {
    const app = JSON.parse(readFileSync("app.json", "utf8"));
    const plugin = app.expo.plugins.find(
      (p: unknown) => Array.isArray(p) && p[0] === "expo-notifications",
    );
    const bundled: string[] = plugin[1].sounds;
    for (const set of SOUND_SETS) {
      assert.ok(
        bundled.includes(`./assets/sounds/${soundFileName(set, "done")}`),
        `${soundFileName(set, "done")} is not in app.json's notification sounds`,
      );
    }
  });
});

describe("the player's files (src/lib/rest-alert.ts)", () => {
  it("map each set and moment to the file soundFileName names", () => {
    // Metro needs every require spelled out, so the map is written by hand.
    const source = readFileSync("src/lib/rest-alert.ts", "utf8");
    for (const set of SOUND_SETS) {
      const block = new RegExp(`\\n  ${set}: \\{([^}]*)\\}`).exec(source);
      assert.ok(block != null, `no file map for ${set}`);
      for (const cue of CUES) {
        assert.ok(
          block[1].includes(`${cue}: require("@/assets/sounds/${soundFileName(set, cue)}")`),
          `${set}.${cue} should play ${soundFileName(set, cue)}`,
        );
      }
    }
  });
});

describe("restChannelId", () => {
  it("keeps the classic set's channel ids, so phones keep theirs", () => {
    assert.equal(restChannelId("both", "classic"), "rest-sound-vibrate");
    assert.equal(restChannelId("sound", "classic"), "rest-sound");
    assert.equal(restChannelId("vibrate", "classic"), "rest-vibrate");
  });

  it("gives each other set's sound a channel of its own", () => {
    // Android keeps a channel's first sound, so a new sound needs a new channel.
    assert.equal(restChannelId("both", "ring"), "rest-sound-vibrate-ring");
    assert.equal(restChannelId("sound", "bells"), "rest-sound-bells");
  });

  it("has one vibrate-only channel whatever the set: it plays no sound", () => {
    assert.equal(restChannelId("vibrate", "arcade"), "rest-vibrate");
  });
});

describe("staleRestChannelIds", () => {
  it("lists the other sets' sound channels, never the one in use or vibrate-only", () => {
    const stale = staleRestChannelIds("ring");
    assert.ok(stale.includes("rest-sound-vibrate"));
    assert.ok(stale.includes("rest-sound"));
    assert.ok(stale.includes("rest-sound-vibrate-bells"));
    assert.ok(stale.includes("rest-sound-arcade"));
    assert.ok(!stale.includes("rest-sound-vibrate-ring"));
    assert.ok(!stale.includes("rest-sound-ring"));
    assert.ok(!stale.includes("rest-vibrate"));
    assert.equal(stale.length, (SOUND_SETS.length - 1) * 2);
  });
});
