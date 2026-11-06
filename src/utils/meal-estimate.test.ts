/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
// Covers the estimate-meal Edge Function's pure module, which has no imports
// so both Deno and this runner can load it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acceptCorrection,
  buildEstimatePrompt,
  failureText,
  MAX_FAILURE_CHARS,
  parseEstimate,
  photoPathAllowed,
} from "@/supabase/functions/_shared/meal-estimate";

describe("acceptCorrection", () => {
  it("accepts spelling, accents and capitals", () => {
    assert.equal(acceptCorrection("arros con poyo y abichuelas", "Arroz con pollo y habichuelas"), true);
    assert.equal(acceptCorrection("platano", "Plátano"), true);
    assert.equal(acceptCorrection("Yogur con fresas", "Yogur con fresas"), true);
  });
  it("rejects changed meaning, words or quantities", () => {
    assert.equal(acceptCorrection("arroz con pollo", "pollo asado con arroz integral"), false);
    assert.equal(acceptCorrection("arroz con pollo", "arroz sin pollo"), false);
    assert.equal(acceptCorrection("2 huevos", "3 huevos"), false);
    assert.equal(acceptCorrection("jugo de chinola", "jugo de maracuyá"), false);
    assert.equal(acceptCorrection("pechugade pollo", "pechuga de pollo"), false);
    assert.equal(acceptCorrection("yogur con fresas", ""), false);
  });
  it("rejects a one-word swap to another food that is a few letters away", () => {
    // 3 edits on 8 letters: a salad must not become a fried pastry.
    assert.equal(acceptCorrection("ensalada verde", "empanada verde"), false);
  });
  it("still accepts real misspellings of long words", () => {
    assert.equal(acceptCorrection("verengena asada", "berenjena asada"), true);
  });
});

describe("parseEstimate", () => {
  it("reads numbers and rounds them", () => {
    assert.deepEqual(parseEstimate({ calories: 410.6, protein_g: 30.04, carbs_g: "55", fat_g: 10 }, "plan"), {
      calories: 411,
      protein_g: 30,
      carbs_g: 55,
      fat_g: 10,
      corrected: null,
    });
  });
  it("defaults missing macros to 0 and keeps the correction for other", () => {
    assert.deepEqual(parseEstimate({ calories: 180, corrected_text: "Yogur con fresas" }, "other"), {
      calories: 180,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
      corrected: "Yogur con fresas",
    });
  });
  it("rejects missing, non-numeric or out-of-range numbers", () => {
    assert.equal(parseEstimate({ protein_g: 10 }, "plan"), null);
    assert.equal(parseEstimate({ calories: "mucho" }, "plan"), null);
    assert.equal(parseEstimate({ calories: -5 }, "plan"), null);
    assert.equal(parseEstimate({ calories: 12000 }, "plan"), null);
    assert.equal(parseEstimate({ calories: 300, fat_g: 900 }, "plan"), null);
    assert.equal(parseEstimate("410 kcal", "plan"), null);
  });
  it("ignores an empty correction", () => {
    assert.equal(parseEstimate({ calories: 180, corrected_text: "  " }, "other")?.corrected, null);
  });
});

describe("photoPathAllowed", () => {
  it("only allows the owner's folder", () => {
    assert.equal(photoPathAllowed("u1", "u1/abc.jpg"), true);
    assert.equal(photoPathAllowed("u1", "u2/abc.jpg"), false);
    assert.equal(photoPathAllowed("u1", "u1abc/x.jpg"), false);
    assert.equal(photoPathAllowed("u1", "u1/../u2/x.jpg"), false);
  });
});

describe("failureText", () => {
  it("is an error's message", () => {
    assert.equal(
      failureText(new Error("gemini: timeout — signal timed out | groq: openai/gpt-oss-120b 429: rate limited")),
      "gemini: timeout — signal timed out | groq: openai/gpt-oss-120b 429: rate limited",
    );
  });
  it("names an error that has no message", () => {
    assert.equal(failureText(new TypeError()), "TypeError");
  });
  it("puts a database error's code first and its details after", () => {
    assert.equal(
      failureText({ code: "PGRST202", message: "Could not find the function", details: "no matches", hint: null }),
      "PGRST202: Could not find the function (no matches)",
    );
    const denied = Object.assign(new Error("permission denied for function finish_meal_estimate"), { code: "42501" });
    assert.equal(failureText(denied), "42501: permission denied for function finish_meal_estimate");
  });
  it("turns anything else into text", () => {
    assert.equal(failureText("boom"), "boom");
    assert.equal(failureText(undefined), "undefined");
  });
  it("keeps at most MAX_FAILURE_CHARS characters", () => {
    assert.equal(failureText(new Error("x".repeat(5000))).length, MAX_FAILURE_CHARS);
  });
});

describe("buildEstimatePrompt", () => {
  it("quotes the text, truncated, and asks for corrected_text only for other", () => {
    const long = "a".repeat(700);
    const p = buildEstimatePrompt({ kind: "other", text: long, hasPhoto: false });
    assert.ok(p.user.includes("a".repeat(600)) && !p.user.includes("a".repeat(601)));
    assert.ok(p.system.includes("corrected_text"));
    assert.ok(
      !buildEstimatePrompt({ kind: "plan", text: "80 g avena", hasPhoto: true }).system.includes("corrected_text"),
    );
  });
});
