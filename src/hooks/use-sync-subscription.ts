import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useAuth } from "@/src/hooks/use-auth";
import { qk } from "@/src/lib/query-keys";
import { syncSubscription } from "@/src/lib/sync-subscription";
import { supabase } from "@/src/utils/supabase";

/**
 * Asks sync-subscription (the server re-reads the customer from RevenueCat) and
 * writes the access it answers with into the access query, the one every
 * screen reads. Never rejects and never takes longer than SYNC_TIMEOUT_MS; a
 * failed call changes nothing. Resolves true when the function answered. Used
 * right after a purchase or a restore, and by the provider when a renewal has
 * not reached the app.
 */
export function useSyncSubscription(): () => Promise<boolean> {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  return useCallback(async () => {
    if (userId == null) return false;
    const fresh = await syncSubscription((signal) =>
      supabase.functions.invoke("sync-subscription", { signal }),
    );
    if (fresh == null) return false;
    queryClient.setQueryData(qk.access(userId), fresh);
    return true;
  }, [userId, queryClient]);
}
