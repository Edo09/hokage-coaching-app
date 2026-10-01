import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useAuth } from "@/src/hooks/use-auth";
import { useWeightUnit } from "@/src/lib/weight-unit";
import { generateWeeklyInsight, type WeeklyInsightStats } from "@/src/services/ai-insight";
import { isAiRetryable } from "@/src/services/llm";
import { useExercises } from "@/src/hooks/use-exercises";
import { useMeals } from "@/src/hooks/use-meals";
import { useProfile } from "@/src/hooks/use-profile";
import { useProgram } from "@/src/hooks/use-program";
import { useProgress } from "@/src/hooks/use-progress";
import { useRoutines } from "@/src/hooks/use-routines";
import type { BodyMeasurement, WorkoutLog } from "@/src/types/database";
import { burnFromMinutes, estimateProgramMinutes, recommendedCalorieGoal } from "@/src/utils/calories";
import { addDays, toDateKey } from "@/src/utils/dates";
import {
  achievements,
  bestMonth,
  buildPlanIndex,
  burnedKcal,
  compliance,
  estimatedVolume,
  lastWeekCompliance,
  mondayOf,
  monthWeekPills,
  muscleAlert,
  muscleDistribution,
  nutritionStats,
  personalRecords,
  programMuscleWeek,
  programWork,
  realVolume,
  realVolumeSeries8w,
  ruleInsights,
  trainedMinutes,
  volumeSeries8w,
  weekDayDots,
  weeklyStreak,
  weightStats,
  type CompletionEntry,
  type Periodo,
  type SetLogEntry,
} from "@/src/utils/progress";
import { supabase } from "@/src/utils/supabase";

// Aggregation layer for the progress dashboard. Deliberately composes the
// existing per-domain hooks instead of running its own Promise.all fetch:
// those hooks apply the offline outbox overlay, so the dashboard reflects
// pending local writes exactly like every other screen. All math lives in
// utils/progress.ts.

const measurementsKey = (userId: string | undefined) =>
  ["body-measurements", userId] as const;

async function fetchMeasurements(userId: string): Promise<BodyMeasurement[]> {
  const cutoff = addDays(toDateKey(), -60);
  const { data, error } = await supabase
    .from("body_measurements")
    .select("*")
    .eq("user_id", userId)
    .gte("measured_on", cutoff)
    .order("measured_on", { ascending: true });
  // P1 table may not exist yet — degrade to the weight card's empty state
  if (error) return [];
  return data as BodyMeasurement[];
}

// New key: the cached shape changed (entries gained programExerciseId and
// week, which programWork() needs to skip completions that already have
// logged sets), and the query cache is persisted on the device — under the
// old key, restored entries without them would count those sets twice.
const setLogsKey = (userId: string | undefined) => ["program-set-logs", userId] as const;

// Logged program sets (last 60d) enriched with the exercise name + laterality,
// so the dashboard can show REAL volume/PRs (Phase 4) instead of plan
// estimates. Sets whose prescription the coach later removed come back
// detached (no program_exercise) and fall back to the snapshot stamped when
// they were logged. Degrades to [] when the tables aren't present yet.
async function fetchSetLogs(userId: string): Promise<SetLogEntry[]> {
  const cutoff = addDays(toDateKey(), -60);
  const { data, error } = await supabase
    .from("workout_set_logs")
    .select(
      "date, weight_kg, reps, exercise_name, is_unilateral, program_exercise_id, week_number, program_exercise:program_exercises(custom_name, is_unilateral, exercise:exercises(name))",
    )
    .eq("user_id", userId)
    .gte("date", cutoff);
  if (error || data == null) return [];
  return (data as unknown[]).map((row) => {
    const r = row as {
      date: string;
      weight_kg: number | null;
      reps: number | null;
      exercise_name: string | null;
      is_unilateral: boolean | null;
      program_exercise_id: string | null;
      week_number: number | null;
      program_exercise: {
        custom_name: string | null;
        is_unilateral: boolean;
        exercise: { name: string } | null;
      } | null;
    };
    return {
      date: r.date,
      weight_kg: r.weight_kg,
      reps: r.reps,
      name:
        r.program_exercise?.exercise?.name ??
        r.program_exercise?.custom_name ??
        r.exercise_name ??
        "—",
      // Laterality at log time, not today's prescription: a coach flipping the
      // flag later must not double (or halve) volume already lifted.
      isUnilateral: r.is_unilateral ?? r.program_exercise?.is_unilateral ?? false,
      programExerciseId: r.program_exercise_id,
      week: r.week_number,
    };
  });
}

// New key: the cached shape changed (dates → entries), and the query cache
// is persisted on the device.
const completionsKey = (userId: string | undefined) =>
  ["program-completions", userId] as const;

// Program exercises the client checked off (last 60d). A coach program
// records completions, not workout_logs, so their dates are what make a
// program day count as a session; with each exercise's prescribed sets for
// that week they also count as muscle work when no sets were logged.
// Degrades to [] if the table is absent.
async function fetchCompletions(userId: string): Promise<CompletionEntry[]> {
  const cutoff = addDays(toDateKey(), -60);
  const { data, error } = await supabase
    .from("program_exercise_completions")
    .select(
      "completed_at, week_number, program_exercise_id, exercise_name, program_exercise:program_exercises(sets, week_overrides, custom_name, exercise:exercises(name), program_day:program_days(program:programs(program_weeks(week_number, sets_override))))",
    )
    .eq("user_id", userId)
    .gte("completed_at", cutoff);
  if (error || data == null) return [];
  return (data as unknown[]).map((row) => {
    const r = row as {
      completed_at: string;
      week_number: number;
      program_exercise_id: string | null;
      exercise_name: string | null;
      program_exercise: {
        sets: number;
        week_overrides: Record<string, { sets?: number }> | null;
        custom_name: string | null;
        exercise: { name: string } | null;
        program_day: {
          program: { program_weeks: { week_number: number; sets_override: number | null }[] } | null;
        } | null;
      } | null;
    };
    const pe = r.program_exercise;
    const weekRow = pe?.program_day?.program?.program_weeks?.find((w) => w.week_number === r.week_number);
    return {
      date: toDateKey(new Date(r.completed_at)),
      week: r.week_number,
      programExerciseId: r.program_exercise_id,
      name: pe?.exercise?.name ?? pe?.custom_name ?? r.exercise_name ?? "—",
      // Same precedence as utils/program.ts effectivePrescription; 3 when the
      // prescription is gone (as muscleDistribution assumes for routines).
      sets: pe?.week_overrides?.[String(r.week_number)]?.sets ?? weekRow?.sets_override ?? pe?.sets ?? 3,
    };
  });
}

export function useProgressDashboard(periodo: Periodo) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const progress = useProgress();
  const routinesData = useRoutines();
  const { exercises, loading: exercisesLoading } = useExercises();
  const mealsData = useMeals();
  const { profile, loading: profileLoading, updateProfile } = useProfile(user?.id);
  // The active coach program (shared, cached query) — for the muscles card's
  // "Esta semana" view: what's assigned this week vs what's done.
  const { program } = useProgram();

  const { data: measurements = [], isPending: measurementsPending } = useQuery({
    queryKey: measurementsKey(user?.id),
    queryFn: () => fetchMeasurements(user!.id),
    enabled: !!user,
  });

  const { data: setLogs = [], isPending: setLogsPending } = useQuery({
    queryKey: setLogsKey(user?.id),
    queryFn: () => fetchSetLogs(user!.id),
    enabled: !!user,
  });

  const { data: completions = [], isPending: completionsPending } = useQuery({
    queryKey: completionsKey(user?.id),
    queryFn: () => fetchCompletions(user!.id),
    enabled: !!user,
  });

  const { logs } = progress;
  const { routines } = routinesData;
  const { meals } = mealsData;

  const loading = progress.loading || routinesData.loading || mealsData.loading;
  const error = progress.error;
  const refreshing = progress.refreshing || mealsData.refreshing;

  const progressRefresh = progress.refresh;
  const mealsRefresh = mealsData.refresh;
  const routinesRefresh = routinesData.refresh;
  // Resolves when everything lands, so a pull's indicator lasts until then.
  const refresh = useCallback(
    () =>
      Promise.all([
        progressRefresh(),
        mealsRefresh(),
        routinesRefresh(),
        queryClient.invalidateQueries({ queryKey: ["body-measurements"] }),
        queryClient.invalidateQueries({ queryKey: ["program-set-logs"] }),
        queryClient.invalidateQueries({ queryKey: ["program-completions"] }),
      ]),
    [progressRefresh, mealsRefresh, routinesRefresh, queryClient],
  );

  /** Quick weight log. Writes profiles.weight_kg through the offline-first
   *  profile upsert; once migration A is applied, a DB trigger mirrors it
   *  into body_measurements. The cache gets the point optimistically so the
   *  chart updates immediately. */
  const logWeight = useCallback(
    async (weightKg: number) => {
      await updateProfile({ weight_kg: weightKg });
      const today = toDateKey();
      queryClient.setQueryData<BodyMeasurement[]>(
        measurementsKey(user?.id),
        (old = []) => {
          const existing = old.find((m) => m.measured_on === today);
          if (existing != null)
            return old.map((m) =>
              m.measured_on === today ? { ...m, weight_kg: weightKg } : m,
            );
          if (old.length === 0) return old; // table absent — stay in empty state
          return [
            ...old,
            {
              id: `local-${today}`,
              user_id: user!.id,
              measured_on: today,
              weight_kg: weightKg,
              body_fat_pct: null,
              waist_cm: null,
              chest_cm: null,
              arm_cm: null,
              thigh_cm: null,
            },
          ];
        },
      );
    },
    [updateProfile, queryClient, user],
  );

  const vm = useMemo(() => {
    const now = new Date();
    const daysPerWeek = Math.max(
      1,
      profile?.days_per_week ?? profile?.available_days?.length ?? 3,
    );
    const plan = buildPlanIndex(routines);
    const today = toDateKey(now);

    // A program day counts as a session: one synthetic session per date the
    // client did program work (checked an exercise or logged a set). Session
    // math uses distinctDays(), which dedups against real logs on shared dates,
    // so merging can't double-count. Only session metrics (ring/dots/streak)
    // read this — muscles, volume, minutes and kcal keep their own sources.
    const programDates = new Set<string>([...completions.map((c) => c.date), ...setLogs.map((s) => s.date)]);
    const sessionLogs: WorkoutLog[] =
      programDates.size === 0
        ? logs
        : [
            ...logs,
            ...[...programDates].map((date) => ({
              id: `prog-${date}`,
              user_id: user?.id ?? "",
              routine_id: null,
              routine_name: "",
              date,
              duration_minutes: null,
              notes: null,
              completed_exercises: null,
              created_at: date,
            })),
          ];

    const periodFrom =
      periodo === "week"
        ? addDays(today, -((now.getDay() + 6) % 7))
        : toDateKey(new Date(now.getFullYear(), now.getMonth(), 1, 12));
    const periodLogs = logs.filter((l) => l.date >= periodFrom && l.date <= today);

    const { done, plan: planCount } = compliance(sessionLogs, daysPerWeek, periodo, now);
    const streak = weeklyStreak(sessionLogs, daysPerWeek, now);
    const dots = weekDayDots(sessionLogs, daysPerWeek, profile?.available_days ?? null, now);
    const pills = monthWeekPills(sessionLogs, daysPerWeek, now);

    const goalKcal = profile?.calorie_goal ?? recommendedCalorieGoal(profile);
    const nutrition = nutritionStats(meals, goalKcal, periodo === "week" ? 7 : 30, now);

    const windowDays = periodo === "week" ? 14 : 30;
    // Program work counts too — for a coach-program client it's the only
    // training data (they have no routine logs).
    const work = programWork(setLogs, completions);
    const muscles = muscleDistribution(logs, exercises, plan, windowDays, now, work);
    const alert = muscleAlert(muscles, logs, exercises, plan, routines, now, work);
    const muscleWeek = program != null ? programMuscleWeek(program, setLogs, completions, now) : null;

    const weekLogs =
      periodo === "week"
        ? periodLogs
        : logs.filter((l) => l.date >= addDays(today, -((now.getDay() + 6) % 7)));
    const series8w = volumeSeries8w(logs, plan, now);
    const lastWeek = lastWeekCompliance(sessionLogs, daysPerWeek, now);
    const weekCompliance = compliance(sessionLogs, daysPerWeek, "week", now);

    const lifetimeVolume = estimatedVolume(logs, plan);
    const totalWorkouts = sessionLogs.length;

    const hasMeals = meals.some((m) => m.meal_items.length > 0);
    const isEmpty = sessionLogs.length === 0 && !hasMeals;

    const weight = weightStats(
      measurements.filter(
        (m): m is BodyMeasurement & { weight_kg: number } => m.weight_kg != null,
      ),
      profile,
      now,
    );
    // Real volume/PRs from logged sets (Phase 4). When the client has logged
    // any sets, these replace the plan-based estimates below.
    const weekMon = addDays(today, -((now.getDay() + 6) % 7));
    const hasRealVolume = setLogs.length > 0;
    const realSeries = realVolumeSeries8w(setLogs, now);
    const deltaOf = (s: number[]) =>
      s[6] > 0 ? Math.round(((s[7] - s[6]) / s[6]) * 100) : null;
    const prs = personalRecords(setLogs);

    const strength = hasRealVolume
      ? {
          weekVolume: realVolume(setLogs, weekMon, today),
          series: realSeries,
          deltaPct: deltaOf(realSeries),
          prs,
          estimated: false,
        }
      : {
          weekVolume: estimatedVolume(weekLogs, plan),
          series: series8w,
          deltaPct: deltaOf(series8w),
          prs: [] as typeof prs,
          estimated: true,
        };
    const periodVolume = hasRealVolume
      ? realVolume(setLogs, periodFrom, today)
      : estimatedVolume(periodLogs, plan);

    // Snapshot for the AI weekly analysis — aggregates only, no raw rows.
    const insightStats: WeeklyInsightStats = {
      goal: profile?.goal ?? null,
      week: { done: weekCompliance.done, plan: weekCompliance.plan },
      lastWeek: { done: lastWeek.done, plan: lastWeek.plan },
      streakWeeks: streak,
      weekVolumeKg: strength.weekVolume,
      volumeDeltaPct: strength.deltaPct,
      volumeIsReal: hasRealVolume,
      topPr: prs[0] != null ? { name: prs[0].name, e1rmKg: prs[0].e1rm } : null,
      avgKcal: nutrition.avgKcal,
      kcalGoal: goalKcal,
      avgProteinG: nutrition.avgProtein,
      // Same 1.4 g/kg heuristic the rule-based insight uses.
      proteinTargetG:
        profile?.weight_kg != null ? Math.round(1.4 * profile.weight_kg) : null,
      weightKg: weight.current,
      weightDelta30dKg: weight.delta30,
      muscleSets: muscles.map((m) => ({ group: m.group, sets: m.sets })),
      neglected: alert != null ? { group: alert.group, days: alert.days } : null,
    };

    // Estimated active minutes/kcal from program check-offs in the period —
    // per day (exercise count → capped minutes) so a busy day can't exceed one
    // session, summed. Programs log no duration, so this is the only time/kcal
    // source now that manual workout logging is gone.
    const programExByDay = new Map<string, number>();
    for (const { date: d } of completions) {
      if (d >= periodFrom && d <= today) programExByDay.set(d, (programExByDay.get(d) ?? 0) + 1);
    }
    let programMinutes = 0;
    for (const cnt of programExByDay.values()) programMinutes += estimateProgramMinutes(cnt, profile);
    const programKcal = burnFromMinutes(programMinutes, profile);

    return {
      isEmpty,
      daysPerWeek,
      hero: {
        done,
        plan: planCount,
        streak,
        dots,
        pills,
        best: bestMonth(sessionLogs, now),
        minutes: trainedMinutes(periodLogs, profile) + Math.round(programMinutes),
        kcal: burnedKcal(periodLogs, profile) + programKcal,
        volumeKg: periodVolume,
      },
      weight,
      strength,
      nutrition: { ...nutrition, goal: goalKcal, hasData: hasMeals },
      insightStats,
      muscles: { rows: muscles, alert, week: muscleWeek },
      insight: ruleInsights({
        alert,
        avgProtein: nutrition.avgProtein,
        weightKg: profile?.weight_kg ?? null,
        lastWeekDone: lastWeek.done,
        lastWeekPlan: lastWeek.plan,
        weekDone: weekCompliance.done,
        weekPlan: weekCompliance.plan,
      }),
      logros: achievements(totalWorkouts, streak, lifetimeVolume),
    };
  }, [logs, routines, exercises, meals, profile, measurements, setLogs, completions, program, user?.id, periodo]);

  // AI weekly analysis (P3). Keyed per user+week+language: generated once
  // per Monday-based week, regenerated on language switch, served from the
  // persisted react-query cache otherwise (works offline once fetched).
  // Failure/offline is fine — the UI falls back to the rule-based insight.
  const { i18n } = useTranslation();
  const weightUnit = useWeightUnit();
  const { data: aiInsight = null } = useQuery({
    queryKey: ["ai-insight", user?.id, mondayOf(toDateKey()), i18n.language, weightUnit],
    queryFn: () => generateWeeklyInsight(vm.insightStats, i18n.language, weightUnit),
    // Wait for everything the stats read: the snapshot is cached for the
    // whole week, so generating early would freeze a wrong one (a program
    // client's sessions, volume and muscles come only from set logs and
    // completions; muscleSets goes through the exercise catalog; goal and
    // weight through the profile and measurements).
    enabled:
      !!user &&
      !loading &&
      !exercisesLoading &&
      !profileLoading &&
      !measurementsPending &&
      !setLogsPending &&
      !completionsPending &&
      !vm.isEmpty,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24 * 21,
    // Once, and not when the quota is spent or the AI isn't deployed: the
    // retry would fail the same way.
    retry: (failureCount, e) => failureCount < 1 && isAiRetryable(e),
  });

  return {
    ...vm,
    aiInsight,
    logs,
    profile,
    loading,
    error,
    refreshing,
    refresh,
    createLog: progress.createLog,
    deleteLog: progress.deleteLog,
    logWeight,
  };
}

export type ProgressDashboard = ReturnType<typeof useProgressDashboard>;
