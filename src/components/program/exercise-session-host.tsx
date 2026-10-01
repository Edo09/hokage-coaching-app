import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ExerciseVideoModal } from "@/src/components/exercise-video-modal";
import { ProgramExerciseModal } from "@/src/components/program/program-exercise-modal";
import { useAuth } from "@/src/hooks/use-auth";
import { useCheckFeedback } from "@/src/hooks/use-check-feedback";
import { useProgram } from "@/src/hooks/use-program";
import { useProgramLogging } from "@/src/hooks/use-program-logging";
import {
  elapsedMs,
  exerciseSession,
  sessionKey,
  setSessionUser,
  useClock,
  useExerciseSession,
} from "@/src/lib/exercise-session";
import { formatClock, useRestTimer } from "@/src/providers/rest-timer-provider";
import { useColors } from "@/src/theme/colors";
import { Pressable, Text, View } from "@/src/tw";
import type { ProgramExercise, ProgramWithDetails } from "@/src/types/database";
import { effectivePrescription, weekByNumber } from "@/src/utils/program";

/** The floating rest bar's footprint (card ~73 + its 8px bottom margin). */
const REST_BAR_H = 81;

function findExercise(program: ProgramWithDetails | null, id: string): ProgramExercise | null {
  for (const day of program?.program_days ?? []) {
    const ex = day.program_exercises.find((e) => e.id === id);
    if (ex != null) return ex;
  }
  return null;
}

/**
 * Renders the exercise in progress wherever the client is in the tabs: its
 * sheet when open, the bar when hidden, and the full-screen demo. Wires the
 * session store (`@/src/lib/exercise-session`) to the program's logging.
 */
export function ExerciseSessionHost({ tabBarHeight }: { tabBarHeight: number }) {
  const { user } = useAuth();
  const session = useExerciseSession();
  const { program } = useProgram();
  const logging = useProgramLogging(program);
  const feedback = useCheckFeedback(program);
  const rest = useRestTimer();
  const [videoUri, setVideoUri] = useState<string | null>(null);

  useEffect(() => {
    setSessionUser(user?.id ?? null);
  }, [user?.id]);

  // Keep the clock honest with what's happened elsewhere: an exercise marked
  // done another way (row checkbox, the day's mark-all) stops its clock and
  // keeps its time; one the coach removed from the program is dropped.
  const { isDone } = logging;
  useEffect(() => {
    if (program == null) return;
    const timed = new Set(Object.keys(session.banked));
    if (session.active != null) timed.add(sessionKey(session.active.exerciseId, session.active.week));
    for (const key of timed) {
      const [id, week] = key.split("|");
      if (findExercise(program, id) == null) exerciseSession.quit(id, Number(week));
      else if (isDone(id, Number(week))) exerciseSession.finish(id, Number(week));
    }
  }, [program, session.banked, session.active, isDone]);

  const running = session.active?.runningSince != null;
  const now = useClock(running);

  const sheet = session.sheet;
  const sheetExercise = sheet != null ? findExercise(program, sheet.exerciseId) : null;
  const sheetTimed =
    sheet != null &&
    session.active != null &&
    session.active.exerciseId === sheet.exerciseId &&
    session.active.week === sheet.week;

  const active = session.active;
  const activeExercise = active != null ? findExercise(program, active.exerciseId) : null;
  const activeName =
    activeExercise != null && program != null && active != null
      ? effectivePrescription(activeExercise, weekByNumber(program, active.week), active.week).name
      : null;

  // "Solo semana actual": a week that isn't open yet can't be started,
  // paused, resumed or finished, only quit. Both null for free programs.
  const sheetLock = sheet != null ? logging.lockOf(sheet.week) : null;
  const activeLock = active != null ? logging.lockOf(active.week) : null;
  const togglePause = () => {
    if (activeLock == null) exerciseSession.togglePause();
  };

  // «Terminar»: the clock stops and keeps its time (closing the sheet), then
  // the check-off shows its card with that time («en 3:12»), or only the
  // day-complete stamp when it was the day's last (read before the write).
  const finish = () => {
    if (sheet == null || sheetExercise == null || sheetLock != null) return;
    const finishesDay = logging.completesDay(sheet.exerciseId, sheet.week);
    const seconds = exerciseSession.finish(sheet.exerciseId, sheet.week);
    feedback.afterFinish(sheet.exerciseId, sheet.week, seconds, finishesDay);
  };

  return (
    <>
      <ProgramExerciseModal
        exercise={sheetExercise}
        week={program != null && sheet != null ? weekByNumber(program, sheet.week) : null}
        weekNumber={sheet?.week ?? 1}
        lock={sheetLock}
        logging={logging}
        timed={sheetTimed}
        elapsedMs={sheet != null ? elapsedMs(session, sheet.exerciseId, sheet.week, now) : 0}
        running={sheetTimed && running}
        onStart={() =>
          sheet != null && sheetLock == null && exerciseSession.start(sheet.exerciseId, sheet.week)
        }
        onHide={exerciseSession.hide}
        onTogglePause={togglePause}
        onFinish={finish}
        onQuit={() => sheet != null && exerciseSession.quit(sheet.exerciseId, sheet.week)}
        onPlay={setVideoUri}
      />

      {sheet == null && active != null && activeName != null && (
        <ExerciseSessionBar
          name={activeName}
          clock={formatClock(Math.floor(elapsedMs(session, active.exerciseId, active.week, now) / 1000))}
          running={running}
          locked={activeLock != null}
          onTogglePause={togglePause}
          bottom={tabBarHeight + (rest.running ? REST_BAR_H : 0)}
        />
      )}

      <ExerciseVideoModal uri={videoUri} onClose={() => setVideoUri(null)} />
    </>
  );
}

/**
 * The exercise in progress, minimized: name, clock and pause. Tap it to
 * reopen the sheet. Floats above the tab bar, and above the rest bar when a
 * rest is running. On a locked week a lock takes the pause button's place;
 * the sheet can still quit it.
 */
function ExerciseSessionBar({
  name,
  clock,
  running,
  locked,
  onTogglePause,
  bottom,
}: {
  name: string;
  clock: string;
  running: boolean;
  locked: boolean;
  onTogglePause: () => void;
  bottom: number;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 0, right: 0, bottom, zIndex: 50 }}
    >
      <View className="mx-3 mb-2 flex-row items-center gap-3 overflow-hidden rounded-2xl border border-border bg-surface py-2.5 pl-4 pr-3">
        {/* Tap target behind the content: the pause button is its own
            button, so the bar can't wrap it (nested buttons on RN Web). */}
        <Pressable
          onPress={exerciseSession.expand}
          accessibilityRole="button"
          accessibilityLabel={t("program.sessionOpen", { name })}
          className="absolute inset-0"
        />
        {/* Red edge: in progress (the rest bar drains along its top instead). */}
        <View
          pointerEvents="none"
          className="absolute bottom-0 left-0 top-0 w-[3px]"
          style={{ backgroundColor: running ? colors.brandPrimary : colors.warning }}
        />
        <View pointerEvents="none" className="min-w-0 flex-1">
          <Text className="text-[13px] font-semibold text-content-primary" numberOfLines={1}>
            {name}
          </Text>
          <View className="flex-row items-baseline gap-2">
            <Text className="text-[13px] font-bold text-content-secondary" style={{ fontVariant: ["tabular-nums"] }}>
              {clock}
            </Text>
            <Text className="text-[11px] text-content-tertiary">
              {t(running ? "program.sessionRunning" : "program.sessionPaused")}
            </Text>
          </View>
        </View>
        {locked ? (
          <View pointerEvents="none" className="h-9 w-9 items-center justify-center">
            <Ionicons name="lock-closed" size={15} color={colors.contentMuted} />
          </View>
        ) : (
          <Pressable
            onPress={onTogglePause}
            accessibilityRole="button"
            accessibilityLabel={t(running ? "program.sessionPause" : "program.sessionResume")}
            hitSlop={6}
            className="h-9 w-9 items-center justify-center rounded-full border"
            style={{ borderColor: colors.contentSecondary }}
          >
            <Ionicons name={running ? "pause" : "play"} size={16} color={colors.contentSecondary} />
          </Pressable>
        )}
        <View pointerEvents="none">
          <Ionicons name="chevron-up" size={18} color={colors.contentMuted} />
        </View>
      </View>
    </View>
  );
}
