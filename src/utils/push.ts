/**
 * The coach's push notifications, pure half (the device side is
 * `@/src/lib/push`). Today there is one: «Tienes un nuevo programa», sent by
 * the database when the coach assigns a program
 * (supabase/migrations/20261023150000_program_assigned_push.sql, which spells
 * the same kind, url and channel).
 */

/** `data.kind` on the program-assigned push: the foreground handler shows it,
    and a tap on it opens the Programa tab (its `data.url`). */
export const PROGRAM_PUSH_KIND = "program-assigned";

/** True for a notification's `content.data` when it is the program push. */
export function isProgramPushData(data: Record<string, unknown> | null | undefined): boolean {
  return data?.kind === PROGRAM_PUSH_KIND;
}

/** `push_tokens.platform` for this OS, or null where there are no pushes. */
export function pushPlatform(os: string): "ios" | "android" | null {
  return os === "ios" || os === "android" ? os : null;
}
