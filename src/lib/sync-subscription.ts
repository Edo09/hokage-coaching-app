import type { MyAccess } from "@/src/types/database";
import { parseMyAccess } from "@/src/utils/subscription";

// One call to the sync-subscription Edge Function, the way every caller makes
// it: the function re-reads the customer from RevenueCat and answers
// `{ result, access }`, the caller's access as get_my_access() sees it. It is a
// safety net for a slow or lost webhook, so a failure is never an error for a
// screen, and it must never hang one: `supabase.functions.invoke` has no
// timeout of its own. Its dependency is an argument, so `npm test` runs it.

/** Longest the app waits for one call. The function normally answers in a
    second or two; past this the call is aborted and treated as unanswered. */
export const SYNC_TIMEOUT_MS = 15_000;

export type SyncInvoke = (signal: AbortSignal) => Promise<{ data: unknown; error: unknown }>;

/**
 * The access sync-subscription answers with, or null when there is none: an
 * error, a failed or aborted call, a timeout, an answer that is not an access.
 * Never rejects, and returns within `timeoutMs`.
 */
export async function syncSubscription(
  invoke: SyncInvoke,
  timeoutMs: number = SYNC_TIMEOUT_MS,
): Promise<MyAccess | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });
  // A call that fails after the timeout (the abort itself) lands here and is
  // swallowed; the race has already been decided.
  const answered = (async (): Promise<MyAccess | null> => {
    try {
      const { data, error } = await invoke(controller.signal);
      if (error) return null;
      return parseMyAccess((data as { access?: unknown } | null)?.access);
    } catch {
      return null;
    }
  })();
  try {
    return await Promise.race([answered, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
