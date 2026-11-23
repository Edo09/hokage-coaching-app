import { useCallback, useEffect, useState } from "react";

import { purchases } from "@/src/lib/purchases";
import type { Plan } from "@/src/utils/purchase";

type PlansState = { plans: Plan[]; status: "loading" | "ready" | "error" };

/**
 * The paywall's plans, read from the store when it opens (and again on
 * «Reintentar»). Plain state, never persisted: the prices shown must be the
 * store's now. An offering with none of the three plans is an error to the
 * screen too, since there is nothing to sell.
 */
export function usePlans(): PlansState & { reload: () => void } {
  const [state, setState] = useState<PlansState>({ plans: [], status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!purchases.available) return;
    let stale = false;
    purchases
      .loadPlans()
      .then((plans) => {
        if (!stale) setState({ plans, status: plans.length > 0 ? "ready" : "error" });
      })
      .catch(() => {
        if (!stale) setState({ plans: [], status: "error" });
      });
    return () => {
      stale = true;
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setState({ plans: [], status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, reload };
}
