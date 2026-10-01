import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PanResponder } from "react-native";
import {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useProgram } from "@/src/hooks/use-program";
import { useProgramLogging } from "@/src/hooks/use-program-logging";
import { checkCard, type CheckCardState, useCheckCard } from "@/src/lib/check-card";
import { exerciseSession, useExerciseSession } from "@/src/lib/exercise-session";
import { DUR, EASE_OUT, enter, exit, PressableScale, Swap } from "@/src/lib/motion";
import { kgToUnit1, useWeightUnit } from "@/src/lib/weight-unit";
import { formatClock, useRestTimer } from "@/src/providers/rest-timer-provider";
import { useColors } from "@/src/theme/colors";
import { Pressable, Text, View } from "@/src/tw";
import { AnimatedView } from "@/src/tw/animated";
import type {
  ProgramDayWithExercises,
  ProgramExercise,
  ProgramWithDetails,
} from "@/src/types/database";
import { checkHighlight, type CheckHighlight, nextExercise } from "@/src/utils/check-card";
import { effectivePrescription, weekByNumber } from "@/src/utils/program";
import { dayRecordLogs, exerciseNames, exerciseRecord } from "@/src/utils/records";

/** The floating rest bar's footprint (REST_BAR_H in exercise-session-host.tsx). */
const REST_BAR_H = 81;
/** The exercise-in-progress bar's footprint: its card (a 36px button, py-2.5
    and a 1px border: 58) + its 8px bottom margin. */
const SESSION_BAR_H = 66;
/** How long a card stays up with no finger on it. */
const AUTO_CLOSE_MS = 5000;
/** A drag down this far (px), or a flick this fast (px/ms), swipes it away. */
const SWIPE_CLOSE_PX = 40;
const SWIPE_CLOSE_VY = 0.5;

const TABULAR = { fontVariant: ["tabular-nums" as const] };

/** An exercise of the program and the day it's in; null once the coach removed it. */
function locate(
  program: ProgramWithDetails,
  exerciseId: string,
): { exercise: ProgramExercise; day: ProgramDayWithExercises } | null {
  for (const day of program.program_days) {
    const exercise = day.program_exercises.find((e) => e.id === exerciseId);
    if (exercise != null) return { exercise, day };
  }
  return null;
}

/** Whether the program still has what the card is about (the coach may edit meanwhile). */
function renderable(card: CheckCardState, program: ProgramWithDetails): boolean {
  if (card.kind === "single") return locate(program, card.exerciseId) != null;
  if (card.kind === "dayAgain") return program.program_days.some((d) => d.id === card.dayId);
  return card.items.length > 0;
}

/** What the card is about: a new one swaps its content in; the batch growing doesn't. */
function contentKey(card: CheckCardState): string {
  if (card.kind === "batch") return "batch";
  if (card.kind === "dayAgain") return `day|${card.dayId}|${card.week}`;
  return `${card.exerciseId}|${card.week}`;
}

/**
 * The card that answers a check-off (`@/src/lib/check-card`): rendered once,
 * in the tabs layout, so it floats over whichever tab the check came from.
 * Clear of the tab bar (`bottom`), and above the rest bar and the
 * exercise-in-progress bar when they show. No backdrop: the screen stays
 * usable underneath.
 */
export function CheckCardHost({ bottom }: { bottom: number }) {
  const card = useCheckCard();
  const session = useExerciseSession();
  const rest = useRestTimer();
  const { program } = useProgram();

  // An exercise sheet opening covers the card: take it down. And none is
  // left behind for the next sign-in when the tabs unmount.
  useEffect(() => {
    if (session.sheet != null) checkCard.dismiss();
  }, [session.sheet]);
  useEffect(() => () => checkCard.dismiss(), []);

  // A card the program no longer has (the coach removed the exercise or the
  // day) renders nothing: drop it, so it can't come back or join a batch.
  const stale = card != null && program != null && !renderable(card, program);
  useEffect(() => {
    if (stale) checkCard.dismiss();
  }, [stale]);

  // The same condition ExerciseSessionHost shows its bar on.
  const sessionBar =
    session.sheet == null &&
    session.active != null &&
    program != null &&
    locate(program, session.active.exerciseId) != null;
  const offset = bottom + (rest.running ? REST_BAR_H : 0) + (sessionBar ? SESSION_BAR_H : 0);

  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 0, right: 0, bottom: offset, zIndex: 50 }}
    >
      {card != null && program != null && renderable(card, program) && (
        <CheckCardFrame card={card} program={program} />
      )}
    </View>
  );
}

/**
 * Slides up, closes by itself after ~5 s or with a swipe down. A finger on
 * the card holds it (letting go gives it the full time again); a new check
 * restarts the time. No haptic: the check already gave one.
 */
function CheckCardFrame({ card, program }: { card: CheckCardState; program: ProgramWithDetails }) {
  const reduced = useReducedMotion();
  const [touching, setTouching] = useState(false);
  const drag = useSharedValue(0);

  useEffect(() => {
    if (touching) return;
    const id = setTimeout(() => checkCard.dismiss({ keepRun: true }), AUTO_CLOSE_MS);
    return () => clearTimeout(id);
  }, [card, touching]);

  // Vertical drags only, so taps still reach the buttons; a drag that starts
  // on a button takes over from it.
  const pan = useMemo(() => {
    const settle = () =>
      drag.set(reduced ? 0 : withTiming(0, { duration: DUR.fast, easing: EASE_OUT }));
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && g.dy > Math.abs(g.dx),
      onPanResponderMove: (_, g) => drag.set(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > SWIPE_CLOSE_PX || g.vy > SWIPE_CLOSE_VY) checkCard.dismiss({ keepRun: true });
        else settle();
      },
      onPanResponderTerminate: settle,
    });
  }, [drag, reduced]);
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drag.get() }] }));

  const hold = () => setTouching(true);
  const release = () => setTouching(false);

  return (
    // Entrance and exit on their own view: the drag owns the inner one's transform.
    <AnimatedView entering={reduced ? undefined : enter()} exiting={reduced ? undefined : exit()}>
      <AnimatedView
        {...pan.panHandlers}
        testID="check-card"
        style={dragStyle}
        // Touch for phones, pointer for a mouse on web.
        onTouchStart={hold}
        onTouchEnd={release}
        onTouchCancel={release}
        onPointerDown={hold}
        onPointerUp={release}
        onPointerLeave={release}
        accessibilityLiveRegion="polite"
        className="mx-3 mb-2 overflow-hidden rounded-2xl border border-border bg-surface px-3 py-3"
      >
        <Swap id={contentKey(card)}>
          {card.kind === "single" ? (
            <SingleCard card={card} program={program} />
          ) : card.kind === "batch" ? (
            <BatchCard items={card.items} program={program} />
          ) : (
            <DayAgainCard card={card} program={program} />
          )}
        </Swap>
      </AnimatedView>
    </AnimatedView>
  );
}

/**
 * One exercise checked: its name, the day's progress, one highlight when
 * there's something true to say, then what's next. A past week, or another
 * exercise's clock running, gets only «Deshacer» (`undoOnly`).
 */
function SingleCard({
  card,
  program,
}: {
  card: Extract<CheckCardState, { kind: "single" }>;
  program: ProgramWithDetails;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const rest = useRestTimer();
  const logging = useProgramLogging(program);
  const found = locate(program, card.exerciseId);
  if (found == null) return null;

  const { exercise, day } = found;
  const { week, undoOnly } = card;
  const weekRow = weekByNumber(program, week);
  const p = effectivePrescription(exercise, weekRow, week);
  const isDone = (id: string) => logging.isDone(id, week);
  const progress = logging.dayProgress(day, week);

  // A deload week is no baseline either: beating it says nothing.
  const prev = logging.previousSetsFor(exercise.id, week);
  const previous = prev != null && weekByNumber(program, prev.week)?.is_deload === true ? null : prev;

  const highlight = undoOnly
    ? null
    : checkHighlight({
        sets: logging.setsFor(exercise.id, week),
        previous,
        prescribedSets: p.sets,
        isDeload: weekRow?.is_deload === true,
        // The day modal's rule on the day modal's logs, so the two agree.
        record: exerciseRecord({
          exerciseId: exercise.id,
          week,
          logs: dayRecordLogs(day, exercise.id, week, logging.setLogs),
          nameOf: exerciseNames(program),
        }),
      });

  const next = undoOnly ? null : nextExercise(day, exercise.id, isDone);
  const nextName = next != null ? effectivePrescription(next.exercise, weekRow, week).name : null;
  const nextLabel =
    next == null
      ? null
      : next.slot != null
        ? t("checkCard.nextSuperset", { slot: next.slot, name: nextName })
        : t("checkCard.next", { name: nextName });
  // Mid-superset the partner comes first; the rest is after the round.
  const partnerNext =
    next != null &&
    next.slot != null &&
    exercise.superset_group != null &&
    next.exercise.superset_group === exercise.superset_group;
  const restSeconds = p.restSeconds ?? 0;
  const showRest = !undoOnly && restSeconds > 0 && !rest.running && !partnerNext;

  const undo = () => {
    checkCard.dismiss();
    void logging.setCompletion(exercise.id, week, false);
  };
  // Opens the next exercise and starts nothing (no clock, no rest).
  const openNext = () => {
    if (next == null) return;
    checkCard.dismiss();
    exerciseSession.open(next.exercise.id, week);
  };

  return (
    <View className="gap-2.5">
      <CardHeader title={p.name} onUndo={undo} />

      {/* The day so far: one segment per exercise, in the day's order. */}
      <View className="flex-row items-center gap-2 pl-[34px]">
        <View className="flex-1 flex-row gap-1">
          {day.program_exercises.map((e) => (
            <View
              key={e.id}
              className="h-1.5 flex-1"
              style={{
                backgroundColor: isDone(e.id) ? colors.success : colors.border,
                transform: [{ skewX: "-8deg" }],
              }}
            />
          ))}
        </View>
        <Text className="text-[12px] font-bold text-content-secondary" style={TABULAR}>
          {t("checkCard.progress", { done: progress.done, total: progress.total })}
        </Text>
        {card.seconds != null && card.seconds > 0 && (
          <Text className="text-[12px] text-content-tertiary" style={TABULAR}>
            {t("checkCard.time", { time: formatClock(card.seconds) })}
          </Text>
        )}
      </View>

      {highlight != null && <HighlightLine highlight={highlight} />}

      {(nextLabel != null || showRest) && (
        <View className="flex-row items-center gap-2">
          {nextLabel != null && <NextButton label={nextLabel} onPress={openNext} />}
          {showRest && (
            <Pressable
              onPress={() => rest.start(restSeconds, p.name)}
              accessibilityRole="button"
              accessibilityLabel={t("program.restStart", { seconds: restSeconds, name: p.name })}
              hitSlop={6}
              className="flex-row items-center gap-1.5 rounded-lg border px-3 py-2"
              style={{ borderColor: colors.border }}
            >
              <Ionicons name="play-circle" size={17} color={colors.brandSecondary} />
              <Text className="text-[13px] font-bold text-brand-secondary" style={TABULAR}>
                {t("checkCard.rest", { time: formatClock(restSeconds) })}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

/** Checks in quick succession (logging after the fact): just the count. */
function BatchCard({
  items,
  program,
}: {
  items: { exerciseId: string; week: number }[];
  program: ProgramWithDetails;
}) {
  const { t } = useTranslation();
  const logging = useProgramLogging(program);
  const undo = () => {
    checkCard.dismiss();
    // One at a time, like the day's mark-all.
    void (async () => {
      for (const item of items) await logging.setCompletion(item.exerciseId, item.week, false);
    })();
  };
  return <CardHeader title={t("checkCard.batch", { count: items.length })} onUndo={undo} />;
}

/** A day's last exercise re-checked after its celebration already played. */
function DayAgainCard({
  card,
  program,
}: {
  card: Extract<CheckCardState, { kind: "dayAgain" }>;
  program: ProgramWithDetails;
}) {
  const { t } = useTranslation();
  const logging = useProgramLogging(program);
  const day = program.program_days.find((d) => d.id === card.dayId);
  if (day == null) return null;
  const undo = () => {
    checkCard.dismiss();
    void logging.setCompletion(card.exerciseId, card.week, false);
  };
  return <CardHeader title={t("checkCard.dayAgain", { n: day.day_index })} onUndo={undo} />;
}

/** The check, what was done, and «Deshacer», which every card has. */
function CardHeader({ title, onUndo }: { title: string; onUndo: () => void }) {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <View className="flex-row items-center gap-2.5">
      <View className="h-6 w-6 items-center justify-center rounded-full bg-success">
        <Ionicons name="checkmark" size={15} color={colors.white} />
      </View>
      <Text className="min-w-0 flex-1 text-[14px] font-semibold text-content-primary" numberOfLines={1}>
        {title}
      </Text>
      <Pressable
        onPress={onUndo}
        accessibilityRole="button"
        hitSlop={8}
        className="flex-row items-center gap-1 rounded-lg px-2 py-1.5"
      >
        <Ionicons name="arrow-undo" size={14} color={colors.contentSecondary} />
        <Text className="text-[12px] font-semibold text-content-secondary">{t("checkCard.undo")}</Text>
      </Pressable>
    </View>
  );
}

/** Record, better than last time, or all sets done; never a negative comparison. */
function HighlightLine({ highlight }: { highlight: CheckHighlight }) {
  const { t } = useTranslation();
  const colors = useColors();
  const unit = useWeightUnit();
  const record = highlight.kind === "record";
  const text =
    highlight.kind === "record"
      ? t("checkCard.record", {
          weight: `${kgToUnit1(highlight.weight, unit)} ${unit}`,
          reps: highlight.reps,
        })
      : highlight.kind === "moreKg"
        ? t("checkCard.moreKg", { kg: `${kgToUnit1(highlight.kg, unit)} ${unit}`, w: highlight.week })
        : highlight.kind === "moreReps"
          ? t("checkCard.moreReps", { reps: highlight.reps, w: highlight.week })
          : t("checkCard.allSets", { done: highlight.done, total: highlight.total });
  return (
    <View
      className="ml-[34px] flex-row items-center gap-1.5 self-start rounded-lg px-2.5 py-1"
      style={{ backgroundColor: record ? colors.brandAccentSoft : colors.successSoft }}
    >
      <Ionicons
        name={record ? "trophy" : highlight.kind === "allSets" ? "checkmark-done" : "trending-up"}
        size={14}
        color={record ? colors.brandAccent : colors.success}
      />
      <Text
        className={record ? "text-[13px] font-bold text-brand-accent" : "text-[13px] font-bold text-success"}
        style={TABULAR}
      >
        {text}
      </Text>
    </View>
  );
}

/** «Siguiente»: the poster's red skewed block, one line however long the name. */
function NextButton({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" className="min-w-0 flex-1">
      {/* Skew on a nested view: PressableScale's press style owns `transform`. */}
      <View className="bg-brand-primary px-3.5 py-2.5" style={{ transform: [{ skewX: "-10deg" }] }}>
        <View
          className="flex-row items-center justify-center gap-1.5"
          style={{ transform: [{ skewX: "10deg" }] }}
        >
          <Text
            className="shrink text-[12px] font-extrabold uppercase text-white"
            style={{ letterSpacing: 1.2 }}
            numberOfLines={1}
          >
            {label}
          </Text>
          <Ionicons name="arrow-forward" size={14} color={colors.white} />
        </View>
      </View>
    </PressableScale>
  );
}
