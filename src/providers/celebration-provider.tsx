import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DayCompleteModal } from "@/src/components/program/day-complete-modal";
import { checkCard } from "@/src/lib/check-card";
import { exerciseSession } from "@/src/lib/exercise-session";
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
  const [holding, setHolding] = useState<Celebration["holding"]>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The day and week whose modal is about to open (the beat below).
  const pending = useRef<string | null>(null);

  const celebrateDay = useCallback((next: DayCelebration) => {
    // Once per day and week per app session, and this is the one place that
    // decides it. Re-checking a celebrated day's last exercise doesn't replay
    // the stamp: the check card says «Día n completo» instead (its hook reads
    // the same flag before writing), and the mark-all pill shows nothing.
    const key = `${next.dayId}|${next.week}`;
    if (checkCard.wasCelebrated(next.dayId, next.week) || pending.current === key) return;
    // Nothing under the stamp: no check card (a row checked a few seconds
    // before the day's pill), and an exercise sheet still open on the day
    // («Marcar hecho») closes first, so the stamp lands on the screen.
    checkCard.dismiss();
    exerciseSession.hide();
    setHolding({ dayId: next.dayId, week: next.week });
    // A beat before covering the screen: the last check-off's own burst gets
    // to land, and an exercise sheet that closed on it gets to slide away.
    if (timer.current != null) clearTimeout(timer.current);
    pending.current = key;
    timer.current = setTimeout(() => {
      pending.current = null;
      // Marked as it opens: a celebration cut short by another day finishing
      // within the beat (two mark-all pills) can still play later.
      checkCard.markCelebrated(next.dayId, next.week);
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

  const value = useMemo<Celebration>(() => ({ celebrateDay, holding }), [celebrateDay, holding]);

  return (
    <CelebrationContext.Provider value={value}>
      {children}
      {shown != null && (
        <DayCompleteModal
          day={shown.day}
          openId={shown.id}
          visible={visible}
          onClose={() => {
            setVisible(false);
            setHolding(null);
          }}
        />
      )}
    </CelebrationContext.Provider>
  );
}
