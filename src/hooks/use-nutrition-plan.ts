import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/src/hooks/use-auth";
import { useProgram } from "@/src/hooks/use-program";
import { useRealtimeInvalidate } from "@/src/hooks/use-realtime-invalidate";
import { setDayOverride, useDayOverride } from "@/src/lib/day-override";
import { qk } from "@/src/lib/query-keys";
import { useToday } from "@/src/lib/today";
import type { NutritionPlanWithDetails } from "@/src/types/database";
import { toDateKey } from "@/src/utils/dates";
import { supabase } from "@/src/utils/supabase";
import { resolveDayType, type ResolvedDay } from "@/src/utils/nutrition-plan";

// The client's active coach nutrition plan, fully nested (slots -> rotation
// options -> foods, plus the macro target table). Read-only: RLS ("client reads
// own …") scopes it, and the explicit user filter is defensive (the coach role
// can read every client's rows). Persisted like every other query, so the plan
// renders offline once fetched.
async function fetchActivePlan(
  userId: string,
): Promise<NutritionPlanWithDetails | null> {
  const { data, error } = await supabase
    .from("nutrition_plans")
    .select(
      "*, nutrition_plan_targets(*), nutrition_plan_meals(*, nutrition_plan_options(*, nutrition_plan_option_items(*)))",
    )
    .eq("user_id", userId)
    .eq("status", "active")
    .order("start_date", { ascending: false })
    .order("slot_index", {
      referencedTable: "nutrition_plan_meals",
      ascending: true,
    })
    .limit(1)
    .maybeSingle();
  if (error) {
    // Table may not exist yet on a database that hasn't run the migration —
    // degrade to "no plan" instead of throwing the whole Nutrición tab.
    if (error.code === "42P01") return null;
    throw error;
  }
  if (data == null) return null;

  const plan = data as NutritionPlanWithDetails;
  // PostgREST can't order past one referenced table — sort the two tiers below
  // the slots client-side.
  plan.nutrition_plan_meals.sort(
    (a, b) => a.sort_order - b.sort_order || a.slot_index - b.slot_index,
  );
  plan.nutrition_plan_meals.forEach((meal) => {
    meal.nutrition_plan_options.sort((a, b) => a.sort_order - b.sort_order);
    meal.nutrition_plan_options.forEach((opt) =>
      opt.nutrition_plan_option_items.sort((a, b) => a.sort_order - b.sort_order),
    );
  });
  return plan;
}

export function useNutritionPlan() {
  const { user } = useAuth();
  // The training calendar drives the day type — the client shouldn't have to
  // tell the app something it already knows from their program.
  const { program } = useProgram();

  const {
    data: plan = null,
    isPending: loading,
    isError: error,
    isRefetching: refreshing,
    refetch,
  } = useQuery({
    queryKey: qk.nutritionPlan(user?.id),
    queryFn: () => fetchActivePlan(user!.id),
    enabled: !!user,
  });

  useRealtimeInvalidate(
    "nutrition_plans",
    user ? `user_id=eq.${user.id}` : undefined,
    qk.nutritionPlan(user?.id),
  );

  // Follows the day: useToday re-renders at midnight and on foreground.
  const todayKey = toDateKey(useToday());
  const autoDay = resolveDayType(program, todayKey);

  // Manual override for the days a client trains off-schedule; null = follow
  // the program. It lasts for today and is shared with Inicio.
  const override = useDayOverride(user?.id, todayKey);
  const day: ResolvedDay = override ?? autoDay;
  const setViewDay = (next: ResolvedDay | null) => {
    if (user) void setDayOverride(user.id, todayKey, next == null || next === autoDay ? null : next);
  };

  return {
    plan,
    loading,
    error,
    refreshing,
    refresh: refetch,
    /** Today's date key, day-reactive. */
    todayKey,
    /** What the program says today is. */
    autoDay,
    /** What the screen is actually showing. */
    day,
    setViewDay,
    /** True when the client is looking at something other than today's type. */
    overridden: override != null && override !== autoDay,
  };
}
