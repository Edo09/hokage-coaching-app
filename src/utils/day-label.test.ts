/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import { createInstance } from "i18next";
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import en from "@/src/i18n/en";
import es from "@/src/i18n/es";
import { programDayName } from "@/src/utils/day-label";

// The app's real copy, in an instance of its own (the app's i18n module also
// reads AsyncStorage, which can't load under Node).
const i18n = createInstance();

before(async () => {
  await i18n.init({
    resources: { es: { translation: es }, en: { translation: en } },
    lng: "es",
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });
});

const day = { label: null, weekday: null, day_index: 2 };

describe("programDayName", () => {
  it("uses the day's label first", () => {
    assert.equal(programDayName({ ...day, label: "Pierna", weekday: "monday" }, i18n.t), "Pierna");
  });

  it("then its weekday, in the app's language", () => {
    assert.equal(programDayName({ ...day, label: "", weekday: "Monday" }, i18n.t), "Lunes");
  });

  it("then «Día n» (reminders.dayN), not the home card's all-caps «DÍA n»", () => {
    assert.equal(programDayName(day, i18n.t), "Día 2");
    assert.equal(programDayName({ ...day, weekday: "  " }, i18n.t), "Día 2");
  });

  it("follows the language", () => {
    const t = i18n.getFixedT("en");
    assert.equal(programDayName({ ...day, weekday: "friday" }, t), "Friday");
    assert.equal(programDayName(day, t), "Day 2");
  });
});
