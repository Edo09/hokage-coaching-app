/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
// The RIR and tempo each exercise shows, and how a tempo is read.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProgramExercise, ProgramWeek } from "@/src/types/database";
import { effectivePrescription, formatRir, parseTempo } from "@/src/utils/program";

function ex(over: Partial<ProgramExercise> = {}): ProgramExercise {
  return {
    id: "e1",
    program_day_id: "",
    exercise_id: null,
    custom_name: "Press",
    sets: 4,
    rep_min: 8,
    rep_max: 10,
    is_unilateral: false,
    rir_min: null,
    rir_max: null,
    load_pct_1rm: null,
    load_qualitative: null,
    tempo: null,
    rest_seconds: 120,
    notes: null,
    sort_order: 0,
    created_at: "",
    superset_group: null,
    ...over,
  };
}

function week(over: Partial<ProgramWeek> = {}): ProgramWeek {
  return {
    id: "w1",
    program_id: "p",
    week_number: 1,
    label: null,
    rir_min: null,
    rir_max: null,
    load_pct_min: null,
    load_pct_max: null,
    is_deload: false,
    sets_override: null,
    notes: null,
    created_at: "",
    ...over,
  };
}

describe("effectivePrescription: RIR", () => {
  it("falls back to the week's RIR when the exercise sets none", () => {
    assert.equal(formatRir(effectivePrescription(ex(), week({ rir_min: 1, rir_max: 2 }), 1)), "RIR 1–2");
  });
  it("keeps the exercise's own RIR over the week's", () => {
    const p = effectivePrescription(ex({ rir_min: 3, rir_max: 3 }), week({ rir_min: 1, rir_max: 2 }), 1);
    assert.equal(formatRir(p), "RIR 3");
  });
  it("takes the exercise's override for the week over both", () => {
    const p = effectivePrescription(
      ex({ rir_min: 3, rir_max: 3, week_overrides: { "1": { rir_min: 0, rir_max: 0 } } }),
      week({ rir_min: 1, rir_max: 2 }),
      1,
    );
    assert.equal(formatRir(p), "RIR 0");
  });
  it("has no RIR when neither the exercise nor the week sets one", () => {
    assert.equal(formatRir(effectivePrescription(ex(), week(), 1)), null);
    assert.equal(formatRir(effectivePrescription(ex(), null, 1)), null);
  });
});

describe("effectivePrescription: tempo", () => {
  it("falls back to the program's default tempo", () => {
    assert.equal(effectivePrescription(ex(), null, 1, "3-1-2-0").tempo, "3-1-2-0");
  });
  it("keeps the exercise's own tempo over the default", () => {
    assert.equal(effectivePrescription(ex({ tempo: "4-0-1-0" }), null, 1, "3-1-2-0").tempo, "4-0-1-0");
  });
  it("treats a blank tempo as none", () => {
    assert.equal(effectivePrescription(ex({ tempo: "  " }), null, 1, "3-1-2-0").tempo, "3-1-2-0");
    assert.equal(effectivePrescription(ex(), null, 1, " ").tempo, null);
  });
});

describe("parseTempo", () => {
  it("reads four phases in seconds", () => {
    assert.deepEqual(parseTempo("3-1-2-0"), ["3", "1", "2", "0"]);
  });
  it("reads them written without dashes or with other separators", () => {
    for (const s of ["3120", "3 1 2 0", "3/1/2/0", "3.1.2.0", "3–1–2–0", " 3-1-2-0 "]) {
      assert.deepEqual(parseTempo(s), ["3", "1", "2", "0"], s);
    }
  });
  it("reads X as explosive, in either case", () => {
    assert.deepEqual(parseTempo("2-0-x-1"), ["2", "0", "X", "1"]);
  });
  it("reads two-digit phases when they are separated", () => {
    assert.deepEqual(parseTempo("10-0-1-0"), ["10", "0", "1", "0"]);
  });
  it("is null for anything else", () => {
    for (const s of [null, "", "3-1-1", "3-1-2-0-1", "Excéntrica 2-3s / concéntrica explosiva", "3-a-2-0", "31200"]) {
      assert.equal(parseTempo(s), null, String(s));
    }
  });
});
