import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/src/hooks/use-auth";
import { qk } from "@/src/lib/query-keys";
import type { SupplementPlanWithDetails } from "@/src/types/database";
import { supabase } from "@/src/utils/supabase";

// The client's active supplement stack. Assigned INDEPENDENTLY of the nutrition
// plan, so this has its own query and its own empty state — a client may have a
// diet with no stack, a stack with no diet, both, or neither.
async function fetchActivePlan(
  userId: string,
): Promise<SupplementPlanWithDetails | null> {
  const { data, error } = await supabase
    .from("supplement_plans")
    .select("*, supplement_plan_items(*)")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("start_date", { ascending: false })
    .order("sort_order", {
      referencedTable: "supplement_plan_items",
      ascending: true,
    })
    .limit(1)
    .maybeSingle();
  if (error) {
    // Pre-migration database — degrade to "no plan" rather than throwing.
    if (error.code === "42P01") return null;
    throw error;
  }
  return (data as SupplementPlanWithDetails | null) ?? null;
}

export function useSupplementPlan() {
  const { user } = useAuth();

  const {
    data: plan = null,
    isPending: loading,
    isError: error,
    isRefetching: refreshing,
    refetch,
  } = useQuery({
    queryKey: qk.supplementPlan(user?.id),
    queryFn: () => fetchActivePlan(user!.id),
    enabled: !!user,
  });

  return { plan, loading, error, refreshing, refresh: refetch };
}
