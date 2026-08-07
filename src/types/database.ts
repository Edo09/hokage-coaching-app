// TypeScript types matching the Supabase database schema

export type UserRole = "user" | "coach";

export type ProfileGoal = "lose_weight" | "gain_muscle" | "maintain";

export type Profile = {
  id: string;
  // Denormalized from auth.users (20260717150000_profiles_email_sync.sql) —
  // kept in sync by a trigger so admin-panel queries can read it directly.
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  age: number | null;
  sex: "male" | "female" | "other" | null;
  height_cm: number | null;
  weight_kg: number | null;
  activity_level: "sedentary" | "active" | "very_active" | null;
  profession_type: "desk" | "physical" | null;
  days_per_week: number | null;
  session_duration: number | null;
  available_days: string[] | null;
  calorie_goal: number | null;
  goal: ProfileGoal | null;
  role: UserRole;
  whatsapp: string | null;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
};

// Public subset of a coach's profile that clients are allowed to read.
export type Coach = Pick<Profile, "id" | "display_name" | "avatar_url" | "whatsapp">;

// Provenance: 'user' = made by the client, 'ai' = in-app AI generator,
// 'coach' = assigned via the admin panel (a DB trigger forces 'coach'
// whenever assigned_by is set, so external writers can't desync it).
export type RoutineSource = "user" | "ai" | "coach";

export type Routine = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  day_of_week: string | null;
  // null = self-made; a coach's profile id = assigned by the coach (read-only).
  assigned_by: string | null;
  source: RoutineSource;
  created_at: string;
  updated_at: string;
};

// Shared, coach-managed library (Admin Web Panel CRUDs this). Name/video are
// looked up live via the join below, so editing an entry here updates every
// client it's assigned to.
export type Exercise = {
  id: string;
  name: string;
  video_url: string | null;
  body_part_id: string | null;
  // Step-by-step "how to" (jsonb arrays of strings), en + es.
  instructions_en: string[] | null;
  instructions_es: string[] | null;
  created_at: string;
  updated_at: string;
  // Joined via `body_part:bodyparts(name)`.
  body_part?: { name: string } | null;
};

export type RoutineExercise = {
  id: string;
  routine_id: string;
  user_id: string;
  exercise_id: string;
  sets: number;
  reps: number;
  weight_kg: number | null;
  rest_seconds: number;
  sort_order: number;
  notes: string | null;
  created_at: string;
  // Joined via `exercise:exercises(*, body_part:bodyparts(name))`. Optional
  // because the offline outbox overlay can transiently reconstruct a pending
  // row before the exercise catalog cache is populated — always present once
  // synced. Render code must not assume it's there.
  exercise?: Exercise;
};

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export type Meal = {
  id: string;
  user_id: string;
  name: string;
  meal_type: MealType;
  date: string;
  // null = self-made; a coach's profile id = assigned by the coach (read-only).
  assigned_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MealItem = {
  id: string;
  meal_id: string;
  user_id: string;
  name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  portion: string | null;
  photo_path: string | null;
  // Set when this was registered from a prescribed nutrition-plan option —
  // the adherence link the coach reads. null = free-form entry.
  plan_option_id: string | null;
  created_at: string;
};

export type WorkoutLog = {
  id: string;
  user_id: string;
  routine_id: string | null;
  routine_name: string;
  date: string;
  duration_minutes: number | null;
  notes: string | null;
  completed_exercises: string[] | null;
  created_at: string;
};

// Composite types for queries with joins
export type RoutineWithExercises = Routine & {
  routine_exercises: RoutineExercise[];
};

export type MealWithItems = Meal & {
  meal_items: MealItem[];
};

// Insert types (omit auto-generated fields)
export type RoutineInsert = Pick<Routine, "name"> &
  Partial<Pick<Routine, "description" | "day_of_week" | "source">>;

export type RoutineExerciseInsert = Pick<
  RoutineExercise,
  "routine_id" | "exercise_id"
> &
  Partial<
    Pick<
      RoutineExercise,
      "sets" | "reps" | "weight_kg" | "rest_seconds" | "sort_order" | "notes"
    >
  >;

// Carries the already-fetched catalog row through the add-exercise mutation
// so the optimistic cache entry can render name/video before the next sync.
export type AddRoutineExerciseInput = RoutineExerciseInsert & { exercise: Exercise };

export type MealInsert = Pick<Meal, "name" | "meal_type"> &
  Partial<Pick<Meal, "date">>;

export type MealItemInsert = Pick<MealItem, "meal_id" | "name"> &
  Partial<
    Pick<
      MealItem,
      | "calories"
      | "protein_g"
      | "carbs_g"
      | "fat_g"
      | "portion"
      | "photo_path"
      | "plan_option_id"
    >
  >;

export type WorkoutLogInsert = Pick<WorkoutLog, "routine_name"> &
  Partial<
    Pick<WorkoutLog, "routine_id" | "date" | "duration_minutes" | "notes" | "completed_exercises">
  >;

// Daily body-measurement history (P1 migration — supabase/migrations/
// 20260710120000_body_measurements.sql). One row per user per day; the
// progress dashboard degrades to an empty weight card while the table is
// absent.
export type BodyMeasurement = {
  id: string;
  user_id: string;
  measured_on: string;
  weight_kg: number | null;
  body_fat_pct: number | null;
  waist_cm: number | null;
  chest_cm: number | null;
  arm_cm: number | null;
  thigh_cm: number | null;
};

// ---- Coach Programs (multi-week periodized blocks) ------------------------
// docs/COACH-PROGRAMS-SPEC.md. Read-only to clients; coach/admin-panel CRUD.
// A program has days (the split); each day has exercises (the base
// prescription); a GLOBAL program_weeks table modulates RIR/%load per week.

export type ProgramStatus = "active" | "completed" | "archived";
export type LoadQualitative = "light" | "moderate" | "heavy";

export type Program = {
  id: string;
  user_id: string;
  assigned_by: string | null;
  source: "coach";
  name: string;
  description: string | null;
  focus: string | null;
  duration_weeks: number;
  start_date: string;
  status: ProgramStatus;
  progression_rule: string | null;
  tempo_default: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ProgramDay = {
  id: string;
  program_id: string;
  day_index: number;
  label: string | null;
  weekday: string | null;
  sort_order: number;
  created_at: string;
};

export type ProgramExercise = {
  id: string;
  program_day_id: string;
  exercise_id: string | null;
  custom_name: string | null;
  sets: number;
  rep_min: number | null;
  rep_max: number | null;
  is_unilateral: boolean;
  rir_min: number | null;
  rir_max: number | null;
  load_pct_1rm: number | null;
  load_qualitative: LoadQualitative | null;
  tempo: string | null;
  rest_seconds: number | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  // Joined via `exercise:exercises(*, body_part:bodyparts(name))`; absent when
  // the prescription is a custom_name with no catalog entry.
  exercise?: Exercise | null;
};

export type ProgramWeek = {
  id: string;
  program_id: string;
  week_number: number;
  label: string | null;
  rir_min: number | null;
  rir_max: number | null;
  load_pct_min: number | null;
  load_pct_max: number | null;
  is_deload: boolean;
  sets_override: number | null;
  notes: string | null;
  created_at: string;
};

export type ProgramDayWithExercises = ProgramDay & {
  program_exercises: ProgramExercise[];
};

export type ProgramWithDetails = Program & {
  program_days: ProgramDayWithExercises[];
  program_weeks: ProgramWeek[];
};

// Client's logged actuals per prescribed set (Phase 3).
export type WorkoutSetLog = {
  id: string;
  user_id: string;
  program_exercise_id: string;
  week_number: number;
  date: string;
  set_index: number;
  weight_kg: number | null;
  reps: number | null;
  rir: number | null;
  created_at: string;
};

// "Client finished this exercise in this week" — the completion checkbox.
export type ProgramExerciseCompletion = {
  id: string;
  user_id: string;
  program_exercise_id: string;
  week_number: number;
  completed_at: string;
  created_at: string;
};

export type MembershipStatus = "active" | "expired" | "paused" | "cancelled";

// Coach-managed membership. Editable only by the coach (web); clients read own.
export type Membership = {
  id: string;
  client_id: string;
  coach_id: string | null;
  plan_name: string | null;
  status: MembershipStatus;
  price: number | null;
  currency: string | null;
  started_at: string;
  expires_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// ---- Coach Nutrition & Supplementation ------------------------------------
// docs/COACH-NUTRITION-SPEC.md. Two INDEPENDENTLY assignable plans: a client may
// have a diet, a supplement stack, both, or neither.
//
// A nutrition plan is: header -> meal slots -> rotation options -> foods, plus a
// macro target table per day type. day_type sits on the FOOD, not the option:
// "Almuerzo Dia 1-2" holds rice (training only) + chicken (both), which is how
// carb cycling is expressed.
//
// Foods carry a NAME and nothing else. The coach prescribes what to eat; every
// number is measured from the client's photo by the AI estimator.

export type PlanStatus = "active" | "completed" | "archived";

/** Which kind of day a food, slot, or supplement survives on. */
export type DayType = "both" | "training" | "rest";

/** Six slots, but meals.meal_type allows only four — pre/post_workout collapse
 *  to "snack" on diary write-back (see mealTypeToDiarySlot). */
export type PlanMealType = MealType | "pre_workout" | "post_workout";

export type SupplementTier = "base" | "conditional" | "optional";

export type SupplementTiming =
  | "wake"
  | "breakfast"
  | "pre_workout"
  | "intra_workout"
  | "post_workout"
  | "lunch"
  | "dinner"
  | "bedtime"
  | "any";

export type NutritionPlan = {
  id: string;
  user_id: string | null;
  assigned_by: string | null;
  source: "coach";
  is_template: boolean;
  template_id: string | null;
  name: string;
  description: string | null;
  focus: string | null;
  // null = open-ended phase; no week counter is shown.
  duration_weeks: number | null;
  start_date: string;
  status: PlanStatus;
  // false collapses the UI to a single day type and one "both" target row.
  day_cycling: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type NutritionPlanTarget = {
  id: string;
  plan_id: string;
  day_type: DayType;
  kcal_min: number | null;
  kcal_max: number | null;
  protein_min_g: number | null;
  protein_max_g: number | null;
  carbs_min_g: number | null;
  carbs_max_g: number | null;
  fat_min_g: number | null;
  fat_max_g: number | null;
  notes: string | null;
  created_at: string;
};

export type NutritionPlanOptionItem = {
  id: string;
  option_id: string;
  name: string;
  day_type: DayType;
  sort_order: number;
  created_at: string;
};

export type NutritionPlanOption = {
  id: string;
  plan_meal_id: string;
  label: string | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  nutrition_plan_option_items: NutritionPlanOptionItem[];
};

export type NutritionPlanMeal = {
  id: string;
  plan_id: string;
  slot_index: number;
  label: string | null;
  meal_type: PlanMealType;
  time_hint: string | null;
  // Gates the whole slot: post-workout is "training", so it disappears on a rest
  // day — but its notes still carry the substitution to read.
  applies_to: DayType;
  is_optional: boolean;
  notes: string | null;
  sort_order: number;
  created_at: string;
  nutrition_plan_options: NutritionPlanOption[];
};

export type NutritionPlanWithDetails = NutritionPlan & {
  nutrition_plan_meals: NutritionPlanMeal[];
  nutrition_plan_targets: NutritionPlanTarget[];
};

export type SupplementPlan = {
  id: string;
  user_id: string | null;
  assigned_by: string | null;
  source: "coach";
  is_template: boolean;
  template_id: string | null;
  name: string;
  description: string | null;
  start_date: string;
  status: PlanStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SupplementPlanItem = {
  id: string;
  plan_id: string;
  name: string;
  tier: SupplementTier;
  dose: string | null;
  timing_slot: SupplementTiming;
  timing_note: string | null;
  purpose: string | null;
  notes: string | null;
  applies_to: DayType;
  sort_order: number;
  created_at: string;
};

export type SupplementPlanWithDetails = SupplementPlan & {
  supplement_plan_items: SupplementPlanItem[];
};
