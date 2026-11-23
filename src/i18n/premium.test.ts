/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import en from "@/src/i18n/en";
import es from "@/src/i18n/es";

// The spec's «Copy (es)» (docs/superpowers/specs/2026-11-16-premium-subscriptions-
// design.md), word for word: [path under `premium`, es text]. The nutrition and
// supplement lines are the spec's «the same with «plan de nutrición»».
const COPY: [string, string][] = [
  ["gate.program.title", "Aún sin programa"],
  ["gate.program.noneHint", "Suscríbete y pídele tu programa personalizado a tu coach."],
  ["gate.program.requestHint", "Pide tu programa y tu coach lo preparará para ti."],
  ["gate.program.requestAction", "Solicitar programa"],
  [
    "gate.program.lockedHint",
    "Renueva tu suscripción para volver a tu programa. Tu historial sigue aquí.",
  ],
  ["gate.nutrition.title", "Aún sin plan de nutrición"],
  [
    "gate.nutrition.noneHint",
    "Suscríbete y pídele tu plan de nutrición personalizado a tu coach.",
  ],
  ["gate.nutrition.requestHint", "Pide tu plan de nutrición y tu coach lo preparará para ti."],
  ["gate.nutrition.requestAction", "Solicitar Plan de nutrición"],
  [
    "gate.nutrition.lockedHint",
    "Renueva tu suscripción para volver a tu plan de nutrición. Tu historial sigue aquí.",
  ],
  [
    "gate.supplements.lockedHint",
    "Renueva tu suscripción para volver a tu plan de suplementos. Tu historial sigue aquí.",
  ],
  ["gate.pendingTitle", "Solicitud enviada"],
  ["gate.pendingHint", "Tu coach la verá y te avisará cuando esté lista."],
  ["gate.pendingSince", "Enviada el {{date}}"],
  ["gate.lockedTitle", "Tu acceso terminó"],
  ["gate.renewAction", "Renovar suscripción"],
  ["paywall.title", "Acceso Premium"],
  ["paywall.planMonthly", "Mensual"],
  ["paywall.planQuarterly", "Trimestral"],
  ["paywall.planAnnual", "Anual"],
  ["paywall.subscribe", "Suscribirme"],
  ["paywall.restore", "Restaurar compras"],
  [
    "paywall.renewsAutomatically",
    "Se renueva automáticamente. Puedes cancelar cuando quieras desde los ajustes de la tienda.",
  ],
  ["states.confirming", "Confirmando tu compra…"],
  ["states.processing", "Tu compra se está procesando"],
  ["states.pendingApproval", "Tu compra está pendiente de aprobación"],
  ["states.failed", "No se pudo completar la compra. Inténtalo de nuevo."],
  ["states.restored", "Compras restauradas"],
  ["states.nothingToRestore", "No encontramos compras para restaurar"],
  ["states.offline", "Sin conexión"],
  ["card.manage", "Gestionar suscripción"],
];

/** The value at a dotted path, undefined when any step is missing. */
function at(root: unknown, path: string): unknown {
  let node = root;
  for (const key of path.split(".")) {
    if (node == null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** Every leaf of a translation tree as [dotted path, text], sorted by path. */
function leaves(tree: unknown, prefix = ""): [string, string][] {
  if (typeof tree === "string") return [[prefix, tree]];
  if (tree == null || typeof tree !== "object") return [];
  return Object.entries(tree as Record<string, unknown>)
    .flatMap(([key, value]) => leaves(value, prefix === "" ? key : `${prefix}.${key}`))
    .sort(([a], [b]) => a.localeCompare(b));
}

/** The {{placeholders}} of a text, sorted and unique. */
function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))].sort();
}

describe("premium copy", () => {
  it("has a premium namespace in both languages", () => {
    assert.equal(typeof (es as Record<string, unknown>).premium, "object");
    assert.equal(typeof (en as Record<string, unknown>).premium, "object");
  });

  it("pins every string of the spec once", () => {
    assert.equal(COPY.length, 31);
    assert.equal(new Set(COPY.map(([path]) => path)).size, 31);
  });

  it("es has the spec's copy, word for word", () => {
    for (const [path, text] of COPY) {
      assert.equal(at(es, `premium.${path}`), text, `es premium.${path}`);
    }
  });

  it("en has a text for every pinned string", () => {
    for (const [path] of COPY) {
      const text = at(en, `premium.${path}`);
      assert.equal(typeof text, "string", `en premium.${path}`);
      assert.notEqual(text, "", `en premium.${path} is empty`);
    }
  });
});

describe("premium copy, es and en together", () => {
  const esLeaves = leaves((es as Record<string, unknown>).premium);
  const enLeaves = leaves((en as Record<string, unknown>).premium);

  it("have the same keys, so a string added to one language is added to the other", () => {
    // Not vacuous: an empty namespace would otherwise agree with itself.
    assert.ok(esLeaves.length >= COPY.length, "es premium namespace is missing strings");
    assert.deepEqual(
      esLeaves.map(([path]) => path),
      enLeaves.map(([path]) => path),
    );
  });

  it("use the same {{placeholders}} for every key", () => {
    const enByPath = new Map(enLeaves);
    for (const [path, text] of esLeaves) {
      assert.deepEqual(placeholders(enByPath.get(path) ?? ""), placeholders(text), `premium.${path}`);
    }
  });

  it("have no empty text", () => {
    for (const [path, text] of [...esLeaves, ...enLeaves]) {
      assert.notEqual(text.trim(), "", `premium.${path} is empty`);
    }
  });
});
