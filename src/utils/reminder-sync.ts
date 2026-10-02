import type { PermissionStatus } from "@/src/utils/notification-permission";

// When the reminder sync (src/hooks/use-reminder-sync.ts) may rebuild. Pure,
// so `npm test` pins it: data that hasn't loaded, or failed to load with
// nothing cached, looks exactly like "no program", "no training days" or "no
// membership", and a plan built from it would cancel the reminders (or
// schedule some for a client whose membership ended).

/** One input of the plan: still on its first load, failed with nothing
    cached, or usable (which includes a real "none"). */
export type SourceState = "loading" | "failed" | "ready";

export function sourceState(s: {
  loading: boolean;
  error: boolean;
  hasData: boolean;
}): SourceState {
  // Cached data is usable even when the last refetch failed.
  if (s.hasData) return "ready";
  if (s.loading) return "loading";
  return s.error ? "failed" : "ready";
}

export type ReminderSyncAction = "wait" | "cancel" | "plan";

export type ReminderSyncGate = {
  signedIn: boolean;
  /** null until the first read resolves. */
  permission: PermissionStatus | null;
  /** The stored reminder preferences have been read. */
  prefsReady: boolean;
  program: SourceState;
  log: SourceState;
  profile: SourceState;
  membership: SourceState;
};

/** "wait" keeps whatever is scheduled; "cancel" drops every reminder;
    "plan" rebuilds them from the data. */
export function reminderSyncAction(g: ReminderSyncGate): ReminderSyncAction {
  if (!g.signedIn || g.permission == null) return "wait";
  // Without permission nothing may stay scheduled, whatever the data says.
  if (g.permission !== "granted") return "cancel";
  if (!g.prefsReady) return "wait";
  const sources = [g.program, g.log, g.profile, g.membership];
  return sources.every((s) => s === "ready") ? "plan" : "wait";
}
