import { useQuery } from "@tanstack/react-query";

import { qk } from "@/src/lib/query-keys";
import type { Exercise } from "@/src/types/database";
import { supabase } from "@/src/utils/supabase";

// Shared, coach-managed catalog (Admin Web Panel CRUDs it; RLS lets any
// authenticated user read it). Select shape must match the embed used in
// use-routines.ts's fetchRoutines so optimistic and server-fetched rows agree.
// PostgREST returns at most 1000 rows per request (the project's max_rows)
// and the catalog is past that, so it's read in pages.
const PAGE = 1000;

async function fetchExercises(): Promise<Exercise[]> {
  const all: Exercise[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("exercises")
      .select("*, body_part:bodyparts(name)")
      .order("name")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...(data as Exercise[]));
    if (data.length < PAGE) return all;
  }
}

export function useExercises() {
  const { data: exercises = [], isPending: loading } = useQuery({
    queryKey: qk.exercises(),
    queryFn: fetchExercises,
  });
  return { exercises, loading };
}
