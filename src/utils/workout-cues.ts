// When the workout's timed cues fire. Pure: the rest timer
// (src/providers/rest-timer-provider.tsx) and the exercise clock's reminder
// (src/lib/clock-reminder.ts) do the sounding and the scheduling.

/** Seconds before a rest ends when the «get ready» cue sounds. */
export const REST_WARNING_S = 10;
/** The warning needs this much room after a (re)start, or it would land on
    top of the start cue. */
const MIN_WARNING_LEAD_MS = 5000;

/** Milliseconds from `now` to the «10 seconds left» cue of a rest ending at
    `endsAt`, or null when it has no room: a short rest, or one resumed
    already inside its last stretch. */
export function restWarningDelay(endsAt: number, now: number): number | null {
  const delay = endsAt - REST_WARNING_S * 1000 - now;
  return delay >= MIN_WARNING_LEAD_MS ? delay : null;
}

/** How long an exercise clock may run before «¿Sigues con …?». */
export const CLOCK_REMINDER_MS = 30 * 60_000;

/** Milliseconds from `now` until a running exercise clock reaches
    CLOCK_REMINDER_MS, counting the time it already had (`bankedMs`) and the
    stretch since `runningSince`; null while it is paused, or once it is past
    the mark (the screen already says as much). */
export function clockReminderDelay(input: { runningSince: number | null; bankedMs: number; now: number }): number | null {
  if (input.runningSince == null) return null;
  const elapsed = input.bankedMs + Math.max(0, input.now - input.runningSince);
  const delay = CLOCK_REMINDER_MS - elapsed;
  return delay > 0 ? delay : null;
}
