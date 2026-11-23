import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/src/hooks/use-auth";
import { qk } from "@/src/lib/query-keys";
import type { ContentRequest, ContentRequestKind } from "@/src/types/database";
import { supabase } from "@/src/utils/supabase";
import { pendingRequest } from "@/src/utils/subscription";

// The client's own requests for a program or a nutrition plan (RLS lets a
// client read only theirs; the explicit filter is defensive, as in the other
// hooks). The newest first. Changes arrive over Realtime through the
// provider, so «Solicitud enviada» turns to nothing when the coach assigns.
async function fetchRequests(userId: string): Promise<ContentRequest[]> {
  const { data, error } = await supabase
    .from("content_requests")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) {
    // A database without the Premium migration: no requests.
    if (error.code === "42P01") return [];
    throw error;
  }
  return (data ?? []) as ContentRequest[];
}

const NONE: ContentRequest[] = [];

export function useContentRequests() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: qk.contentRequests(user?.id),
    queryFn: () => fetchRequests(user!.id),
    enabled: !!user,
  });
  const requests = query.data ?? NONE;

  return {
    requests,
    /** The newest request of this kind still waiting for the coach. */
    pending: (kind: ContentRequestKind) => pendingRequest(requests, kind),
    /** The first fetch is in flight (not paused offline, not failed). */
    loading: query.isPending && query.fetchStatus === "fetching",
    refresh: query.refetch,
  };
}
