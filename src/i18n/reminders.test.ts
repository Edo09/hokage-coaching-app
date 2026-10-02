/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import { createInstance } from "i18next";
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import en from "@/src/i18n/en";
import es from "@/src/i18n/es";

// The spec's Copy table (docs/superpowers/specs/2026-09-29-local-reminders-design.md),
// word for word: [key, es, en].
const COPY: [string, string, string][] = [
  ["trainingTitle", "Hoy toca {{label}}", "Today: {{label}}"],
  ["trainingBody_one", "{{count}} ejercicio · Semana {{w}}", "{{count}} exercise · Week {{w}}"],
  ["trainingBody_other", "{{count}} ejercicios · Semana {{w}}", "{{count}} exercises · Week {{w}}"],
  [
    "inactivityTitle",
    "Han pasado {{days}} días sin entrenar",
    "It's been {{days}} days since you trained",
  ],
  ["inactivityBody", "{{label}} te espera", "{{label}} is waiting for you"],
  ["weekTitle", "Tu semana {{w}} ya está disponible", "Week {{w}} is now open"],
  ["weekBody_one", "{{label}} · {{count}} ejercicio", "{{label}} · {{count}} exercise"],
  ["weekBody_other", "{{label}} · {{count}} ejercicios", "{{label}} · {{count}} exercises"],
  ["dayN", "Día {{n}}", "Day {{n}}"],
  ["onboardingTitle", "¿Te avisamos los días de entreno?", "Want reminders on your training days?"],
  [
    "onboardingText",
    "Te recordamos qué te toca entrenar en tus días de entreno. Puedes cambiarlo cuando quieras en Ajustes.",
    "We'll remind you what to train on your training days. You can change this anytime in Settings.",
  ],
  ["enable", "Activar", "Turn on"],
  ["notNow", "Ahora no", "Not now"],
  ["cardTitle", "Notificaciones", "Notifications"],
  ["statusOn", "Activadas", "On"],
  ["statusOff", "Desactivadas", "Off"],
  ["enableButton", "Activar notificaciones", "Turn on notifications"],
  ["openSettings", "Abrir ajustes del teléfono", "Open phone settings"],
  ["prefTraining", "Días de entreno", "Training days"],
  ["prefInactivity", "Si llevo días sin entrenar", "When I haven't trained in a while"],
  ["prefWeek", "Cuando se abre una semana", "When a new week opens"],
  ["hour", "Hora del recordatorio", "Reminder time"],
  [
    "noDaysHint",
    "Elige tus días de entreno para recibir recordatorios.",
    "Pick your training days to get reminders.",
  ],
  ["daysLabel", "Tus días de entreno", "Your training days"],
  ["channelName", "Recordatorios", "Reminders"],
];

describe("reminders copy", () => {
  it("has the Copy table's 25 keys", () => {
    assert.equal(COPY.length, 25);
    assert.equal(new Set(COPY.map(([key]) => key)).size, 25);
  });

  it("es has exactly the Copy table's keys and texts", () => {
    assert.deepEqual({ ...es.reminders }, Object.fromEntries(COPY.map(([key, text]) => [key, text])));
  });

  it("en has exactly the Copy table's keys and texts", () => {
    assert.deepEqual({ ...en.reminders }, Object.fromEntries(COPY.map(([key, , text]) => [key, text])));
  });
});

// The app's copy rendered the way src/lib/reminders.ts renders it, in an
// i18next instance of its own set up like src/i18n/index.ts (that module also
// reads AsyncStorage, which can't load under Node). No compatibilityJSON, so
// the _one/_other suffixes are i18next's default plural format.
const i18n = createInstance();

before(async () => {
  await i18n.init({
    resources: { es: { translation: es }, en: { translation: en } },
    lng: "es",
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });
});

describe("reminders copy, rendered", () => {
  it("es: singular for one exercise, plural for more", () => {
    const t = i18n.getFixedT("es");
    assert.equal(t("reminders.trainingBody", { count: 1, w: 2 }), "1 ejercicio · Semana 2");
    assert.equal(t("reminders.trainingBody", { count: 3, w: 2 }), "3 ejercicios · Semana 2");
    assert.equal(t("reminders.weekBody", { label: "Pierna", count: 1 }), "Pierna · 1 ejercicio");
    assert.equal(t("reminders.weekBody", { label: "Pierna", count: 2 }), "Pierna · 2 ejercicios");
  });

  it("en: singular for one exercise, plural for more", () => {
    const t = i18n.getFixedT("en");
    assert.equal(t("reminders.trainingBody", { count: 1, w: 2 }), "1 exercise · Week 2");
    assert.equal(t("reminders.trainingBody", { count: 4, w: 2 }), "4 exercises · Week 2");
    assert.equal(t("reminders.weekBody", { label: "Legs", count: 1 }), "Legs · 1 exercise");
    assert.equal(t("reminders.weekBody", { label: "Legs", count: 2 }), "Legs · 2 exercises");
  });

  it("the day-number fallback reads «Día n», not the home card's «DÍA n»", () => {
    assert.equal(i18n.getFixedT("es")("reminders.dayN", { n: 2 }), "Día 2");
    assert.equal(i18n.getFixedT("en")("reminders.dayN", { n: 2 }), "Day 2");
  });
});
