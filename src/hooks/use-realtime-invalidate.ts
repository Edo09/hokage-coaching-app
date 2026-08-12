import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { supabase } from "@/src/utils/supabase";

// Channel names must be unique per SUBSCRIPTION, not per table+filter:
// supabase.channel(name) hands back the EXISTING channel when the name
// matches, and calling .on() on one that has already subscribed throws
// "cannot add postgres_changes callbacks … after subscribe()".
//
// Two things collide on a shared name. useNutritionPlan() calls useProgram()
// internally, so the Programa screen and the Nutrición tab can hold two
// identical `programs` subscriptions at once — and in dev, Fast Refresh
// re-runs the effect while the old channel is still tearing down
// (removeChannel is async). A monotonic suffix sidesteps both.
let channelSeq = 0;

/**
 * Invalidate a query whenever a row the client cares about changes on the
 * server — so a coach saving in the admin panel lands in the app immediately
 * instead of waiting for a pull-to-refresh that mobile web doesn't even offer.
 *
 * Invalidates rather than applying the payload: the screens read a deeply
 * nested graph (program → days → exercises → weeks), and a realtime event only
 * carries the one row that changed. Refetching is both simpler and correct;
 * these are small, rarely-written tables.
 *
 * Requires the table to be on the `supabase_realtime` publication
 * (20260807130000_realtime_coach_content.sql). RLS still applies, so a client
 * only ever receives rows they could already SELECT.
 *
 * No-ops when `filter` is undefined — callers pass `user_id=eq.${user?.id}`,
 * which isn't known until auth resolves.
 */
export function useRealtimeInvalidate(
  table: string,
  filter: string | undefined,
  queryKey: readonly unknown[],
) {
  const queryClient = useQueryClient();
  // Stable primitive so the effect doesn't resubscribe on every render just
  // because the caller built a fresh array literal.
  const keyId = JSON.stringify(queryKey);

  useEffect(() => {
    if (filter == null) return;

    channelSeq += 1;
    const channel = supabase
      .channel(`sync:${table}:${channelSeq}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter },
        () => {
          void queryClient.invalidateQueries({ queryKey: JSON.parse(keyId) as unknown[] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [table, filter, keyId, queryClient]);
}
