import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";

import { MAX_TIMEOUT_MS } from "@/src/utils/subscription";

export const PERSIST_MAX_AGE = 1000 * 60 * 60 * 24 * 30;

/** How long fetched data counts as fresh: queries don't refetch on mount
    within it, and neither does a screen regaining focus (useRefreshOnFocus). */
export const STALE_MS = 30_000;

// Module scope (not component state) so the outbox and signOut cleanup can
// reach the same client/persister without hooks.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE_MS,
      retry: 1,
      // How long a query nobody observes stays in memory, and so in the
      // persisted cache. It is a setTimeout delay, which holds 24.8 days at
      // most: a longer one fires at once, and on web every query restored from
      // the persisted cache was dropped within a millisecond. It may be shorter
      // than PERSIST_MAX_AGE: hydration restarts each restored query's timer,
      // and maxAge only judges how old the saved cache is.
      gcTime: MAX_TIMEOUT_MS,
    },
    mutations: {
      // Mutations only write the local cache + outbox; the default "online"
      // mode would pause them while offline — exactly when they must run.
      networkMode: "always",
      retry: 0,
    },
  },
});

export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "hokage-rq-cache-v1",
  throttleTime: 2000,
});
