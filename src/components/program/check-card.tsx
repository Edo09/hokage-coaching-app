import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BackHandler, PanResponder, StyleSheet } from "react-native";
import {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { DemoMedia } from "@/src/components/program/demo-media";
import { useProgram } from "@/src/hooks/use-program";
import { useProgramLogging } from "@/src/hooks/use-program-logging";
import { checkCard, type CheckCardState, useCheckCard } from "@/src/lib/check-card";
import { exerciseSession, useExerciseSession } from "@/src/lib/exercise-session";
import {
  DUR,
  EASE_OUT,
  enterFade,
  exit,
  modalEnter,
  modalExit,
  PressableScale,
  Swap,
} from "@/src/lib/motion";
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

/** A drag down this far (px), or a flick this fast (px/ms), swipes it away. */
const SWIPE_CLOSE_PX = 40;
const SWIPE_CLOSE_VY = 0.5;
/** The next exercise's demo: short enough that the card fits a small phone. */
const NEXT_DEMO_H = 168;

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
 * in the tabs layout, so it shows over whichever tab the check came from. A
 * small dialog in the middle of the screen, over a dimmed backdrop that
 * covers the tab bar and the rest and session bars too. Up until the client
 * closes it: its ✕, a tap on the backdrop, Android back or a swipe down.
 */
export function CheckCardHost() {
  const card = useCheckCard();
  const session = useExerciseSession();
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

  // Android back closes the card instead of leaving the screen under it.
  const shown = card != null && program != null && renderable(card, program);
  useEffect(() => {
    if (!shown) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      checkCard.dismiss({ keepRun: true });
      return true;
    });
    return () => sub.remove();
  }, [shown]);

  return (
    // Over everything the tabs layout draws (the bars sit at zIndex 50).
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 60 }]}>
      {card != null && program != null && renderable(card, program) && (
        <CheckCardFrame card={card} program={program} />
      )}
    </View>
  );
}

/**
 * A dialog in the middle of the screen: it fades in while growing over a
 * dimmed backdrop. It never closes by itself; the client closes it with its
 * ✕, a tap on the backdrop or a swipe down. No haptic: the check already
 * gave one.
 */
function CheckCardFrame({ card, program }: { card: CheckCardState; program: ProgramWithDetails }) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const drag = useSharedValue(0);

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

  const close = () => checkCard.dismiss({ keepRun: true });

  return (
    <>
      {/* Dims the screen, like the day modal; a tap on it closes the card. */}
      <AnimatedView
        entering={reduced ? undefined : enterFade()}
        exiting={reduced ? undefined : exit()}
        style={StyleSheet.absoluteFill}
      >
        <Pressable
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }}
        />
      </AnimatedView>
      {/* Entrance and exit on this full-screen layer: its centre is the
          card's, so it scales in place, and the drag owns the card's own
          transform. Taps beside the card fall through to the backdrop. */}
      <AnimatedView
        pointerEvents="box-none"
        entering={reduced ? undefined : modalEnter()}
        exiting={reduced ? undefined : modalExit()}
        style={StyleSheet.absoluteFill}
        className="items-center justify-center px-5"
      >
        <AnimatedView
          {...pan.panHandlers}
          testID="check-card"
          style={dragStyle}
          accessibilityViewIsModal
          accessibilityLiveRegion="polite"
          className="w-full max-w-[360px] overflow-hidden rounded-2xl border border-border bg-surface p-4"
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
    </>
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
  const nextDemo = next?.exercise.exercise?.video_url || null;
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
    <View className="gap-3">
      <CardHeader title={p.name} />

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

      {/* What comes next, playing: a tap opens it, like «Siguiente» (which
          screen readers use; the demo is only a picture to them). */}
      {nextDemo != null && (
        <Pressable onPress={openNext} accessible={false}>
          <View pointerEvents="none">
            <DemoMedia key={nextDemo} uri={nextDemo} height={NEXT_DEMO_H} />
          </View>
        </Pressable>
      )}

      {/* Its own row, so the next exercise's name reads in full. */}
      {nextLabel != null && <NextButton label={nextLabel} onPress={openNext} />}

      <View className="flex-row items-center gap-2">
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
        <UndoButton onPress={undo} />
      </View>
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
  return (
    <View className="gap-3">
      <CardHeader title={t("checkCard.batch", { count: items.length })} />
      <View className="flex-row">
        <UndoButton onPress={undo} />
      </View>
    </View>
  );
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
  return (
    <View className="gap-3">
      <CardHeader title={t("checkCard.dayAgain", { n: day.day_index })} />
      <View className="flex-row">
        <UndoButton onPress={undo} />
      </View>
    </View>
  );
}

/**
 * The check and what was done (two lines, so a long name still reads), and
 * the ✕ that closes the card: it doesn't close by itself.
 */
function CardHeader({ title }: { title: string }) {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <View className="flex-row items-center gap-2.5">
      <View className="h-6 w-6 items-center justify-center rounded-full bg-success">
        <Ionicons name="checkmark" size={15} color={colors.white} />
      </View>
      <Text className="min-w-0 flex-1 text-[15px] font-semibold text-content-primary" numberOfLines={2}>
        {title}
      </Text>
      <Pressable
        onPress={() => checkCard.dismiss({ keepRun: true })}
        accessibilityRole="button"
        accessibilityLabel={t("common.close")}
        hitSlop={10}
        className="-mr-1 h-8 w-8 items-center justify-center self-start rounded-full"
      >
        <Ionicons name="close" size={20} color={colors.contentSecondary} />
      </Pressable>
    </View>
  );
}

/** «Deshacer», which every card has, at the end of its bottom row. */
function UndoButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      hitSlop={8}
      className="ml-auto flex-row items-center gap-1 rounded-lg px-2 py-1.5"
    >
      <Ionicons name="arrow-undo" size={14} color={colors.contentSecondary} />
      <Text className="text-[12px] font-semibold text-content-secondary">{t("checkCard.undo")}</Text>
    </Pressable>
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

/** «Siguiente»: the poster's red skewed block, full width; a long name takes a second line. */
function NextButton({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" className="w-full">
      {/* Skew on a nested view: PressableScale's press style owns `transform`. */}
      <View className="bg-brand-primary px-4 py-3" style={{ transform: [{ skewX: "-10deg" }] }}>
        <View
          className="flex-row items-center justify-center gap-1.5"
          style={{ transform: [{ skewX: "10deg" }] }}
        >
          <Text
            className="shrink text-center text-[12px] font-extrabold uppercase text-white"
            style={{ letterSpacing: 1.2 }}
            numberOfLines={2}
          >
            {label}
          </Text>
          <Ionicons name="arrow-forward" size={14} color={colors.white} />
        </View>
      </View>
    </PressableScale>
  );
}
