// How long the phone buzzes at each moment of a workout: Android patterns,
// [wait, buzz, wait, buzz…] in milliseconds (iOS ignores the lengths and has
// its own haptics, see src/lib/rest-alert.ts). Every buzz lasts at least
// MIN_BUZZ_MS: shorter ones are barely felt through a pocket or on a bench.
// The end of a rest is the longest, since the phone is often face-down then.

export const MIN_BUZZ_MS = 150;

export const VIBRATIONS = {
  /** A rest starts: one firm buzz. */
  start: [0, 200],
  /** 10 seconds of rest left: two buzzes. */
  warn: [0, 180, 120, 180],
  /** The rest is over: three long buzzes. Also the notification's pattern. */
  done: [0, 500, 150, 500, 150, 500],
  /** A new record: short, then long. */
  record: [0, 160, 100, 320],
  /** A finished day: two short, then long. */
  day: [0, 200, 120, 200, 120, 450],
  /** «Superserie: sin descanso»: two buzzes. */
  superset: [0, 160, 120, 160],
} as const satisfies Record<string, readonly number[]>;

export type BuzzKind = keyof typeof VIBRATIONS;

/** The buzzes of a pattern, without the waits. */
export const buzzesOf = (pattern: readonly number[]): number[] =>
  pattern.filter((_, i) => i % 2 === 1);
