import { useCallback, useState } from "react";

// Pull-to-refresh state that follows the user's pull, and only that. Bound to
// a query's isRefetching instead, the indicator also showed for every
// background refetch (each tab focus via useRefreshOnFocus, realtime pushes,
// outbox flushes), and on Android that drops the refresh spinner's disc over
// the first card on every tab switch.

/** One pull: the indicator shows until `refresh` settles, failed or not (the
    query's own error state reports a failure; a rejected pull would only be
    an unhandled rejection). Exported for the tests. */
export async function runPull(
  refresh: () => unknown,
  setRefreshing: (refreshing: boolean) => void,
): Promise<void> {
  setRefreshing(true);
  try {
    await refresh();
  } catch {
    // Reported by the query itself.
  } finally {
    setRefreshing(false);
  }
}

/** `refreshing` / `onRefresh` for a RefreshControl. Pass a refresh that
    returns its fetch's promise, so the indicator stays until data lands. */
export function usePullRefresh(refresh: (() => unknown) | undefined) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    if (refresh != null) void runPull(refresh, setRefreshing);
  }, [refresh]);
  return { refreshing, onRefresh };
}
