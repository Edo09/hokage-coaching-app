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
};

// Its own module (not celebration-provider.tsx) so useProgramLogging can reach
// it without a require cycle: the provider renders the modal, which uses
// useProgramLogging.
export const CelebrationContext = createContext<Celebration | null>(null);

/** Null outside the provider; callers treat that as "nothing to celebrate". */
export function useCelebration(): Celebration | null {
  return useContext(CelebrationContext);
}
