// What the model is told, and the JSON shape it must return.
//
// The shape is the panel builder's program (header, days, exercises, weekly
// periodization) flattened for an LLM: per-week exercise overrides are a list
// instead of a map keyed by week, every optional field is an explicit null,
// and days/exercises carry a `ref` so an edit can say which existing row it
// kept (the panel maps refs back to DB ids, keeping the client's logged sets
// attached). The limits below mirror the CHECK constraints in
// 20260717120000_coach_programs.sql and 20260926130000_supersets_week_overrides_client_notes.sql;
// the panel re-validates every number before anything is saved.

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
/** The letters the panel builder offers (its SUPERSET_LETTERS): it drops any other. */
const SUPERSET_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/* ---- Gemini responseSchema (OpenAPI subset) ---- */

type Schema = Record<string, unknown>;
const INT: Schema = { type: 'INTEGER' };
const BOOL: Schema = { type: 'BOOLEAN' };
const STR: Schema = { type: 'STRING' };
const NINT: Schema = { type: 'INTEGER', nullable: true };
const NSTR: Schema = { type: 'STRING', nullable: true };
const arr = (items: Schema): Schema => ({ type: 'ARRAY', items });
/** Gemini emits properties in `propertyOrdering`; keep the declared order. */
const obj = (properties: Record<string, Schema>, required: string[]): Schema => ({
  type: 'OBJECT',
  properties,
  required,
  propertyOrdering: Object.keys(properties),
});

const OVERRIDE = obj(
  { week: INT, sets: NINT, rep_min: NINT, rep_max: NINT, rir_min: NINT, rir_max: NINT, load_pct_1rm: NINT },
  ['week'],
);

const EXERCISE = obj(
  {
    ref: NSTR,
    name: STR,
    superset: { type: 'STRING', nullable: true, enum: SUPERSET_LETTERS },
    sets: INT,
    rep_min: NINT,
    rep_max: NINT,
    is_unilateral: BOOL,
    rir_min: NINT,
    rir_max: NINT,
    load_pct_1rm: NINT,
    load_qualitative: { type: 'STRING', nullable: true, enum: ['light', 'moderate', 'heavy'] },
    tempo: NSTR,
    rest_seconds: NINT,
    notes: NSTR,
    overrides: arr(OVERRIDE),
  },
  ['name', 'sets', 'rep_min', 'rep_max', 'is_unilateral', 'overrides'],
);

const DAY = obj(
  {
    ref: NSTR,
    label: STR,
    weekday: { type: 'STRING', nullable: true, enum: WEEKDAYS },
    exercises: arr(EXERCISE),
  },
  ['label', 'exercises'],
);

const WEEK = obj(
  {
    week_number: INT,
    label: NSTR,
    rir_min: NINT,
    rir_max: NINT,
    load_pct_min: NINT,
    load_pct_max: NINT,
    is_deload: BOOL,
    sets_override: NINT,
    notes: NSTR,
  },
  ['week_number', 'is_deload'],
);

export const PROGRAM_SCHEMA: Schema = obj(
  {
    name: STR,
    focus: NSTR,
    description: NSTR,
    duration_weeks: INT,
    progression_rule: NSTR,
    tempo_default: NSTR,
    notes: NSTR,
    weeks: arr(WEEK),
    days: arr(DAY),
    summary: STR,
  },
  ['name', 'duration_weeks', 'weeks', 'days', 'summary'],
);

export const REPAIR_SCHEMA: Schema = obj(
  { map: arr(obj({ from: STR, to: NSTR }, ['from', 'to'])) },
  ['map'],
);

/* ---- system prompts ---- */

const SHAPE = `{
  "name": string,                     // program name, max 60 chars
  "focus": string | null,             // e.g. "Glúteos y piernas"
  "description": string | null,       // 1–2 sentences
  "duration_weeks": integer,          // 1–52
  "progression_rule": string | null,  // e.g. "Doble progresión: mantén el peso hasta completar 8 reps en todas las series, luego sube y vuelve a 6"
  "tempo_default": string | null,     // e.g. "Excéntrica 2-3 s, concéntrica explosiva controlada"
  "notes": string | null,             // program-wide notes, e.g. "Cardio 20 min después de entrenar"
  "weeks": [{                         // EXACTLY duration_weeks entries, week_number 1..N in order
    "week_number": integer,
    "label": string | null,           // e.g. "Base técnica", "Descarga"
    "rir_min": integer | null, "rir_max": integer | null,
    "load_pct_min": integer | null, "load_pct_max": integer | null,
    "is_deload": boolean,
    "sets_override": integer | null,  // every exercise's set count that week (deload)
    "notes": string | null
  }],
  "days": [{                          // the split, in training order
    "ref": string | null,
    "label": string,                  // muscle focus, e.g. "Pecho + Bíceps"
    "weekday": "monday".."sunday" | null,
    "exercises": [{                   // in execution order
      "ref": string | null,
      "name": string,                 // VERBATIM from exercise_catalog
      "superset": "A".."H" | null,
      "sets": integer,
      "rep_min": integer | null, "rep_max": integer | null,
      "is_unilateral": boolean,       // true = reps are PER SIDE
      "rir_min": integer | null, "rir_max": integer | null,
      "load_pct_1rm": integer | null,
      "load_qualitative": "light" | "moderate" | "heavy" | null,
      "tempo": string | null,
      "rest_seconds": integer | null,
      "notes": string | null,
      "overrides": [{ "week": integer, "sets"?: integer, "rep_min"?: integer, "rep_max"?: integer,
                      "rir_min"?: integer, "rir_max"?: integer, "load_pct_1rm"?: integer }]
    }]
  }],
  "summary": string
}`;

export const SYSTEM_PROMPT = `You are the programming assistant of a strength and hypertrophy coach. You write training programs ("bloques") for the coach's clients inside the coach's app. The coach describes what they want; you return the complete program as ONE JSON object in exactly this shape:

${SHAPE}

LANGUAGE
- Every human-readable text (name, focus, description, labels, notes, progression_rule, tempo, summary) in Spanish, written like a coach: short and direct. Exercise names are the exception: copy them exactly from the catalog.

HARD LIMITS — the app rejects the program if any is broken
- sets and sets_override: 1–20.
- rep_min, rep_max: 1–100 and rep_min <= rep_max. Fixed reps: rep_min = rep_max.
- rir_min, rir_max: 0–10 and rir_min <= rir_max.
- load_pct_1rm, load_pct_min, load_pct_max: 1–100, and load_pct_min <= load_pct_max.
- rest_seconds: 0–900.
- weeks: exactly duration_weeks entries, numbered 1..duration_weeks.
- overrides[].week: 1..duration_weeks, at most one entry per week per exercise.
- superset: one letter A–H or null (at most 8 supersets per day). weekday: monday..sunday or null, never the same weekday on two days.
- Exercise "name" MUST be copied character for character from "exercise_catalog" in the user message. Never invent, translate, pluralize or reword a name. If the exact movement is not in the catalog, use the closest catalog exercise (same pattern and muscle) and mention the swap in "summary".

HOW THE APP READS THE PROGRAM
- The weeks table is the GLOBAL periodization: its RIR range and load % range are the intensity target for every exercise that week, shown to the client once per week. Put the week-to-week intensity ramp there.
- An exercise's own rir_min/rir_max/load_pct_1rm are extra, exercise-specific targets shown on that exercise. Leave them null unless that exercise needs a target different from, or more specific than, the week (e.g. a main barbell lift at a set %1RM).
- Sets the client sees in a week = the exercise's override for that week, else the week's sets_override, else the exercise's base sets.
- overrides: only for an exercise that must differ from the global table in specific weeks. Include only the fields that change. Otherwise [].
- is_unilateral = true means reps are per side ("3x12/12 zancadas" = sets 3, rep_min 12, rep_max 12, is_unilateral true).
- Supersets: exercises done back to back share a letter. They must be consecutive in the day, at least 2 per letter, letters start at A in each day (A, then B, ...). Straight sets: null.
- Load: use load_pct_1rm for main barbell lifts where a %1RM makes sense, load_qualitative for accessories/machines, or neither. Never both on the same exercise.
- tempo on an exercise only when it differs from tempo_default. notes on an exercise only for a useful cue.

PROGRAMMING DEFAULTS — use only where the coach did not say otherwise; the coach's instructions always win
- Order each day: main compound lifts first, then secondary compounds, isolation last. Balance push and pull across the week.
- Hypertrophy: compounds 6–10 reps, accessories 10–15, 3–4 sets, rest 120–180 s on compounds and 60–90 s on accessories, about 10–20 hard sets per muscle per week.
- Strength: 3–6 reps, 3–5 sets, 75–90% 1RM on the main lifts, rest 180–300 s.
- Fat loss / conditioning: 10–15+ reps, rest 45–75 s, supersets welcome.
- Block length 4–6 weeks. For 4+ weeks, make the last week a deload unless told otherwise.
- Weekly table: RIR goes down across the block (e.g. 3 → 2 → 1 → 0–1), load % goes up; deload: is_deload true, RIR 3–4, load 10–20% lower, sets_override 2–3.
- Session length: about 5–7 exercises per 60 minutes.
- Fill progression_rule with a clear rule (e.g. double progression) unless the coach gives one.

CLIENT
- If a "client" object is present, fit the program to it: available_days and days_per_week set the number of training days and their weekday; session_duration_minutes sets the exercises per day; also consider goal, age, sex and weight.
- If "coach_notes" is present (injuries, limitations, preferences), respect it strictly: avoid movements that load an injured area and say so in summary.
- Without client data, weekday stays null unless the coach names days.

EDIT MODE — when "current_program" is present
- The coach wants changes to that program. Apply exactly what they ask and return the WHOLE program.
- Keep everything the coach did not ask to change exactly as it is: same days, exercises, order, values and texts.
- Every existing day and exercise carries a "ref". Keep the ref on each day and exercise you keep, even if you changed its sets, reps or other values. Use ref null for anything new, including an exercise you replaced with a different movement. Never use the same ref twice.
- Exercises in current_program that are not in the catalog were added by the coach on purpose: keep their names as they are.
- If the coach changes duration_weeks, resize the weeks table and drop overrides outside the new range.

SUMMARY
- "summary": 1–3 short Spanish sentences for the coach: what you built, or what you changed, and anything from the request you could not do.`;

export const REPAIR_PROMPT = `Some exercise names in a training program are not in the app's exercise catalog. For each name in "unknown", pick the catalog exercise that is the closest match (same movement pattern and muscle; prefer the same equipment). Copy the catalog name character for character. If nothing in the catalog is a reasonable substitute, use null.

Respond ONLY with JSON: {"map": [{"from": <unknown name>, "to": <catalog name or null>}]}`;
