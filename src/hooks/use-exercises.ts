import { useQuery } from "@tanstack/react-query";

import { qk } from "@/src/lib/query-keys";
import type { CatalogExercise } from "@/src/types/database";
import { supabase } from "@/src/utils/supabase";

// Shared, coach-managed catalog (Admin Web Panel CRUDs it; RLS lets any
// authenticated user read it). The progress stats read it for each exercise's
// body part, and routine rows rebuilt offline take their exercise from it.
// Without the instructions (en + es): they were most of its size, and this
// query is persisted with the rest of the cache, so all of it was rewritten
// after every refetch and read back at every cold start.
// PostgREST returns at most 1000 rows per request (the project's max_rows)
// and the catalog is past that, so it's read in pages.
const PAGE = 1000;
const COLUMNS = "id, name, video_url, body_part_id, body_part:bodyparts(name)";

async function fetchExercises(): Promise<CatalogExercise[]> {
  const all: CatalogExercise[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("exercises")
      .select(COLUMNS)
      .order("name")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    // supabase-js types the to-one body_part embed as an array; PostgREST
    // sends the object.
    all.push(...(data as unknown as CatalogExercise[]));
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
