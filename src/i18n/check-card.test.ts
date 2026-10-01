/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import en from "@/src/i18n/en";
import es from "@/src/i18n/es";

// The check card's copy: the spec's Copy table
// (docs/superpowers/specs/2026-10-01-check-celebration-design.md, checkCard.*)
// word for word. [key, es, en].
const COPY: [string, string, string][] = [
  ["progress", "{{done}}/{{total}}", "{{done}}/{{total}}"],
  ["time", "en {{time}}", "in {{time}}"],
  ["record", "Récord: {{weight}} × {{reps}}", "Record: {{weight}} × {{reps}}"],
  ["moreKg", "+{{kg}} vs semana {{w}}", "+{{kg}} vs week {{w}}"],
  ["moreReps", "+{{reps}} reps vs semana {{w}}", "+{{reps}} reps vs week {{w}}"],
  ["allSets", "{{done}} de {{total}} series", "{{done}} of {{total}} sets"],
  ["next", "Siguiente: {{name}}", "Next: {{name}}"],
  ["nextSuperset", "Ahora {{slot}}: {{name}}", "Now {{slot}}: {{name}}"],
  ["rest", "Descanso {{time}}", "Rest {{time}}"],
  ["undo", "Deshacer", "Undo"],
  ["batch", "{{count}} hechos", "{{count}} done"],
  ["dayAgain", "Día {{n}} completo", "Day {{n}} complete"],
  ["sheetNext", "Siguiente →", "Next →"],
];

describe("checkCard copy", () => {
  it("es has exactly these keys and texts", () => {
    assert.deepEqual({ ...es.checkCard }, Object.fromEntries(COPY.map(([key, text]) => [key, text])));
  });

  it("en has exactly these keys and texts", () => {
    assert.deepEqual({ ...en.checkCard }, Object.fromEntries(COPY.map(([key, , text]) => [key, text])));
  });
});
