import { getPendingOps } from "@/src/lib/outbox";
import type {
  Exercise,
  Meal,
  MealItem,
  MealWithItems,
  Profile,
  ProgramExerciseCompletion,
  Routine,
  RoutineExercise,
  RoutineWithExercises,
  WorkoutLog,
  WorkoutSetLog,
} from "@/src/types/database";

// Re-applies pending outbox ops onto freshly fetched rows. Without this, a
// refetch that lands while ops are still queued (reconnect triggers refetch
// and flush concurrently) would make optimistic items vanish until the next
// flush completes.

export async function overlayMeals(
  userId: string,
  rows: MealWithItems[],
): Promise<MealWithItems[]> {
  const ops = await getPendingOps(userId);
  let out = rows.map((r) => ({ ...r, meal_items: [...(r.meal_items ?? [])] }));
  for (const op of ops) {
    if (op.table === "meals") {
      if (op.kind === "delete") {
        out = out.filter((m) => m.id !== op.payload.id);
      } else if (!out.some((m) => m.id === op.payload.id)) {
        out.push({ ...(op.payload as Meal), meal_items: [] });
      }
    } else if (op.table === "meal_items") {
      if (op.kind === "delete") {
        for (const m of out) {
          m.meal_items = m.meal_items.filter((i) => i.id !== op.payload.id);
        }
      } else {
        const item = op.payload as MealItem;
        // Upserts can edit values in place or move the item to another meal.
        // Drop any server copy first so the pending row always wins — leaving
        // it would show stale values (edit) or a duplicate (move).
        for (const m of out) {
          m.meal_items = m.meal_items.filter((i) => i.id !== item.id);
        }
        const parent = out.find((m) => m.id === item.meal_id);
        if (parent) parent.meal_items.push(item);
      }
    }
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function overlayRoutines(
  userId: string,
  rows: RoutineWithExercises[],
  exercisesById: Map<string, Exercise>,
): Promise<RoutineWithExercises[]> {
  const ops = await getPendingOps(userId);
  let out = rows.map((r) => ({
    ...r,
    routine_exercises: [...(r.routine_exercises ?? [])],
  }));
  for (const op of ops) {
    if (op.table === "routines") {
      if (op.kind === "delete") {
        out = out.filter((r) => r.id !== op.payload.id);
      } else if (!out.some((r) => r.id === op.payload.id)) {
        out.push({ ...(op.payload as Routine), routine_exercises: [] });
      }
    } else if (op.table === "routine_exercises") {
      if (op.kind === "delete") {
        for (const r of out) {
          r.routine_exercises = r.routine_exercises.filter(
            (ex) => ex.id !== op.payload.id,
          );
        }
      } else {
        // op.payload is the real DB row (no embedded `exercise` — see
        // use-routines.ts's dbRow/cacheRow split). Re-attach it from the
        // catalog cache so the reconstructed row can still render. This can
        // legitimately miss (catalog not yet fetched, or entry since
        // removed) — callers must not assume `.exercise` is always present
        // on a row that came through this path.
        const dbRow = op.payload as Omit<RoutineExercise, "exercise">;
        const exercise: RoutineExercise = {
          ...dbRow,
          exercise: exercisesById.get(dbRow.exercise_id),
        };
        const parent = out.find((r) => r.id === exercise.routine_id);
        if (
          parent &&
          !parent.routine_exercises.some((ex) => ex.id === exercise.id)
        ) {
          parent.routine_exercises.push(exercise);
        }
      }
    }
  }
  for (const r of out) {
    r.routine_exercises.sort((a, b) => a.sort_order - b.sort_order);
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function overlayLogs(
  userId: string,
  rows: WorkoutLog[],
): Promise<WorkoutLog[]> {
  const ops = await getPendingOps(userId);
  let out = [...rows];
  for (const op of ops) {
    if (op.table !== "workout_logs") continue;
    if (op.kind === "delete") {
      out = out.filter((l) => l.id !== op.payload.id);
    } else if (!out.some((l) => l.id === op.payload.id)) {
      out.push(op.payload as WorkoutLog);
    }
  }
  return out.sort(
    (a, b) =>
      b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at),
  );
}

// Scoped to exIds like the fetch it follows: a pending row for an exercise
// outside the active program (reassigned or since removed by the coach) must
// not surface — the home screen counts completions without re-filtering.
export async function overlayProgramLog(
  userId: string,
  rows: {
    completions: ProgramExerciseCompletion[];
    setLogs: WorkoutSetLog[];
  },
  exIds: string[],
): Promise<{
  completions: ProgramExerciseCompletion[];
  setLogs: WorkoutSetLog[];
}> {
  const ops = await getPendingOps(userId);
  const inScope = new Set(exIds);
  let completions = [...rows.completions];
  let setLogs = [...rows.setLogs];
  for (const op of ops) {
    if (op.table === "program_exercise_completions") {
      if (op.kind === "delete") {
        completions = completions.filter((c) => c.id !== op.payload.id);
      } else {
        const row = op.payload as ProgramExerciseCompletion;
        if (
          row.program_exercise_id != null &&
          inScope.has(row.program_exercise_id) &&
          !completions.some((c) => c.id === row.id)
        ) {
          completions.push(row);
        }
      }
    } else if (op.table === "workout_set_logs") {
      if (op.kind === "delete") {
        setLogs = setLogs.filter((s) => s.id !== op.payload.id);
      } else {
        const row = op.payload as WorkoutSetLog;
        // Upserts edit a set's values in place; drop the server copy so the
        // pending row always wins over the stale one.
        setLogs = setLogs.filter((s) => s.id !== row.id);
        if (
          row.program_exercise_id != null &&
          inScope.has(row.program_exercise_id)
        ) {
          setLogs.push(row);
        }
      }
    }
  }
  return { completions, setLogs };
}

export async function overlayProfile(
  userId: string,
  row: Profile | null,
): Promise<Profile | null> {
  const ops = await getPendingOps(userId);
  let out = row;
  for (const op of ops) {
    if (op.table !== "profiles" || op.payload.id !== userId) continue;
    out = { ...(out ?? emptyProfile(userId)), ...(op.payload as Partial<Profile>) };
  }
  return out;
}

// Base for a profile that only exists as a pending upsert (offline onboarding)
export function emptyProfile(userId: string): Profile {
  const now = new Date().toISOString();
  return {
    id: userId,
    // Synced from auth.users server-side; never written by the client.
    email: null,
    display_name: null,
    avatar_url: null,
    age: null,
    sex: null,
    height_cm: null,
    weight_kg: null,
    activity_level: null,
    profession_type: null,
    days_per_week: null,
    session_duration: null,
    available_days: null,
    calorie_goal: null,
    goal: null,
    role: "user",
    whatsapp: null,
    onboarding_completed: false,
    created_at: now,
    updated_at: now,
  };
}
