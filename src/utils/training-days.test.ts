/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  toggleTrainingDay,
  TRAINING_DAY_VALUES,
  trainingDayIndexes,
} from "@/src/utils/training-days";

const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b);

describe("trainingDayIndexes", () => {
  it("reads the stored values the way the planner and Progreso do", () => {
    assert.deepEqual(sorted(trainingDayIndexes(["Mon", "Wed", "Fri"])), [0, 2, 4]);
  });

  it("takes other spellings of a weekday, and ignores what isn't one", () => {
    assert.deepEqual(sorted(trainingDayIndexes(["monday", "Thursday", "Lun", ""])), [0, 3]);
  });

  it("null or empty is no days", () => {
    assert.equal(trainingDayIndexes(null).size, 0);
    assert.equal(trainingDayIndexes(undefined).size, 0);
    assert.equal(trainingDayIndexes([]).size, 0);
  });
});

describe("toggleTrainingDay", () => {
  it("the stored values, Monday first", () => {
    assert.deepEqual(TRAINING_DAY_VALUES, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });

  it("adds a day in Monday-first order, as the panel stores it", () => {
    assert.deepEqual(toggleTrainingDay(["Fri", "Mon"], 2), ["Mon", "Wed", "Fri"]);
  });

  it("removes a picked day, down to none", () => {
    assert.deepEqual(toggleTrainingDay(["Mon", "Wed"], 0), ["Wed"]);
    assert.deepEqual(toggleTrainingDay(["Wed"], 2), []);
  });

  it("starts from nothing when the profile has no list", () => {
    assert.deepEqual(toggleTrainingDay(null, 6), ["Sun"]);
  });

  it("writes other spellings back as stored values and drops what isn't a weekday", () => {
    assert.deepEqual(toggleTrainingDay(["monday", "Lun"], 1), ["Mon", "Tue"]);
  });
});
