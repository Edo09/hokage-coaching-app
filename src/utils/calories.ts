import type { MealWithItems, Profile, WorkoutLog } from "@/src/types/database";

// Daily-calorie math shared by the dashboard KPIs and the profile screen.

const ACTIVITY_FACTOR: Record<NonNullable<Profile["activity_level"]>, number> = {
  sedentary: 1.2,
  active: 1.55,
  very_active: 1.725,
};

// Strength training ≈ MET 5.0; kcal/min = MET × 3.5 × kg / 200
const WORKOUT_MET = 5.0;
const DEFAULT_WEIGHT_KG = 70;

// Deficit for lose_weight, surplus for gain_muscle, unchanged for maintain
// (or when no goal is set — the recommendation defaults to maintenance).
const GOAL_FACTOR: Record<NonNullable<Profile["goal"]>, number> = {
  lose_weight: 0.85,
  gain_muscle: 1.1,
  maintain: 1,
};

type RecommendInput = Pick<
  Profile,
  "age" | "sex" | "height_cm" | "weight_kg" | "activity_level" | "goal"
>;

/**
 * Calorie recommendation from the Mifflin-St Jeor BMR equation, scaled by
 * activity level for maintenance, then adjusted for the user's goal (deficit
 * for lose_weight, surplus for gain_muscle). Null until the profile has the
 * required fields.
 */
export function recommendedCalorieGoal(
  profile: RecommendInput | null,
): number | null {
  if (
    profile == null ||
    profile.age == null ||
    profile.sex == null ||
    profile.height_cm == null ||
    profile.weight_kg == null
  ) {
    return null;
  }
  const base =
    10 * profile.weight_kg + 6.25 * profile.height_cm - 5 * profile.age;
  // "other" uses the midpoint of the male (+5) and female (−161) constants
  const sexConstant =
    profile.sex === "male" ? 5 : profile.sex === "female" ? -161 : -78;
  const factor = ACTIVITY_FACTOR[profile.activity_level ?? "sedentary"];
  const maintenance = (base + sexConstant) * factor;
  const goal = maintenance * GOAL_FACTOR[profile.goal ?? "maintain"];
  return Math.max(0, Math.round(goal / 50) * 50);
}

/** Estimated kcal burned by one workout log (duration × MET × body weight). */
export function estimateCaloriesBurned(
  log: WorkoutLog,
  profile: Pick<Profile, "weight_kg" | "session_duration"> | null,
): number {
  // Logs without a duration fall back to the user's usual session length
  const minutes = log.duration_minutes ?? profile?.session_duration ?? 0;
  const weight = profile?.weight_kg ?? DEFAULT_WEIGHT_KG;
  return Math.round(((WORKOUT_MET * 3.5 * weight) / 200) * minutes);
}

// Coach programs record no session duration (the client just checks exercises
// off), so burned kcal is ESTIMATED from work done: each completed exercise ≈ a
// few active minutes, capped at the coach-set session length so one day never
// exceeds a normal session.
const PROGRAM_MIN_PER_EXERCISE = 4.5;
const PROGRAM_SESSION_CAP_MIN = 90; // fallback cap when no session_duration set

/** Estimated active minutes from N program exercises checked off in ONE day. */
export function estimateProgramMinutes(
  exercisesDone: number,
  profile: Pick<Profile, "session_duration"> | null,
): number {
  if (exercisesDone <= 0) return 0;
  const cap = profile?.session_duration ?? PROGRAM_SESSION_CAP_MIN;
  return Math.min(exercisesDone * PROGRAM_MIN_PER_EXERCISE, cap);
}

/** kcal for a given number of active minutes (same MET formula as logs). */
export function burnFromMinutes(
  minutes: number,
  profile: Pick<Profile, "weight_kg"> | null,
): number {
  const weight = profile?.weight_kg ?? DEFAULT_WEIGHT_KG;
  return Math.round(((WORKOUT_MET * 3.5 * weight) / 200) * minutes);
}

/** Estimated kcal burned from N program exercises checked off in ONE day. */
export function estimateProgramBurn(
  exercisesDone: number,
  profile: Pick<Profile, "weight_kg" | "session_duration"> | null,
): number {
  return burnFromMinutes(estimateProgramMinutes(exercisesDone, profile), profile);
}

/** Total kcal across the given meals' items. */
export function caloriesConsumed(meals: MealWithItems[]): number {
  return meals.reduce(
    (total, meal) =>
      total + meal.meal_items.reduce((sum, item) => sum + item.calories, 0),
    0,
  );
}
