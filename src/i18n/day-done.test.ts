/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import { createInstance } from "i18next";
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import en from "@/src/i18n/en";
import es from "@/src/i18n/es";

// The day-complete modal's copy: the spec's Copy table
// (docs/superpowers/specs/2026-10-01-check-celebration-design.md, dayDone.*)
// word for word, plus the fallbacks for a day with no label or weekday and a
// coach with no name, and the pieces of the WhatsApp summary. [key, es, en].
const COPY: [string, string, string][] = [
  ["goDay", "Ir al Día {{n}}", "Go to Day {{n}}"],
  ["goWeek", "Ir a la semana {{w}}", "Go to week {{w}}"],
  [
    "preview_one",
    "Día {{n}} · {{label}} · {{count}} ejercicio",
    "Day {{n}} · {{label}} · {{count}} exercise",
  ],
  [
    "preview_other",
    "Día {{n}} · {{label}} · {{count}} ejercicios",
    "Day {{n}} · {{label}} · {{count}} exercises",
  ],
  ["previewBare_one", "Día {{n}} · {{count}} ejercicio", "Day {{n}} · {{count}} exercise"],
  ["previewBare_other", "Día {{n}} · {{count}} ejercicios", "Day {{n}} · {{count}} exercises"],
  ["tellCoach", "Contarle a {{coach}}", "Tell {{coach}}"],
  ["tellCoachBare", "Contarle a tu coach", "Tell your coach"],
  [
    "whatsappSummary",
    "¡Terminé el Día {{n}} ({{label}})! {{stats}}",
    "I finished Day {{n}} ({{label}})! {{stats}}",
  ],
  ["whatsappSummaryBare", "¡Terminé el Día {{n}}! {{stats}}", "I finished Day {{n}}! {{stats}}"],
  ["summaryExercises_one", "{{count}} ejercicio", "{{count}} exercise"],
  ["summaryExercises_other", "{{count}} ejercicios", "{{count}} exercises"],
  ["summarySets_one", "{{count}} serie", "{{count}} set"],
  ["summarySets_other", "{{count}} series", "{{count}} sets"],
  ["summaryMinutes", "{{minutes}} min", "{{minutes}} min"],
  [
    "summaryRecord",
    "Récord en {{name}}: {{weight}} {{unit}} × {{reps}}",
    "Record on {{name}}: {{weight}} {{unit}} × {{reps}}",
  ],
];

describe("dayDone copy", () => {
  it("es has exactly these keys and texts", () => {
    assert.deepEqual({ ...es.dayDone }, Object.fromEntries(COPY.map(([key, text]) => [key, text])));
  });

  it("en has exactly these keys and texts", () => {
    assert.deepEqual({ ...en.dayDone }, Object.fromEntries(COPY.map(([key, , text]) => [key, text])));
  });
});

// Rendered like the app renders it: an i18next instance of its own, set up
// like src/i18n/index.ts (which also reads AsyncStorage, so it can't load
// under Node). The _one/_other suffixes are i18next's default plural format.
const i18n = createInstance();

before(async () => {
  await i18n.init({
    resources: { es: { translation: es }, en: { translation: en } },
    lng: "es",
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });
});

describe("dayDone copy, rendered", () => {
  it("es: the preview counts one exercise, or more", () => {
    const t = i18n.getFixedT("es");
    assert.equal(t("dayDone.preview", { n: 3, label: "Pierna", count: 1 }), "Día 3 · Pierna · 1 ejercicio");
    assert.equal(t("dayDone.preview", { n: 3, label: "Pierna", count: 5 }), "Día 3 · Pierna · 5 ejercicios");
    assert.equal(t("dayDone.previewBare", { n: 3, count: 5 }), "Día 3 · 5 ejercicios");
  });

  it("en: the preview counts one exercise, or more", () => {
    const t = i18n.getFixedT("en");
    assert.equal(t("dayDone.preview", { n: 3, label: "Legs", count: 1 }), "Day 3 · Legs · 1 exercise");
    assert.equal(t("dayDone.preview", { n: 3, label: "Legs", count: 5 }), "Day 3 · Legs · 5 exercises");
    assert.equal(t("dayDone.previewBare", { n: 3, count: 1 }), "Day 3 · 1 exercise");
  });
});
