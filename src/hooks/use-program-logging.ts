import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useAuth } from "@/src/hooks/use-auth";
import { newId } from "@/src/lib/ids";
import { enqueue } from "@/src/lib/outbox";
import { qk } from "@/src/lib/query-keys";
import { useCelebration } from "@/src/providers/celebration-context";
import type {
  ProgramDayWithExercises,
  ProgramExerciseCompletion,
  ProgramWithDetails,
  WorkoutSetLog,
} from "@/src/types/database";
import { toDateKey } from "@/src/utils/dates";
import { supabase } from "@/src/utils/supabase";

// Phase 3: the client's completion checks + logged sets against a program.
// Offline-first via the outbox (same pattern as routines/meals). Kept in one
// cache entry keyed per user; scoped to the active program's exercise ids.

type LogData = {
  completions: ProgramExerciseCompletion[];
  setLogs: WorkoutSetLog[];
};

const EMPTY: LogData = { completions: [], setLogs: [] };

function allExerciseIds(program: ProgramWithDetails | null): string[] {
  if (program == null) return [];
  return program.program_days.flatMap((d) =>
    d.program_exercises.map((e) => e.id),
  );
}

async function fetchLog(userId: string, exIds: string[]): Promise<LogData> {
  if (exIds.length === 0) return EMPTY;
  const [completions, setLogs] = await Promise.all([
    supabase
      .from("program_exercise_completions")
      .select("*")
      .eq("user_id", userId)
      .in("program_exercise_id", exIds),
    supabase
      .from("workout_set_logs")
      .select("*")
      .eq("user_id", userId)
      .in("program_exercise_id", exIds),
  ]);
  // Missing tables (migration not applied) degrade to empty, never throw.
  const c = completions.error ? [] : (completions.data as ProgramExerciseCompletion[]);
  const s = setLogs.error ? [] : (setLogs.data as WorkoutSetLog[]);
  return { completions: c, setLogs: s };
}

export type SetInput = {
  weight_kg?: number | null;
  reps?: number | null;
  rir?: number | null;
};

export function useProgramLogging(program: ProgramWithDetails | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const celebration = useCelebration();
  const key = qk.programLog(user?.id);
  const exIds = useMemo(() => allExerciseIds(program), [program]);

  const { data = EMPTY } = useQuery({
    queryKey: key,
    queryFn: () => fetchLog(user!.id, exIds),
    enabled: !!user && exIds.length > 0,
  });

  const setCache = useCallback(
    (updater: (prev: LogData) => LogData) =>
      queryClient.setQueryData<LogData>(key, (old = EMPTY) => updater(old)),
    [queryClient, key],
  );

  // ---- completion checkbox --------------------------------------------------
  const completionOf = useCallback(
    (exerciseId: string, week: number) =>
      data.completions.find(
        (c) => c.program_exercise_id === exerciseId && c.week_number === week,
      ) ?? null,
    [data.completions],
  );

  /** Check or uncheck one exercise. A check-off that finishes its whole day
      for the week sets off the day-complete celebration. */
  const setCompletion = useCallback(
    async (exerciseId: string, week: number, done: boolean) => {
      const existing = completionOf(exerciseId, week);
      if (done && existing == null) {
        const row: ProgramExerciseCompletion = {
          id: newId(),
          user_id: user!.id,
          program_exercise_id: exerciseId,
          week_number: week,
          completed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        };
        setCache((prev) => ({ ...prev, completions: [...prev.completions, row] }));
        // Read back the cache, not `data`: setDayCompletion calls this in a
        // loop with one stale closure, and only the fresh cache knows the
        // earlier iterations landed.
        const day = program?.program_days.find((d) =>
          d.program_exercises.some((e) => e.id === exerciseId),
        );
        if (program != null && day != null) {
          const fresh = queryClient.getQueryData<LogData>(key) ?? EMPTY;
          const dayDone = day.program_exercises.every((e) =>
            fresh.completions.some((c) => c.program_exercise_id === e.id && c.week_number === week),
          );
          if (dayDone) celebration?.celebrateDay({ program, dayId: day.id, week });
        }
        await enqueue({
          userId: user!.id,
          table: "program_exercise_completions",
          kind: "insert",
          payload: row,
        });
      } else if (!done && existing != null) {
        setCache((prev) => ({
          ...prev,
          completions: prev.completions.filter((c) => c.id !== existing.id),
        }));
        await enqueue({
          userId: user!.id,
          table: "program_exercise_completions",
          kind: "delete",
          payload: { id: existing.id },
        });
      }
    },
    [completionOf, setCache, user, program, queryClient, key, celebration],
  );

  const isDone = useCallback(
    (exerciseId: string, week: number) => completionOf(exerciseId, week) != null,
    [completionOf],
  );

  /** Whether checking this exercise off now would finish its day for the
      week — known before the write, so a sheet can close ahead of the
      celebration instead of stacking under it. */
  const completesDay = useCallback(
    (exerciseId: string, week: number) => {
      if (isDone(exerciseId, week)) return false;
      const day = program?.program_days.find((d) =>
        d.program_exercises.some((e) => e.id === exerciseId),
      );
      return (
        day != null &&
        day.program_exercises.every((e) => e.id === exerciseId || isDone(e.id, week))
      );
    },
    [isDone, program],
  );

  const dayProgress = useCallback(
    (day: ProgramDayWithExercises, week: number) => {
      const total = day.program_exercises.length;
      const done = day.program_exercises.filter((e) => isDone(e.id, week)).length;
      return { done, total };
    },
    [isDone],
  );

  /** Check or uncheck every exercise in a day for the week. */
  const setDayCompletion = useCallback(
    async (day: ProgramDayWithExercises, week: number, done: boolean) => {
      for (const ex of day.program_exercises) {
        await setCompletion(ex.id, week, done);
      }
    },
    [setCompletion],
  );

  // ---- per-set logging ------------------------------------------------------
  const setsFor = useCallback(
    (exerciseId: string, week: number) =>
      data.setLogs
        .filter(
          (s) => s.program_exercise_id === exerciseId && s.week_number === week,
        )
        .sort((a, b) => a.set_index - b.set_index),
    [data.setLogs],
  );

  /** The most recent EARLIER week this exercise has logged sets for — what the
      client beat (or not) last time, for double progression. Null in week 1
      or when nothing was logged before. */
  const previousSetsFor = useCallback(
    (exerciseId: string, week: number) => {
      const earlier = data.setLogs.filter(
        (s) => s.program_exercise_id === exerciseId && s.week_number < week,
      );
      if (earlier.length === 0) return null;
      const last = Math.max(...earlier.map((s) => s.week_number));
      return {
        week: last,
        sets: earlier
          .filter((s) => s.week_number === last)
          .sort((a, b) => a.set_index - b.set_index),
      };
    },
    [data.setLogs],
  );

  /** Upsert one set's actuals. Logging any set does not auto-complete the
      exercise — the checkbox stays the explicit "done" signal (the decided
      "checkbox + optional sets" model). */
  const logSet = useCallback(
    async (
      exerciseId: string,
      week: number,
      setIndex: number,
      input: SetInput,
    ) => {
      const existing = setsFor(exerciseId, week).find(
        (s) => s.set_index === setIndex,
      );
      const row: WorkoutSetLog = {
        id: existing?.id ?? newId(),
        user_id: user!.id,
        program_exercise_id: exerciseId,
        week_number: week,
        date: toDateKey(),
        set_index: setIndex,
        weight_kg: input.weight_kg ?? null,
        reps: input.reps ?? null,
        rir: input.rir ?? null,
        created_at: existing?.created_at ?? new Date().toISOString(),
      };
      setCache((prev) => ({
        ...prev,
        setLogs:
          existing != null
            ? prev.setLogs.map((s) => (s.id === row.id ? row : s))
            : [...prev.setLogs, row],
      }));
      await enqueue({
        userId: user!.id,
        table: "workout_set_logs",
        kind: "upsert",
        payload: row,
      });
    },
    [setsFor, setCache, user],
  );

  const deleteSet = useCallback(
    async (id: string) => {
      setCache((prev) => ({
        ...prev,
        setLogs: prev.setLogs.filter((s) => s.id !== id),
      }));
      await enqueue({
        userId: user!.id,
        table: "workout_set_logs",
        kind: "delete",
        payload: { id },
      });
    },
    [setCache, user],
  );

  return {
    completions: data.completions,
    setLogs: data.setLogs,
    isDone,
    completesDay,
    setCompletion,
    dayProgress,
    setDayCompletion,
    setsFor,
    previousSetsFor,
    logSet,
    deleteSet,
  };
}
