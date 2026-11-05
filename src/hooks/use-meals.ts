import { useAuth } from "@/src/hooks/use-auth";
import { overlayMeals } from "@/src/lib/outbox-overlay";
import { getPendingPhotoOps } from "@/src/lib/photo-queue";
import { qk } from "@/src/lib/query-keys";
import type { MealWithItems } from "@/src/types/database";
import { supabase } from "@/src/utils/supabase";
import { useQuery } from "@tanstack/react-query";

// Items ride along with the list so the client's meal rows (registrations,
// and the diary rows from before them) are one persisted query that works
// offline. Writes go through use-meal-registrations.ts.
async function fetchMeals(userId: string): Promise<MealWithItems[]> {
  // Explicit user filter on top of RLS: the coach role can read every
  // client's rows, so without it a coach signing into the app would see
  // all clients' data merged into their own.
  const { data, error } = await supabase
    .from("meals")
    .select("*, meal_items(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return overlayMeals(userId, data as MealWithItems[], await getPendingPhotoOps(userId));
}

export function useMeals() {
  const { user } = useAuth();

  const {
    data: meals = [],
    isPending: loading,
    isError: error,
    isRefetching: refreshing,
    refetch,
  } = useQuery({
    queryKey: qk.meals(user?.id),
    queryFn: () => fetchMeals(user!.id),
    enabled: !!user,
  });

  return { meals, loading, error, refreshing, refresh: refetch };
}
