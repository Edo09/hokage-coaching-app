/**
 * The coach's push notifications, pure half (the device side is
 * `@/src/lib/push`). The database sends them when the coach assigns
 * something, each with a `data.kind` and the tab it opens (`data.url`):
 *
 *   «Tienes un nuevo programa»            program-assigned          Programa
 *     (supabase/migrations/20261023150000_program_assigned_push.sql)
 *   «Tienes un nuevo plan de nutrición»   nutrition-plan-assigned   Nutrición
 *   «Tienes un nuevo plan de suplementos» supplement-plan-assigned  Nutrición
 *     (supabase/migrations/20261024120000_plan_assigned_push.sql)
 *
 * The migrations spell the same kinds, urls and channel.
 */

export const PROGRAM_PUSH_KIND = "program-assigned";
export const NUTRITION_PUSH_KIND = "nutrition-plan-assigned";
export const SUPPLEMENT_PUSH_KIND = "supplement-plan-assigned";

const COACH_PUSH_KINDS: ReadonlySet<unknown> = new Set([
  PROGRAM_PUSH_KIND,
  NUTRITION_PUSH_KIND,
  SUPPLEMENT_PUSH_KIND,
]);

/** True for a notification's `content.data` when it is one of the coach's
    pushes: the foreground handler shows it, and a tap on it opens its
    `data.url`. */
export function isCoachPushData(data: Record<string, unknown> | null | undefined): boolean {
  return COACH_PUSH_KINDS.has(data?.kind);
}

/** `push_tokens.platform` for this OS, or null where there are no pushes. */
export function pushPlatform(os: string): "ios" | "android" | null {
  return os === "ios" || os === "android" ? os : null;
}
