import { useSyncExternalStore } from "react";

// The floating bars over the tab bar (the rest bar, the exercise-in-progress
// bar), as measured on screen. The check card stacks on them: their text
// follows the system font size, so a fixed footprint lets the card overlap
// them at large accessibility sizes. Each bar reports its footprint
// (onLayout, margins included) while it's mounted.

export type BottomBar = "rest" | "session";
export type BarHeights = { rest: number | null; session: number | null };

/** The bars' 1x footprints, used until a bar has been measured. */
const FALLBACK = { rest: 81, session: 66 } as const;

let heights: BarHeights = { rest: null, session: null };
const listeners = new Set<() => void>();

export const bottomBars = {
  /** A bar's measured footprint, or null when it unmounts. */
  set(bar: BottomBar, height: number | null) {
    if (heights[bar] === height) return;
    heights = { ...heights, [bar]: height };
    listeners.forEach((listener) => listener());
  },
  get(): BarHeights {
    return heights;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useBottomBarHeights(): BarHeights {
  return useSyncExternalStore(bottomBars.subscribe, bottomBars.get, bottomBars.get);
}

/** Where something stacked above the showing bars sits: `base` (the tab bar)
    plus each showing bar's measured footprint, or its 1x footprint until it
    has been measured. */
export function barStackOffset(
  base: number,
  shown: { restShown: boolean; sessionShown: boolean },
  measured: BarHeights,
): number {
  return (
    base +
    (shown.restShown ? (measured.rest ?? FALLBACK.rest) : 0) +
    (shown.sessionShown ? (measured.session ?? FALLBACK.session) : 0)
  );
}
