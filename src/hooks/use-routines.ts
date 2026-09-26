import { useAuth } from "@/src/hooks/use-auth";
import { overlayRoutines } from "@/src/lib/outbox-overlay";
import { qk } from "@/src/lib/query-keys";
import type { Exercise, RoutineWithExercises } from "@/src/types/database";
import { supabase } from "@/src/utils/supabase";
import { useQuery, useQueryClient } from "@tanstack/react-query";

function exercisesById(list: Exercise[] | undefined): Map<string, Exercise> {
  return new Map((list ?? []).map((e) => [e.id, e]));
}

// Legacy flat routines (the coach app now delivers programs). Read-only: the
// progress dashboard still reads them to estimate volume for clients whose
// history predates programs. Exercises ride along in the same persisted query.
async function fetchRoutines(
  userId: string,
  catalog: Map<string, Exercise>,
): Promise<RoutineWithExercises[]> {
  // Explicit user filter on top of RLS: the coach role can read every
  // client's rows — without it a coach signing into the app would see all
  // clients' routines as their own.
  const { data, error } = await supabase
    .from("routines")
    .select("*, routine_exercises(*, exercise:exercises(*, body_part:bodyparts(name)))")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("sort_order", {
      referencedTable: "routine_exercises",
      ascending: true,
    });
  if (error) throw error;
  return overlayRoutines(userId, data as RoutineWithExercises[], catalog);
}

export function useRoutines() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const listKey = qk.routines(user?.id);

  const {
    data: routines = [],
    isPending: loading,
    isError: error,
    isRefetching: refreshing,
    refetch,
  } = useQuery({
    queryKey: listKey,
    queryFn: () =>
      fetchRoutines(
        user!.id,
        exercisesById(queryClient.getQueryData<Exercise[]>(qk.exercises())),
      ),
    enabled: !!user,
  });

  return { routines, loading, error, refreshing, refresh: refetch };
}
