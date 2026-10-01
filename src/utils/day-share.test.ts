/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import { createInstance } from "i18next";
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import en from "@/src/i18n/en";
import es from "@/src/i18n/es";
import { type DayShare, dayShareText, whatsappLink } from "@/src/utils/day-share";

// The app's real copy, in an i18next instance of its own set up like
// src/i18n/index.ts (that module also reads AsyncStorage, which can't load
// under Node).
const i18n = createInstance();

before(async () => {
  await i18n.init({
    resources: { es: { translation: es }, en: { translation: en } },
    lng: "es",
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });
});

const LEG_DAY: DayShare = {
  n: 3,
  label: "Pierna",
  exercises: 5,
  sets: 18,
  minutes: null,
  record: null,
};

describe("dayShareText", () => {
  it("says what was done: the exercises and the sets", () => {
    assert.equal(
      dayShareText(i18n.getFixedT("es"), LEG_DAY),
      "¡Terminé el Día 3 (Pierna)! 5 ejercicios · 18 series",
    );
  });

  it("adds the minutes and the record only when there are any", () => {
    assert.equal(
      dayShareText(i18n.getFixedT("es"), {
        ...LEG_DAY,
        minutes: 42,
        record: { name: "Sentadilla", weight: 100, unit: "kg", reps: 5 },
      }),
      "¡Terminé el Día 3 (Pierna)! 5 ejercicios · 18 series · 42 min · Récord en Sentadilla: 100 kg × 5",
    );
    assert.equal(
      dayShareText(i18n.getFixedT("es"), {
        ...LEG_DAY,
        record: { name: "Sentadilla", weight: 100, unit: "kg", reps: 5 },
      }),
      "¡Terminé el Día 3 (Pierna)! 5 ejercicios · 18 series · Récord en Sentadilla: 100 kg × 5",
    );
  });

  it("counts one exercise and one set in the singular", () => {
    assert.equal(
      dayShareText(i18n.getFixedT("es"), { ...LEG_DAY, exercises: 1, sets: 1 }),
      "¡Terminé el Día 3 (Pierna)! 1 ejercicio · 1 serie",
    );
  });

  it("leaves the parentheses out for a day with no label", () => {
    assert.equal(
      dayShareText(i18n.getFixedT("es"), { ...LEG_DAY, label: null }),
      "¡Terminé el Día 3! 5 ejercicios · 18 series",
    );
  });

  it("speaks English too", () => {
    assert.equal(
      dayShareText(i18n.getFixedT("en"), {
        ...LEG_DAY,
        label: "Legs",
        minutes: 42,
        record: { name: "Squat", weight: 225, unit: "lb", reps: 5 },
      }),
      "I finished Day 3 (Legs)! 5 exercises · 18 sets · 42 min · Record on Squat: 225 lb × 5",
    );
  });
});

describe("whatsappLink", () => {
  it("keeps only the number's digits and types the message in", () => {
    const text = "¡Terminé el Día 3 (Pierna)! 5 ejercicios · 18 series";
    const url = whatsappLink("+1 (809) 555-1234", text);
    assert.ok(url != null);
    assert.ok(url.startsWith("https://wa.me/18095551234?text="));
    assert.equal(decodeURIComponent(url.slice(url.indexOf("?text=") + 6)), text);
  });

  it("is null without a number", () => {
    assert.equal(whatsappLink(null, "hola"), null);
    assert.equal(whatsappLink(undefined, "hola"), null);
    assert.equal(whatsappLink("", "hola"), null);
    assert.equal(whatsappLink(" - ", "hola"), null);
  });
});
