import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/src/hooks/use-auth";
import { useAccessClock } from "@/src/lib/access-clock";
import { qk } from "@/src/lib/query-keys";
import type { MyAccess } from "@/src/types/database";
import { supabase } from "@/src/utils/supabase";
import {
  accessState,
  effectiveAccess,
  isSubscribed,
  OPEN_ACCESS,
  parseMyAccess,
  type AccessState,
} from "@/src/utils/subscription";

// The one answer to «does this client have access», from the one server rule
// (rpc get_my_access: the coach, a store subscription or a coach-set
// membership). Persisted by react-query like every other query, so it renders
// offline once fetched; the provider (src/providers/subscription-provider.tsx)
// keeps it fresh over Realtime and after a purchase, and ticks the clock this
// reads at the moment access ends, so a screen flips without a round trip.
async function fetchMyAccess(): Promise<MyAccess> {
  const { data, error } = await supabase.rpc("get_my_access");
  if (error) {
    // A database without the Premium migration has no such function, and
    // nothing is locked there.
    if (error.code === "42883" || error.code === "PGRST202") return OPEN_ACCESS;
    throw error;
  }
  return parseMyAccess(data) ?? OPEN_ACCESS;
}

export type PremiumAccess = {
  /** The answer in use; null only while the first fetch is in flight. A client
      the app cannot read (offline, failed) gets OPEN_ACCESS, never a lock. */
  access: MyAccess | null;
  state: AccessState;
  /** The switch is on and this client has no access. */
  locked: boolean;
  /** A store subscription grants access right now. */
  subscribed: boolean;
  loading: boolean;
  /** When the answer in use was last read (ms; 0 before the first read). It
      moves on every read, even one that brought nothing new. */
  updatedAt: number;
  refresh: () => Promise<unknown>;
};

export function usePremiumAccess(): PremiumAccess {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: qk.access(user?.id),
    queryFn: fetchMyAccess,
    enabled: !!user,
  });
  const now = useAccessClock();

  const access = effectiveAccess(query.data ?? null, {
    pending: query.isPending,
    paused: query.fetchStatus === "paused",
  });
  const state = accessState(access, now);

  return {
    access,
    state,
    locked: state === "lapsed",
    subscribed: isSubscribed(access, now),
    loading: state === "loading",
    updatedAt: query.dataUpdatedAt,
    refresh: query.refetch,
  };
}
