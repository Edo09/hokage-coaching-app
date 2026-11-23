import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useRef } from "react";

import type { PlanKind } from "@/src/config/purchases";
import { useAuth } from "@/src/hooks/use-auth";
import { usePremiumAccess } from "@/src/hooks/use-premium-access";
import { confirmPurchase } from "@/src/lib/confirm-purchase";
import { qk } from "@/src/lib/query-keys";
import { purchases } from "@/src/lib/purchases";
import type { MyAccess } from "@/src/types/database";
import { PurchaseFailed, type PurchaseFailure } from "@/src/utils/purchase";
import { flowReducer, INITIAL_FLOW } from "@/src/utils/purchase-flow";
import { isSubscribed, parseMyAccess } from "@/src/utils/subscription";
import { supabase } from "@/src/utils/supabase";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const failureOf = (error: unknown): PurchaseFailure =>
  error instanceof PurchaseFailed ? error.failure : { kind: "store_problem", detail: null };

/**
 * Buying and restoring (docs/superpowers/specs/2026-11-16-premium-
 * subscriptions-design.md, «Purchase states»), as the reducer in
 * src/utils/purchase-flow.ts sequences them. The store finishing is only the
 * start: success needs the server to say so. Right after a purchase or a
 * restore the app asks sync-subscription (a safety net for a slow webhook,
 * which answers with the caller's access: that answer is written into the
 * access query, the one every screen reads) and then waits for the access
 * query to show a subscription that grants access, over Realtime and a new
 * sync every 12 s (src/lib/confirm-purchase.ts). After a minute it says the
 * purchase is being processed and keeps listening: access arriving later
 * still turns it to success.
 */
export function usePurchaseFlow() {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const { subscribed } = usePremiumAccess();
  const [state, dispatch] = useReducer(flowReducer, INITIAL_FLOW);

  // The screen going away stops the wait; the phase mirrors state for the
  // callbacks, which must not start a second purchase.
  const gone = useRef(false);
  const phase = useRef(state.phase);
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
    };
  }, []);
  useEffect(() => {
    phase.current = state.phase;
  }, [state.phase]);

  const confirm = useCallback(async () => {
    if (userId == null) return;
    const outcome = await confirmPurchase({
      sync: async () => {
        const { data, error } = await supabase.functions.invoke("sync-subscription");
        if (error) return;
        const fresh = parseMyAccess((data as { access?: unknown } | null)?.access);
        if (fresh != null) queryClient.setQueryData(qk.access(userId), fresh);
      },
      confirmed: () =>
        isSubscribed(queryClient.getQueryData<MyAccess>(qk.access(userId)) ?? null, new Date()),
      sleep: wait,
      now: () => Date.now(),
      cancelled: () => gone.current,
    });
    if (gone.current) return;
    if (outcome === "confirmed") dispatch({ type: "confirmed" });
    else if (outcome === "timeout") dispatch({ type: "timedOut" });
  }, [userId, queryClient]);

  const buy = useCallback(
    async (kind: PlanKind) => {
      if (userId == null || phase.current !== "idle") return;
      dispatch({ type: "buy" });
      try {
        await purchases.purchase(kind, userId);
      } catch (error) {
        dispatch({ type: "failed", failure: failureOf(error) });
        return;
      }
      dispatch({ type: "bought" });
      await confirm();
    },
    [userId, confirm],
  );

  const restore = useCallback(async () => {
    if (userId == null || phase.current !== "idle") return;
    dispatch({ type: "restore" });
    let found: boolean;
    try {
      ({ found } = await purchases.restore(userId));
    } catch (error) {
      dispatch({ type: "failed", failure: failureOf(error) });
      return;
    }
    if (!found) {
      dispatch({ type: "restoredNone" });
      return;
    }
    dispatch({ type: "restoredFound" });
    await confirm();
  }, [userId, confirm]);

  // Access arriving after the wait gave up (the webhook, a renewal, the next
  // foreground) still ends it in success.
  useEffect(() => {
    if (state.phase === "processing" && subscribed) dispatch({ type: "confirmed" });
  }, [state.phase, subscribed]);

  const dismiss = useCallback(() => dispatch({ type: "dismiss" }), []);

  return { state, buy, restore, dismiss };
}
