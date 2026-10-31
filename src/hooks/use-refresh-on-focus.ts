import { useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";

import { STALE_MS } from "@/src/lib/query-client";

/**
 * Refetches a query whenever the screen regains navigation focus
 * (e.g. switching back to a tab), unless it fetched less than STALE_MS ago:
 * going back and forth between tabs then refetches (and re-renders, and
 * re-persists the cache) at most once in that time. Skips the initial mount —
 * useQuery already fetches then.
 */
export function useRefreshOnFocus(refetch: () => void) {
  const firstTime = useRef(true);
  const fetchedAt = useRef(0);

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (firstTime.current) {
        firstTime.current = false;
        fetchedAt.current = now;
        return;
      }
      if (now - fetchedAt.current < STALE_MS) return;
      fetchedAt.current = now;
      refetch();
    }, [refetch])
  );
}
