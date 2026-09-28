import { createContext, useContext } from "react";

import type { ProgramWithDetails } from "@/src/types/database";

/** A program day the client just finished, for the day-complete modal. */
export type DayCelebration = {
  program: ProgramWithDetails;
  dayId: string;
  week: number;
};

export type Celebration = {
  celebrateDay: (day: DayCelebration) => void;
  /** The day being celebrated, from its last check-off until the modal
      closes. Screens that would move off a finished day (the home card
      advancing, a Programa day collapsing) hold it on view meanwhile, so the
      last check-off's burst plays and the modal lands on what was done. */
  holding: { dayId: string; week: number } | null;
};

/** Whether this day and week is being held on view for its celebration. */
export function isHeld(celebration: Celebration | null, dayId: string, week: number): boolean {
  const held = celebration?.holding;
  return held != null && held.dayId === dayId && held.week === week;
}

// Its own module (not celebration-provider.tsx) so useProgramLogging can reach
// it without a require cycle: the provider renders the modal, which uses
// useProgramLogging.
export const CelebrationContext = createContext<Celebration | null>(null);

/** Null outside the provider; callers treat that as "nothing to celebrate". */
export function useCelebration(): Celebration | null {
  return useContext(CelebrationContext);
}
