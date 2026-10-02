import type {
  Membership,
  ProgramDayWithExercises,
  ProgramExerciseCompletion,
  ProgramWithDetails,
  WorkoutSetLog,
} from "@/src/types/database";
import { addDays, dateKeyToDate, toDateKey } from "@/src/utils/dates";
import { currentWeekOf, isAfterEnd, isBeforeStart, weekOpensOn } from "@/src/utils/program";
import { dayNameToIndex, dowIndex } from "@/src/utils/progress";

// Pure planner behind the local reminders (docs/superpowers/specs/
// 2026-09-29-local-reminders-design.md). No React, no Expo, no I/O — kept
// testable (reminders.test.ts). It turns what the phone already has into the
// notifications to schedule; src/lib/reminders.ts renders each one with
// t(titleKey, params) / t(bodyKey, params), so the plan is language-free.
// Permission and platform (web) are the caller's checks, not the planner's.

export type ReminderKind = "training" | "inactivity" | "week";

/** Device-level preferences (src/lib/reminder-prefs.ts). `hour` is the local
    hour (0–23) every reminder fires at. */
export type ReminderPrefs = {
  training: boolean;
  inactivity: boolean;
  weekOpened: boolean;
  hour: number;
};

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = {
  training: true,
  inactivity: false,
  weekOpened: false,
  hour: 8,
};

export type PlannedReminder = {
  /** Stable per date and kind ("reminder-2026-10-06-training"), so a rebuild
      replaces a reminder instead of duplicating it. */
  id: string;
  fireAt: Date;
  kind: ReminderKind;
  /** i18n keys in the `reminders` section, rendered with `params`. */
  titleKey: string;
  bodyKey: string;
  params: Record<string, string | number>;
};

export type ReminderInput = {
  program: ProgramWithDetails | null;
  completions: ProgramExerciseCompletion[];
  setLogs: WorkoutSetLog[];
  /** profiles.available_days: "Mon" … "Sun". */
  availableDays: string[] | null;
  membership: Pick<Membership, "status" | "expires_at"> | null;
  prefs: ReminderPrefs;
  now: Date;
  /** A day's display name: its label, else its weekday name, else its number
      («Día n», reminders.dayN). Injected so the planner needs no t(); the
      app passes programDayName (src/utils/day-label.ts). */
  labelOf: (day: ProgramDayWithExercises) => string;
};

/** Days planned ahead, today included: today … today + 13. */
const WINDOW_DAYS = 14;

/** Every reminder id starts with this. The scheduler (src/lib/reminders.ts)
    re-exports it and cancels by it, so this is the one place it is spelled. */
export const REMINDER_ID_PREFIX = "reminder-";

/** Membership states that stop every reminder, whatever the dates say. */
const UNCOVERED: ReadonlySet<Membership["status"]> = new Set([
  "paused",
  "expired",
  "cancelled",
]);

function reminderId(dateKey: string, kind: ReminderKind): string {
  return `${REMINDER_ID_PREFIX}${dateKey}-${kind}`;
}

/** `hour`:00 local time on a date key. Built from the calendar fields, so a
    DST change can't shift it the way adding hours to midnight would. */
function atHour(dateKey: string, hour: number): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d, hour, 0, 0, 0);
}

function isAhead(fireAt: Date, now: Date): boolean {
  return fireAt.getTime() > now.getTime();
}

/** The program week a date falls in (1-based; the date is inside the program). */
function weekOfDate(program: ProgramWithDetails, dateKey: string): number {
  return currentWeekOf(program.start_date, program.duration_weeks, dateKeyToDate(dateKey));
}

/** The general rules every reminder date must pass: inside the program
    (start_date … start + 7·weeks − 1) and covered by the membership. The
    membership covers a date unless it is paused/expired/cancelled or
    expires_at is before that date; no membership row covers everything. */
function dateAllowed(
  program: ProgramWithDetails,
  membership: ReminderInput["membership"],
  dateKey: string,
): boolean {
  const at = dateKeyToDate(dateKey);
  if (isBeforeStart(program.start_date, at)) return false;
  if (isAfterEnd(program.start_date, program.duration_weeks, at)) return false;
  if (membership == null) return true;
  if (UNCOVERED.has(membership.status)) return false;
  return membership.expires_at == null || membership.expires_at >= dateKey;
}

/** What the planner reads from the program log. */
type LogView = {
  /** `${exerciseId}:${week}` of every checked exercise. */
  done: Set<string>;
  /** Local dates ("YYYY-MM-DD") with logged training: a completion check, or
      a set with weight or reps. */
  trainedOn: Set<string>;
};

/** Scoped to THIS program's exercises: the log cache is per user, so rows of
    a previous program (or detached ones, program_exercise_id null) can
    linger until the refetch lands. */
function readLog(
  program: ProgramWithDetails,
  completions: ProgramExerciseCompletion[],
  setLogs: WorkoutSetLog[],
): LogView {
  const exIds = new Set(
    program.program_days.flatMap((d) => d.program_exercises.map((e) => e.id)),
  );
  const done = new Set<string>();
  const trainedOn = new Set<string>();
  for (const c of completions) {
    if (c.program_exercise_id == null || !exIds.has(c.program_exercise_id)) continue;
    done.add(`${c.program_exercise_id}:${c.week_number}`);
    // completed_at is a UTC timestamp; the day that counts is the phone's.
    trainedOn.add(toDateKey(new Date(c.completed_at)));
  }
  for (const s of setLogs) {
    if (s.program_exercise_id == null || !exIds.has(s.program_exercise_id)) continue;
    if (s.weight_kg == null && s.reps == null) continue;
    // Already a local date key (logSet stamps toDateKey()).
    trainedOn.add(s.date);
  }
  return { done, trainedOn };
}

/** The training to name for a week: the first day in day_index order (the
    home card's order) that still has an unchecked exercise. A day without
    exercises has nothing to check, so it never counts. null = nothing
    pending that week. */
function firstPending(
  program: ProgramWithDetails,
  log: LogView,
  week: number,
): ProgramDayWithExercises | null {
  const days = [...program.program_days].sort((a, b) => a.day_index - b.day_index);
  return (
    days.find((d) => d.program_exercises.some((e) => !log.done.has(`${e.id}:${week}`))) ??
    null
  );
}

/** Training day: each date of the window on one of the profile's weekdays
    whose program week still has a pending training. Today only while the
    hour is still ahead and nothing has been logged today. */
function planTraining(
  input: ReminderInput,
  program: ProgramWithDetails,
  log: LogView,
): PlannedReminder[] {
  const { availableDays, membership, prefs, now, labelOf } = input;
  if (!prefs.training) return [];
  // "Mon" … "Sun" → Monday-based index, the same mapping as the dashboard.
  const weekdays = new Set(
    (availableDays ?? []).map(dayNameToIndex).filter((i) => i >= 0),
  );
  if (weekdays.size === 0) return [];

  const today = toDateKey(now);
  const out: PlannedReminder[] = [];
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const date = addDays(today, i);
    if (!weekdays.has(dowIndex(dateKeyToDate(date)))) continue;
    if (!dateAllowed(program, membership, date)) continue;
    const fireAt = atHour(date, prefs.hour);
    if (!isAhead(fireAt, now)) continue;
    if (date === today && log.trainedOn.has(today)) continue;
    const week = weekOfDate(program, date);
    const day = firstPending(program, log, week);
    if (day == null) continue;
    out.push({
      id: reminderId(date, "training"),
      fireAt,
      kind: "training",
      titleKey: "reminders.trainingTitle",
      bodyKey: "reminders.trainingBody",
      // `count` picks the plural form (trainingBody_one / _other).
      params: { label: labelOf(day), count: day.program_exercises.length, w: week },
    });
  }
  return out;
}

/** Inactivity reminders fire this many days after the base date. */
const INACTIVITY_DAYS = [4, 7] as const;

/** Inactivity: base + 4 and base + 7 days, where the base is the later of
    the last logged training and the start date, so any new log restarts the
    count. A log dated after today (a phone with a wrong clock, another
    device) counts as today. Each fires only inside the 14-day window, while
    still ahead, on an allowed date, and while that date's week has a pending
    training — a client who finished the week and waits for a locked one to
    open isn't nudged. Nothing comes after the 7-day one. */
function planInactivity(
  input: ReminderInput,
  program: ProgramWithDetails,
  log: LogView,
): PlannedReminder[] {
  const { membership, prefs, now, labelOf } = input;
  if (!prefs.inactivity) return [];
  const today = toDateKey(now);
  const lastDay = addDays(today, WINDOW_DAYS - 1);
  let base = program.start_date;
  for (const logged of log.trainedOn) {
    const date = logged > today ? today : logged;
    if (date > base) base = date;
  }

  const out: PlannedReminder[] = [];
  for (const days of INACTIVITY_DAYS) {
    const date = addDays(base, days);
    if (date > lastDay) continue;
    const fireAt = atHour(date, prefs.hour);
    if (!isAhead(fireAt, now)) continue;
    if (!dateAllowed(program, membership, date)) continue;
    const day = firstPending(program, log, weekOfDate(program, date));
    if (day == null) continue;
    out.push({
      id: reminderId(date, "inactivity"),
      fireAt,
      kind: "inactivity",
      titleKey: "reminders.inactivityTitle",
      bodyKey: "reminders.inactivityBody",
      params: { days, label: labelOf(day) },
    });
  }
  return out;
}

/** Week opened: "Solo semana actual" programs only. Each week from 2 on
    whose opening day (weekOpensOn) is in the window, naming that week's
    first pending training. Week 1 opens with the program itself. */
function planWeekOpened(
  input: ReminderInput,
  program: ProgramWithDetails,
  log: LogView,
): PlannedReminder[] {
  const { membership, prefs, now, labelOf } = input;
  if (!prefs.weekOpened || !program.lock_future_weeks) return [];
  const today = toDateKey(now);
  const lastDay = addDays(today, WINDOW_DAYS - 1);

  const out: PlannedReminder[] = [];
  for (let w = 2; w <= program.duration_weeks; w++) {
    const date = weekOpensOn(program.start_date, w);
    if (date < today || date > lastDay) continue;
    if (!dateAllowed(program, membership, date)) continue;
    const fireAt = atHour(date, prefs.hour);
    if (!isAhead(fireAt, now)) continue;
    const day = firstPending(program, log, w);
    if (day == null) continue;
    out.push({
      id: reminderId(date, "week"),
      fireAt,
      kind: "week",
      titleKey: "reminders.weekTitle",
      bodyKey: "reminders.weekBody",
      // `count` picks the plural form (weekBody_one / _other).
      params: { w, label: labelOf(day), count: day.program_exercises.length },
    });
  }
  return out;
}

/** At most one reminder per local date (spec). An inactivity reminder wins
    its date: the client hasn't trained in days, which says more than the
    day's training, so that date's training or week-opened reminder is
    dropped. Otherwise a week opening on a training date becomes ONE
    notification: the week-opened title (and its "week" id) over the training
    body. Both name the same training — the date's week is the week that
    opens. */
function onePerDate(
  training: PlannedReminder[],
  weekOpened: PlannedReminder[],
  inactivity: PlannedReminder[],
): PlannedReminder[] {
  const byDate = new Map<string, PlannedReminder>();
  for (const r of training) byDate.set(toDateKey(r.fireAt), r);
  for (const week of weekOpened) {
    const date = toDateKey(week.fireAt);
    const day = byDate.get(date);
    byDate.set(
      date,
      day == null ? week : { ...day, id: week.id, kind: "week", titleKey: week.titleKey },
    );
  }
  for (const r of inactivity) byDate.set(toDateKey(r.fireAt), r);
  return [...byDate.values()];
}

/** Soonest first; same instant → by id, so the order is deterministic. */
function sortPlan(list: PlannedReminder[]): PlannedReminder[] {
  return [...list].sort(
    (a, b) => a.fireAt.getTime() - b.fireAt.getTime() || a.id.localeCompare(b.id),
  );
}

/** Every reminder to schedule, soonest first. Empty without an active
    program. */
export function planReminders(input: ReminderInput): PlannedReminder[] {
  const { program } = input;
  if (program == null || program.status !== "active") return [];
  const log = readLog(program, input.completions, input.setLogs);
  return sortPlan(
    onePerDate(
      planTraining(input, program, log),
      planWeekOpened(input, program, log),
      planInactivity(input, program, log),
    ),
  );
}
