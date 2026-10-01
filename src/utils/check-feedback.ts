import type { CheckCardState } from "@/src/lib/check-card";

// What checking an exercise off shows, decided before the write: the check
// card, only the day-complete modal, or a small «Día n completo» card (the
// "When it shows" table in docs/superpowers/specs/2026-10-01-check-celebration-design.md).
// Pure, so it is unit tested; src/hooks/use-check-feedback.ts gathers the
// facts and acts on the answer.

/** One exercise in one week: what a card's «Deshacer» unchecks. */
export type CheckedItem = { exerciseId: string; week: number };

export type CheckFeedback =
  /** The day's last check: the day-complete modal is the moment, no card. */
  | { kind: "dayModal" }
  /** The day's last check again, for a day already celebrated this app
      session: no replay, a small «Día n completo» card. */
  | { kind: "dayAgain" }
  /** The card. `collapse`: part of a quick run of checks, whose «n hechos»
      card checkCard.noteCheck already put up: it stays. `undoOnly`: only
      «Deshacer» on it. */
  | { kind: "card"; collapse: boolean; undoOnly: boolean };

export function checkFeedback(input: {
  /** Checking it off finishes its day for the week (completesDay, read before the write). */
  finishesDay: boolean;
  /** That day and week was already celebrated this app session. */
  celebrated: boolean;
  /** Right after the previous check (checkCard.noteCheck said "batch"). */
  batch: boolean;
  /** A week before the current one: logging after the fact. */
  pastWeek: boolean;
  /** Another exercise is in progress: «Siguiente» would juggle two. */
  otherInProgress: boolean;
}): CheckFeedback {
  if (input.finishesDay) return input.celebrated ? { kind: "dayAgain" } : { kind: "dayModal" };
  return {
    kind: "card",
    collapse: input.batch,
    undoOnly: input.pastWeek || input.otherInProgress,
  };
}

const same = (a: CheckedItem, b: CheckedItem) => a.exerciseId === b.exerciseId && a.week === b.week;

/** Whether the card on screen stands for this exercise and week. */
export function cardIncludes(card: CheckCardState | null, item: CheckedItem): boolean {
  if (card == null) return false;
  if (card.kind === "batch") return card.items.some((i) => same(i, item));
  return same({ exerciseId: card.exerciseId, week: card.week }, item);
}
