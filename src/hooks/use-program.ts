import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useAuth } from "@/src/hooks/use-auth";
import { useRealtimeInvalidate } from "@/src/hooks/use-realtime-invalidate";
import { qk } from "@/src/lib/query-keys";
import { useToday } from "@/src/lib/today";
import type { ProgramWithDetails } from "@/src/types/database";
import { supabase } from "@/src/utils/supabase";
import {
  currentWeekOf,
  isAfterEnd,
  isBeforeStart,
  weekByNumber,
} from "@/src/utils/program";

// The client's active coach program, fully nested (days → exercises → catalog
// entry, plus the weekly periodization table). Read-only: RLS ("client reads
// own …") scopes it, and the explicit user filter is defensive (the coach role
// can read every client's rows). Persisted like every other query, so the
// program renders offline once fetched.
async function fetchActiveProgram(
  userId: string,
): Promise<ProgramWithDetails | null> {
  const { data, error } = await supabase
    .from("programs")
    .select(
      "*, program_weeks(*), program_days(*, program_exercises(*, exercise:exercises(*, body_part:bodyparts(name))))",
    )
    .eq("user_id", userId)
    .eq("status", "active")
    .order("start_date", { ascending: false })
    .order("day_index", { referencedTable: "program_days", ascending: true })
    .order("week_number", { referencedTable: "program_weeks", ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    // Table may not exist yet on a database that hasn't run the migration —
    // degrade to "no program" instead of throwing the whole Coach tab.
    if (error.code === "42P01") return null;
    throw error;
  }
  if (data == null) return null;

  const program = data as ProgramWithDetails;
  // PostgREST can't order two levels deep — sort the exercises client-side.
  program.program_days.forEach((day) =>
    day.program_exercises.sort((a, b) => a.sort_order - b.sort_order),
  );
  program.program_days.sort((a, b) => a.sort_order - b.sort_order);
  return program;
}

export function useProgram() {
  const { user } = useAuth();

  const {
    data: program = null,
    isPending: loading,
    isError: error,
    isRefetching: refreshing,
    refetch,
  } = useQuery({
    queryKey: qk.program(user?.id),
    queryFn: () => fetchActiveProgram(user!.id),
    enabled: !!user,
  });

  // A coach saving in the panel touches the parent row, which pushes an event
  // here and refetches the graph — no pull-to-refresh needed (and mobile web
  // has none to offer).
  useRealtimeInvalidate(
    "programs",
    user ? `user_id=eq.${user.id}` : undefined,
    qk.program(user?.id),
  );

  // Keyed on today as well as the program: the week turns over at local
  // midnight (or while the app sat in the background), not only when the
  // program happens to refetch.
  const today = useToday();
  const autoWeek = useMemo(
    () =>
      program != null
        ? currentWeekOf(program.start_date, program.duration_weeks, today)
        : 1,
    [program, today],
  );

  // Manual override for previewing other weeks; null = follow the auto week.
  const [viewWeek, setViewWeek] = useState<number | null>(null);
  const selectedWeek = viewWeek ?? autoWeek;

  const week = useMemo(
    () => (program != null ? weekByNumber(program, selectedWeek) : null),
    [program, selectedWeek],
  );

  const notStarted = program != null && isBeforeStart(program.start_date, today);
  // Done when the coach marked it, or the calendar has run past the final week.
  const completed =
    program != null &&
    (program.status === "completed" ||
      isAfterEnd(program.start_date, program.duration_weeks, today));

  return {
    program,
    loading,
    error,
    refreshing,
    refresh: refetch,
    autoWeek,
    selectedWeek,
    setViewWeek,
    week,
    notStarted,
    completed,
  };
}
