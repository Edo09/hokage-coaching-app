import type { ContentRequest } from "@/src/types/database";

// Asking the coach for a program or a nutrition plan (docs/superpowers/specs/
// 2026-11-16-premium-subscriptions-design.md, «Request sheet»). The server's
// request_content raises by message and the app turns each into what the
// sheet does next. No React, no Expo: `npm test` pins it.

/** The note's limit, enforced by the database too. */
export const REQUEST_NOTE_MAX = 500;

export type RequestError =
  /** Access lapsed behind the screen (or the caller is the coach): offer the paywall. */
  | "premium_required"
  /** The coach already assigned one: close the sheet and read it again. */
  | "already_assigned"
  | "offline"
  /** invalid_kind, note_too_long: the sheet never sends these. */
  | "invalid"
  | "failed";

// How a failed fetch is worded: supabase-js hands it back as a message
// ("TypeError: Failed to fetch" on web, "… Network request failed" on native).
const OFFLINE = /failed to fetch|network request failed|load failed/i;

/**
 * An error from rpc('request_content') as what the sheet should do. The
 * permission error (42501) is premium_required too: it is what the database
 * says to a caller who may not ask, whatever the wording.
 */
export function classifyRequestError(error: unknown): RequestError {
  const e = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : null;
  const message = typeof e?.message === "string" ? e.message : "";
  const code = typeof e?.code === "string" ? e.code : "";
  if (message.includes("premium_required") || code === "42501") return "premium_required";
  if (message.includes("already_assigned")) return "already_assigned";
  if (message.includes("invalid_kind") || message.includes("note_too_long")) return "invalid";
  if (OFFLINE.test(message)) return "offline";
  return "failed";
}

/** The list with this request in it: replaced in place when its id is there,
    else first (the newest). Never changes the list it is given. */
export function upsertRequest(
  list: readonly ContentRequest[],
  row: ContentRequest,
): ContentRequest[] {
  const index = list.findIndex((r) => r.id === row.id);
  if (index === -1) return [row, ...list];
  return list.map((r, i) => (i === index ? row : r));
}
