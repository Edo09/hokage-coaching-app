/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import en from "@/src/i18n/en";
import es from "@/src/i18n/es";

// Meal registration's copy: the spec's Copy table
// (docs/superpowers/specs/2026-11-05-nutrition-meal-registration-design.md)
// word for word in es; en is ours. [key, es, en].
const COPY: [key: string, es: string, en: string][] = [
  ["today", "Hoy", "Today"],
  ["aiEstimated", "estimado con IA", "AI estimate"],
  ["remaining", "{{n}} restantes", "{{n}} left"],
  ["inRange", "En tu rango", "In range"],
  ["over", "{{n}} de más", "{{n}} over"],
  ["doneCount_one", "{{done}} de {{count}} comida", "{{done}} of {{count}} meal"],
  ["doneCount_other", "{{done}} de {{count}} comidas", "{{done}} of {{count}} meals"],
  ["next", "Siguiente", "Next"],
  ["optionsCount_one", "{{count}} opción", "{{count}} option"],
  ["optionsCount_other", "{{count}} opciones", "{{count}} options"],
  ["registerMeal", "Registrar {{meal}}", "Log {{meal}}"],
  ["optionN", "Opción {{n}}", "Option {{n}}"],
  ["fromPlan", "Del plan", "From the plan"],
  ["otherMeal", "Otra comida", "Something else"],
  ["skipped", "No la comí", "Didn't eat it"],
  ["optional", "Opcional", "Optional"],
  ["estimating", "Calculando…", "Estimating…"],
  ["notEstimated", "Sin estimar", "Not estimated"],
  ["notToday", "No aplica hoy", "Not for today"],
  ["whatDidYouEat", "¿Qué comiste?", "What did you eat?"],
  ["ateSomethingElse", "Comí otra cosa", "I ate something else"],
  ["writeWhatYouAte", "Escribe lo que comiste", "Write what you ate"],
  [
    "aiHint",
    "Al guardar, la IA corrige la ortografía y calcula las calorías.",
    "When you save, the AI fixes the spelling and works out the calories.",
  ],
  ["addPhoto", "Añadir foto", "Add photo"],
  ["platePhoto", "Foto del plato", "Photo of the plate"],
  ["change", "Cambiar", "Change"],
  [
    "photoNeedsConnection",
    "La foto necesita conexión. Puedes guardar sin ella.",
    "The photo needs a connection. You can save without it.",
  ],
  ["undoEntry", "Deshacer registro", "Undo entry"],
  ["undoTitle", "¿Deshacer el registro?", "Undo this entry?"],
  ["undoBody", "{{meal}} vuelve a quedar pendiente.", "{{meal}} will be pending again."],
  ["undoConfirm", "Deshacer", "Undo"],
  ["trainingDay", "Día de entreno", "Training day"],
  ["restDay", "Día de descanso", "Rest day"],
  ["autoFromProgram", "Según tu programa", "From your program"],
  ["overridden", "Cambiado por ti", "Changed by you"],
  ["noPlanTitle", "Sin plan nutricional", "No nutrition plan"],
  ["noPlanHint", "Tu coach aún no te ha asignado uno.", "Your coach hasn't assigned one yet."],
  ["coachNotes", "Notas del coach", "Coach notes"],
  ["mealsCount_one", "{{count}} comida", "{{count}} meal"],
  ["mealsCount_other", "{{count}} comidas", "{{count}} meals"],
];

describe("mealReg copy", () => {
  it("es has exactly these keys and texts", () => {
    assert.deepEqual({ ...es.mealReg }, Object.fromEntries(COPY.map(([key, text]) => [key, text])));
  });

  it("en has exactly these keys and texts", () => {
    assert.deepEqual({ ...en.mealReg }, Object.fromEntries(COPY.map(([key, , text]) => [key, text])));
  });

  it("Progreso's empty nutrition card asks for the plan's meals", () => {
    assert.equal(
      es.progress.emptyNutricion,
      "Registra las comidas de tu plan para ver tus calorías, proteína y adherencia a la meta.",
    );
    assert.equal(en.progress.emptyNutricion, "Log your plan's meals to see your calories, protein and goal adherence.");
  });
});
