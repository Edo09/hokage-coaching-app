import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/src/hooks/use-auth";
import { qk } from "@/src/lib/query-keys";
import type { Membership } from "@/src/types/database";
import { supabase } from "@/src/utils/supabase";

// The client's own membership (coach edits it from web). Read-only here.
// Most recent row wins if several exist.
async function fetchMembership(userId: string): Promise<Membership | null> {
  const { data, error } = await supabase
    .from("memberships")
    .select("*")
    .eq("client_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Membership | null) ?? null;
}

export function useMembership() {
  const { user } = useAuth();
  const {
    data: membership = null,
    isPending: loading,
    isError: error,
  } = useQuery({
    queryKey: qk.membership(user?.id),
    queryFn: () => fetchMembership(user!.id),
    enabled: !!user,
  });
  return { membership, loading, error };
}
