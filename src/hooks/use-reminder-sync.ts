import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { AppState, Platform } from "react-native";

import { useAuth } from "@/src/hooks/use-auth";
import { useMembership } from "@/src/hooks/use-membership";
import { useProfile } from "@/src/hooks/use-profile";
import { useProgram } from "@/src/hooks/use-program";
import { useProgramLogging } from "@/src/hooks/use-program-logging";
import { usePermissionStatus } from "@/src/lib/notification-permission";
import { qk } from "@/src/lib/query-keys";
import { useReminderPrefs, useReminderPrefsReady } from "@/src/lib/reminder-prefs";
import { cancelReminders, reminderGeneration, syncReminders } from "@/src/lib/reminders";
import { useToday } from "@/src/lib/today";
import { programDayName } from "@/src/utils/day-label";
import { reminderSyncAction, type SourceState, sourceState } from "@/src/utils/reminder-sync";
import { planReminders, type PlannedReminder } from "@/src/utils/reminders";

/** Quiet time before a rebuild: a check-off, its refetch and the realtime
    event after it land as one rebuild, not three. */
const DEBOUNCE_MS = 1000;

/** Where the program log's query stands. Read from the query cache, so
    useProgramLogging stays as it is: ready once it has rows (fetched or
    restored from the persisted cache), or when the program has no exercises
    to log (the query never runs then). */
function useLogSource(userId: string | undefined, hasExercises: boolean): SourceState {
  const queryClient = useQueryClient();
  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );
  const read = useCallback((): SourceState => {
    const state = queryClient.getQueryState(qk.programLog(userId));
    return sourceState({
      loading: state == null || state.status === "pending",
      error: state?.status === "error",
      hasData: !hasExercises || state?.data !== undefined,
    });
  }, [queryClient, userId, hasExercises]);
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * Keeps the phone's scheduled reminders (`@/src/lib/reminders`) in step with
 * the data they are built from. Mounted once, in the tabs layout: only a
 * signed-in, onboarded client gets here.
 *
 * Rebuilds the whole 14-day plan, debounced, when the app returns to the
 * foreground, the day changes, the program, its log, the profile's training
 * days or the membership change, the preferences or the language change, or
 * the permission changes. Without permission it cancels them all instead.
 * While any of that is still loading (or failed with nothing cached) it
 * leaves what's scheduled alone (`reminderSyncAction`). Nothing on web.
 */
export function useReminderSync(): void {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { user } = useAuth();
  const { program, loading: programLoading, error: programError } = useProgram();
  const { completions, setLogs } = useProgramLogging(program);
  const { profile, loading: profileLoading, error: profileError } = useProfile(user?.id);
  const {
    membership,
    loading: membershipLoading,
    error: membershipError,
  } = useMembership();
  const hasExercises = program?.program_days.some((d) => d.program_exercises.length > 0) ?? false;
  const logSource = useLogSource(user?.id, hasExercises);
  const availableDays = profile?.available_days ?? null;
  const prefs = useReminderPrefs();
  const prefsReady = useReminderPrefsReady();
  const { status } = usePermissionStatus();
  // Neither is read below: both only make the effect run again. `today`
  // moves at local midnight, `foreground` on every return to the app.
  const today = useToday();
  const [foreground, setForeground] = useState(0);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") setForeground((n) => n + 1);
    });
    return () => sub.remove();
  }, []);

  const action = reminderSyncAction({
    signedIn: user != null,
    permission: status,
    prefsReady,
    program: sourceState({
      loading: programLoading,
      error: programError,
      hasData: program != null,
    }),
    log: logSource,
    profile: sourceState({
      loading: profileLoading,
      error: profileError,
      hasData: profile != null,
    }),
    membership: sourceState({
      loading: membershipLoading,
      error: membershipError,
      hasData: membership != null,
    }),
  });

  useEffect(() => {
    if (Platform.OS === "web" || action === "wait") return;
    // Read now, checked when the timer fires: a cancel in between (sign-out)
    // makes this rebuild the previous client's.
    const generation = reminderGeneration();
    const timer = setTimeout(() => {
      if (reminderGeneration() !== generation) return;
      if (action === "cancel") {
        void cancelReminders();
        return;
      }
      let plan: PlannedReminder[];
      try {
        plan = planReminders({
          program,
          completions,
          setLogs,
          availableDays,
          membership,
          prefs,
          now: new Date(),
          labelOf: (day) => programDayName(day, t),
        });
      } catch {
        // A planner bug must never take the tabs down; keep what's scheduled.
        return;
      }
      void syncReminders(plan, t);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    action,
    program,
    completions,
    setLogs,
    availableDays,
    membership,
    prefs,
    t,
    language,
    today,
    foreground,
  ]);
}
