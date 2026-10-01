import { useProgramLogging } from "@/src/hooks/use-program-logging";
import { checkCard } from "@/src/lib/check-card";
import { exerciseSession } from "@/src/lib/exercise-session";
import { useToday } from "@/src/lib/today";
import type { ProgramDayWithExercises, ProgramWithDetails } from "@/src/types/database";
import { cardIncludes, checkFeedback } from "@/src/utils/check-feedback";
import { currentWeekOf } from "@/src/utils/program";

function findDay(program: ProgramWithDetails | null, exerciseId: string): ProgramDayWithExercises | null {
  return program?.program_days.find((d) => d.program_exercises.some((e) => e.id === exerciseId)) ?? null;
}

/**
 * Checking one exercise off from a row (the Programa tab, the home card) or
 * with «Terminar»: decides what it brings before writing it (the check card,
 * a «Deshacer»-only card, the collapsed «n hechos» card, «Día n completo», or
 * only the day-complete modal; see src/utils/check-feedback.ts), then writes
 * it. Unchecking from a row stays quiet. The day's mark-all pill and the
 * sheet's «Marcar hecho» don't come through here: they never show the card.
 */
export function useCheckFeedback(program: ProgramWithDetails | null): {
  toggleFromRow(exerciseId: string, week: number): void;
  afterFinish(exerciseId: string, week: number, seconds: number, finishesDay: boolean): void;
} {
  const logging = useProgramLogging(program);
  // The fresh day (src/lib/today), as on the Programa tab: an earlier week is
  // logging after the fact.
  const today = useToday();
  const currentWeek =
    program != null ? currentWeekOf(program.start_date, program.duration_weeks, today) : 1;

  const check = (
    exerciseId: string,
    week: number,
    seconds: number | null,
    finishesDay: boolean,
    fromRow: boolean,
  ) => {
    const day = findDay(program, exerciseId);
    // Every check-off is noted: one right after it joins the burst, and from
    // two checks on the store puts the «n hechos» card up itself.
    const quick = checkCard.noteCheck(exerciseId, week, Date.now()) === "batch";
    const shown = checkFeedback({
      finishesDay,
      // Read before the write: setCompletion sets off celebrateDay at once.
      celebrated: day != null && checkCard.wasCelebrated(day.id, week),
      // Only row checks run together: «Terminar» keeps its own card and time.
      batch: fromRow && quick,
      pastWeek: week < currentWeek,
      otherInProgress: exerciseSession.inProgressElsewhere(exerciseId, week),
    });
    if (day == null || shown.kind === "dayModal") {
      // The day-complete modal is the moment: no card under it (dismiss also
      // ends the burst, so the next check is a plain card).
      checkCard.dismiss();
    } else if (shown.kind === "dayAgain") {
      checkCard.show({ kind: "dayAgain", dayId: day.id, week, exerciseId });
    } else if (!shown.collapse) {
      checkCard.show({ kind: "single", exerciseId, dayId: day.id, week, seconds, undoOnly: shown.undoOnly });
    }
    void logging.setCompletion(exerciseId, week, true);
  };

  return {
    toggleFromRow(exerciseId, week) {
      // "Solo semana actual": the circle is disabled on a week that isn't
      // open, and nothing shows if a press gets through anyway.
      if (logging.lockOf(week) != null) return;
      if (logging.isDone(exerciseId, week)) {
        // Quiet, but a card still showing this check-off goes with it.
        if (cardIncludes(checkCard.get(), { exerciseId, week })) checkCard.dismiss();
        void logging.setCompletion(exerciseId, week, false);
        return;
      }
      check(exerciseId, week, null, logging.completesDay(exerciseId, week), true);
    },
    afterFinish(exerciseId, week, seconds, finishesDay) {
      if (logging.lockOf(week) != null) return;
      check(exerciseId, week, seconds > 0 ? seconds : null, finishesDay, false);
    },
  };
}
