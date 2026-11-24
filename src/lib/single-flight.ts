/** Runs the task. Resolves `true` when it ran, `false` when it was ignored. */
export type SingleFlight = (task: () => Promise<void>) => Promise<boolean>;

/**
 * Lets one task run at a time: a call made while another is still running does
 * nothing. A double tap must not start two purchases, and React state is too
 * late to say so (it only changes after the next render), so the guard is a
 * plain variable, set before anything is awaited.
 */
export function createSingleFlight(): SingleFlight {
  let running = false;
  return async (task) => {
    if (running) return false;
    running = true;
    try {
      await task();
      return true;
    } finally {
      running = false;
    }
  };
}
