import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DayCompleteModal } from "@/src/components/program/day-complete-modal";
import {
  type Celebration,
  CelebrationContext,
  type DayCelebration,
} from "@/src/providers/celebration-context";

/**
 * Hosts the day-complete modal above the router, so finishing a day
 * celebrates the same way from the Programa tab, the home card, or an
 * exercise sheet.
 */
export function CelebrationProvider({ children }: { children: React.ReactNode }) {
  // The last day celebrated stays mounted after closing so the modal can fade
  // out with its content; `visible` is what opens and closes it.
  const [shown, setShown] = useState<{ day: DayCelebration; id: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const celebrateDay = useCallback((next: DayCelebration) => {
    // A beat before covering the screen: the last check-off's own burst gets
    // to land, and an exercise sheet that closed on it gets to slide away.
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setShown((prev) => ({ day: next, id: (prev?.id ?? 0) + 1 }));
      setVisible(true);
    }, 450);
  }, []);

  useEffect(
    () => () => {
      if (timer.current != null) clearTimeout(timer.current);
    },
    [],
  );

  const value = useMemo<Celebration>(() => ({ celebrateDay }), [celebrateDay]);

  return (
    <CelebrationContext.Provider value={value}>
      {children}
      {shown != null && (
        <DayCompleteModal
          day={shown.day}
          openId={shown.id}
          visible={visible}
          onClose={() => setVisible(false)}
        />
      )}
    </CelebrationContext.Provider>
  );
}
