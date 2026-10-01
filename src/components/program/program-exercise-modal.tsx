import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Modal,
  Platform,
  type ScrollView as RNScrollView,
  TextInput,
  useWindowDimensions,
  type View as RNView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LockNote } from "@/src/components/program/lock-note";
import { RestButton } from "@/src/components/program/program-exercise-row";
import { ProgramSetLogger } from "@/src/components/program/program-set-logger";
import { RestTimerBar } from "@/src/components/program/rest-timer-bar";
import { Burst, CapsLabel, ExpandChevron, PosterText } from "@/src/components/ui";
import { useKeyboardHeight } from "@/src/hooks/use-keyboard-height";
import type { useProgramLogging } from "@/src/hooks/use-program-logging";
import { PressableScale, Reveal, usePop } from "@/src/lib/motion";
import { formatClock } from "@/src/providers/rest-timer-provider";
import { useColors } from "@/src/theme/colors";
import { Pressable, ScrollView, Text, View } from "@/src/tw";
import { AnimatedView } from "@/src/tw/animated";
import type { ProgramExercise, ProgramWeek } from "@/src/types/database";
import type { NextExercise } from "@/src/utils/check-card";
import {
  effectivePrescription,
  formatLoadPct,
  formatReps,
  formatRir,
  type WeekLock,
} from "@/src/utils/program";

const TABULAR = { fontVariant: ["tabular-nums" as const] };

/** How much of the sheet stays visible above a focused input (about a row). */
const REVEAL_CONTEXT = 56;
/** Below this much time on the clock, quitting doesn't ask first. */
const QUIT_CONFIRM_MS = 10_000;
/** Let the finish burst play before the sheet slides away. */
const FINISH_SETTLE_MS = 320;

/** GIF/WebP demos are animated images (expo-image); anything else is video. */
const isImageDemo = (uri: string): boolean => /\.(gif|apng|webp|png|jpe?g)$/i.test(uri.split("?")[0]);

type Props = {
  exercise: ProgramExercise | null;
  week: ProgramWeek | null;
  weekNumber: number;
  /** "Solo semana actual": set while the week isn't open yet, and the sheet
      is view only. Always null for free programs. */
  lock: WeekLock | null;
  logging: ReturnType<typeof useProgramLogging>;
  /** In progress (timed). False: not started yet, or done (review). */
  timed: boolean;
  /** Time on its clock: running, or banked from an earlier stretch. */
  elapsedMs: number;
  running: boolean;
  /** "Empezar" / "Continuar": start (or resume) this exercise's clock. */
  onStart: () => void;
  /** Close; an exercise in progress stays in progress, in the bar. */
  onHide: () => void;
  onTogglePause: () => void;
  /** Mark done and keep the time. */
  onFinish: () => void;
  /** Leave without marking done; the time is dropped. */
  onQuit: () => void;
  /** The day's next exercise to do, offered as «Siguiente →» once this one
      is done; null hides it. */
  next: NextExercise | null;
  /** Open `next` in this sheet. Starts nothing. */
  onNext: () => void;
  /** Full-screen demo. */
  onPlay: (uri: string) => void;
};

/**
 * An exercise's sheet: the demo playing, how to do it, the rest timer and the
 * set logger. Three states:
 *  - not started: "Empezar" (or "Continuar", with time already on it) starts
 *    its clock; "Marcar hecho" checks it off without one;
 *  - in progress: its clock, and the controls to pause, hide (to the bar),
 *    finish or quit it;
 *  - done: review, with the done toggle and «Siguiente →» to the day's
 *    next exercise.
 * On a locked week ("Solo semana actual") it is view only: a note says when
 * the week opens in place of the done/start buttons, the sets can't be
 * edited, and a clock already running on it can only be quit.
 * State lives in `@/src/lib/exercise-session`; this only renders it.
 */
export function ProgramExerciseModal({
  exercise,
  week,
  weekNumber,
  lock,
  logging,
  timed,
  elapsedMs,
  running,
  onStart,
  onHide,
  onTogglePause,
  onFinish,
  onQuit,
  next,
  onNext,
  onPlay,
}: Props) {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboard = useKeyboardHeight();
  const scrollRef = useRef<RNScrollView>(null);
  const contentRef = useRef<RNView>(null);

  // Scroll the focused set input into view, with a row of context above it.
  // Runs a frame later, once the sheet has re-laid out above the keyboard.
  const revealFocused = useCallback(() => {
    if (Platform.OS === "web") return;
    requestAnimationFrame(() => {
      const input = TextInput.State.currentlyFocusedInput();
      const scroll = scrollRef.current;
      const content = contentRef.current;
      if (input == null || scroll == null || content == null) return;
      input.measureLayout(
        content,
        (_x, y) => scroll.scrollTo({ y: Math.max(0, y - REVEAL_CONTEXT), animated: true }),
        () => {},
      );
    });
  }, []);

  // The keyboard just opened (or changed size): the sheet shrank under the
  // focused input.
  useEffect(() => {
    if (keyboard > 0) revealFocused();
  }, [keyboard, revealFocused]);

  const p = exercise != null ? effectivePrescription(exercise, week, weekNumber) : null;
  const done = exercise != null && logging.isDone(exercise.id, weekNumber);
  const videoUrl = exercise?.exercise?.video_url ?? null;
  const hasVideo = videoUrl != null && videoUrl !== "";

  // Step-by-step "how to" in the app language, falling back to the other.
  const cat = exercise?.exercise;
  const steps =
    (i18n.language === "es" ? cat?.instructions_es : cat?.instructions_en) ??
    cat?.instructions_en ??
    cat?.instructions_es ??
    null;
  // Open by default for each exercise; tap the header to fold it. Kept as
  // "folded for which exercise" so the next exercise opens unfolded again
  // (the sheet stays mounted between exercises).
  const [foldedFor, setFoldedFor] = useState<string | null>(null);
  const showSteps = exercise != null && foldedFor !== exercise.id;
  const setShowSteps = (toggle: (open: boolean) => boolean) =>
    setFoldedFor(toggle(showSteps) ? null : (exercise?.id ?? null));

  const loadPct = p != null ? formatLoadPct(p) : null;
  const rir = p != null ? formatRir(p) : null;
  const qual =
    p != null && p.loadPct == null && p.loadQualitative != null
      ? t(`program.load_${p.loadQualitative}`)
      : null;

  const clock = formatClock(Math.floor(elapsedMs / 1000));

  // «Marcar hecho» on the day's last exercise: its burst plays before the
  // write, since the day-complete stamp closes the sheet (as on «Terminar»).
  const finishesDay = exercise != null && logging.completesDay(exercise.id, weekNumber);
  const nextName = next != null ? effectivePrescription(next.exercise, week, weekNumber).name : null;
  // The next exercise opens at the top of its sheet (its demo), not scrolled
  // down to where this one's sets were.
  const goNext = () => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    onNext();
  };

  const confirmQuit = () => {
    if (p == null) return;
    if (elapsedMs < QUIT_CONFIRM_MS) {
      onQuit();
      return;
    }
    const title = t("program.sessionQuitTitle", { name: p.name });
    const body = t("program.sessionQuitBody", { time: clock });
    // Alert.alert is a no-op on web.
    if (Platform.OS === "web") {
      if (typeof globalThis.confirm === "function" && globalThis.confirm(`${title}\n\n${body}`)) onQuit();
      return;
    }
    Alert.alert(title, body, [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("program.sessionQuit"), style: "destructive", onPress: onQuit },
    ]);
  };

  return (
    <Modal
      visible={exercise != null}
      animationType="slide"
      transparent
      // Full screen on Android too, so the sheet's bottom is the screen's
      // bottom — what the keyboard height is measured from.
      statusBarTranslucent
      navigationBarTranslucent
      // Back button / backdrop hide rather than quit: the clock keeps going.
      onRequestClose={onHide}
    >
      <Pressable
        onPress={onHide}
        accessibilityLabel={t(timed ? "program.sessionHide" : "common.close")}
        className="flex-1"
        style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      />
      {/* Sits on the keyboard while it's up, and shrinks to the space above
          it (the set logger scrolls). */}
      <View className="absolute inset-x-0" style={{ bottom: keyboard }}>
        <View
          className="rounded-t-3xl bg-surface"
          style={{
            paddingBottom: keyboard > 0 ? 12 : insets.bottom + 12,
            maxHeight: keyboard > 0 ? windowHeight - keyboard - insets.top - 12 : windowHeight * 0.9,
          }}
        >
          <View className="items-center pt-2.5">
            <View className="h-1 w-10 rounded-full bg-border-strong" />
          </View>
          {p != null && exercise != null && (
            <>
              {/* Name + prescription; hide on the right. */}
              <View className="flex-row items-start gap-3 px-5 pt-3 pb-2">
                <View className="flex-1">
                  <Text className="text-lg font-bold text-content-primary">{p.name}</Text>
                  <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1 pt-1.5">
                    <Text className="text-[15px] font-semibold text-content-secondary" style={TABULAR}>
                      {p.isUnilateral
                        ? t("program.setsRepsPerSide", { sets: p.sets, reps: formatReps(p.repMin, p.repMax) })
                        : t("program.setsReps", { sets: p.sets, reps: formatReps(p.repMin, p.repMax) })}
                    </Text>
                    {loadPct != null && <Chip tone="info">{loadPct}</Chip>}
                    {qual != null && <Chip tone="muted">{qual}</Chip>}
                    {rir != null && <Chip tone="accent">{rir}</Chip>}
                  </View>
                </View>
                <Pressable
                  onPress={onHide}
                  accessibilityRole="button"
                  accessibilityLabel={t(timed ? "program.sessionHide" : "common.close")}
                  hitSlop={8}
                  className="h-9 w-9 items-center justify-center rounded-full bg-brand-dark"
                >
                  <Ionicons name={timed ? "chevron-down" : "close"} size={20} color={colors.contentSecondary} />
                </Pressable>
              </View>

              {/* The clock: time on this exercise, and pause/resume. */}
              {timed && (
                <View className="flex-row items-center gap-3 px-5 pb-2">
                  <View className="flex-1">
                    <PosterText size={34} tabular>
                      {clock}
                    </PosterText>
                    <View className="flex-row items-center gap-1.5">
                      <View
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: running ? colors.brandPrimary : colors.warning }}
                      />
                      <CapsLabel size={9.5} em={0.14} className="text-content-tertiary">
                        {t(running ? "program.sessionRunning" : "program.sessionPaused")}
                      </CapsLabel>
                    </View>
                  </View>
                  {/* No pause/resume on a locked week: the clock can only be quit. */}
                  {lock == null && (
                    <Pressable
                      onPress={onTogglePause}
                      accessibilityRole="button"
                      accessibilityLabel={t(running ? "program.sessionPause" : "program.sessionResume")}
                      hitSlop={6}
                      className="h-12 w-12 items-center justify-center rounded-full border-2 border-border-strong"
                    >
                      <Ionicons name={running ? "pause" : "play"} size={20} color={colors.contentPrimary} />
                    </Pressable>
                  )}
                </View>
              )}

              {(p.tempo != null || p.restSeconds != null || p.notes != null) && (
                <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1.5 px-5 pb-1">
                  {p.tempo != null && (
                    <Meta icon="time-outline">{t("program.tempoLabel", { tempo: p.tempo })}</Meta>
                  )}
                  {p.restSeconds != null && <RestButton seconds={p.restSeconds} name={p.name} />}
                  {p.notes != null && p.notes !== "" && (
                    <Text className="text-xs text-content-tertiary">{p.notes}</Text>
                  )}
                </View>
              )}

              <ScrollView
                ref={scrollRef}
                // RN's prop type predates React 19's nullable RefObject.
                innerViewRef={contentRef as React.RefObject<RNView>}
                className="px-5"
                contentContainerClassName="gap-3 pt-2 pb-3"
                keyboardShouldPersistTaps="handled"
              >
                {hasVideo && <DemoMedia key={videoUrl} uri={videoUrl} onExpand={onPlay} />}

                {steps != null && steps.length > 0 && (
                  <View className="rounded-2xl border border-border bg-brand-dark p-3.5">
                    <Pressable
                      onPress={() => setShowSteps((v) => !v)}
                      accessibilityRole="button"
                      accessibilityLabel={t("program.howTo")}
                      accessibilityState={{ expanded: showSteps }}
                      className="flex-row items-center justify-between"
                    >
                      <Text
                        className="text-[11px] font-bold uppercase text-content-tertiary"
                        style={{ letterSpacing: 0.6 }}
                      >
                        {t("program.howTo")}
                      </Text>
                      <View className="flex-row items-center gap-1.5">
                        <Text className="text-[11px] font-semibold text-content-muted" style={TABULAR}>
                          {steps.length}
                        </Text>
                        <ExpandChevron open={showSteps} size={16} color={colors.contentMuted} />
                      </View>
                    </Pressable>
                    <Reveal open={showSteps} className="gap-2 pt-3">
                      {steps.map((step, i) => (
                        <View key={i} className="flex-row gap-2.5">
                          <View className="mt-0.5 h-5 w-5 items-center justify-center rounded-full bg-brand-primary-soft">
                            <Text className="text-[11px] font-bold text-brand-primary" style={TABULAR}>
                              {i + 1}
                            </Text>
                          </View>
                          <Text className="flex-1 text-[13px] leading-[19px] text-content-secondary">
                            {step}
                          </Text>
                        </View>
                      ))}
                    </Reveal>
                  </View>
                )}

                {/* Keyed so each exercise-week gets fresh rows: they seed
                    their inputs from `logged` once, and would otherwise show
                    (and save on blur) the last exercise's numbers. */}
                <ProgramSetLogger
                  key={`${exercise.id}|${weekNumber}`}
                  prescribedSets={p.sets}
                  repMin={p.repMin}
                  repMax={p.repMax}
                  rirMin={p.rirMin}
                  rirMax={p.rirMax}
                  logged={logging.setsFor(exercise.id, weekNumber)}
                  previous={logging.previousSetsFor(exercise.id, weekNumber)}
                  onLogSet={(setIndex, input) =>
                    logging.logSet(exercise.id, weekNumber, setIndex, input)
                  }
                  onInputFocus={revealFocused}
                  readOnly={lock != null}
                />
              </ScrollView>

              {/* The floating rest bar is under this modal; show it here. */}
              <RestTimerBar inline />

              {/* A locked week: in place of check/undo/start, when it opens.
                  A clock already running on it (the coach switched the lock
                  on, or moved the start) keeps only Salir below. */}
              {lock != null && <LockNote lock={lock} className="mx-5 mt-2 py-3" />}

              {(timed || lock == null) && (
                <View className="flex-row gap-3 px-5 pt-2">
                  {timed ? (
                    <>
                      <PressableScale
                        scaleTo={0.98}
                        onPress={confirmQuit}
                        accessibilityRole="button"
                        accessibilityLabel={t("program.sessionQuit")}
                        className="flex-1 flex-row items-center justify-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3.5"
                      >
                        <Ionicons name="exit-outline" size={19} color={colors.contentSecondary} />
                        <Text className="text-base font-semibold text-content-primary">
                          {t("program.sessionQuit")}
                        </Text>
                      </PressableScale>
                      {lock == null && (
                        <DoneButton
                          done={false}
                          label={t("program.sessionFinish")}
                          settleMs={FINISH_SETTLE_MS}
                          onPress={onFinish}
                          className="flex-[2]"
                        />
                      )}
                    </>
                  ) : done ? (
                    <>
                      <DoneButton
                        done
                        onPress={() => void logging.setCompletion(exercise.id, weekNumber, false)}
                        className="flex-1"
                      />
                      {/* The day's next one (a superset's partner first):
                          opens it here and starts nothing. */}
                      {next != null && nextName != null && (
                        <PressableScale
                          scaleTo={0.98}
                          haptic
                          onPress={goNext}
                          accessibilityRole="button"
                          accessibilityLabel={
                            next.slot != null
                              ? t("checkCard.nextSuperset", { slot: next.slot, name: nextName })
                              : t("checkCard.next", { name: nextName })
                          }
                          className="flex-[2] flex-row items-center justify-center gap-2 rounded-2xl bg-brand-primary px-4 py-3.5"
                        >
                          <Text className="text-base font-bold text-white">{t("checkCard.sheetNext")}</Text>
                        </PressableScale>
                      )}
                    </>
                  ) : (
                    <>
                      {/* Done without the clock (e.g. trained earlier, logging now). */}
                      <DoneButton
                        done={false}
                        tone="secondary"
                        label={t("program.markDoneShort")}
                        settleMs={finishesDay ? FINISH_SETTLE_MS : 0}
                        onPress={() => void logging.setCompletion(exercise.id, weekNumber, true)}
                        className="flex-1"
                      />
                      <PressableScale
                        scaleTo={0.98}
                        haptic
                        onPress={onStart}
                        accessibilityRole="button"
                        className="flex-[2] flex-row items-center justify-center gap-2 rounded-2xl bg-brand-primary px-4 py-3.5"
                      >
                        <Ionicons name="play" size={18} color={colors.white} />
                        <Text className="text-base font-bold text-white" style={TABULAR}>
                          {elapsedMs >= 1000
                            ? t("program.sessionContinue", { time: clock })
                            : t("program.sessionStart")}
                        </Text>
                      </PressableScale>
                    </>
                  )}
                </View>
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

/** The demo, playing in the sheet; the corner button opens it full screen. */
function DemoMedia({ uri, onExpand }: { uri: string; onExpand: (uri: string) => void }) {
  const { t } = useTranslation();
  const image = isImageDemo(uri);
  return (
    <View
      className="overflow-hidden rounded-2xl"
      // The catalog's GIFs are drawn on white; videos letterbox on black.
      style={{ height: 200, backgroundColor: image ? "#ffffff" : "#000000" }}
    >
      {image ? (
        <Image
          source={{ uri }}
          style={{ width: "100%", height: "100%" }}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={150}
        />
      ) : (
        <InlineVideo uri={uri} />
      )}
      <Pressable
        onPress={() => onExpand(uri)}
        accessibilityRole="button"
        accessibilityLabel={t("program.demoFullScreen")}
        hitSlop={6}
        className="absolute right-2 top-2 h-9 w-9 items-center justify-center rounded-full"
        style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
      >
        <Ionicons name="expand" size={17} color="#ffffff" />
      </Pressable>
    </View>
  );
}

/** Muted and looping, like the GIF demos; controls live in full screen. */
function InlineVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return (
    <VideoView
      style={{ width: "100%", height: "100%" }}
      player={player}
      contentFit="contain"
      nativeControls={false}
    />
  );
}

/**
 * Done/finish, and the moment of doing it: the check pops with impact lines
 * and a haptic. `settleMs` holds the action back so the burst is seen before
 * the sheet closes on it.
 */
function DoneButton({
  done,
  onPress,
  label,
  settleMs = 0,
  tone = "primary",
  className,
}: {
  done: boolean;
  onPress: () => void;
  label?: string;
  settleMs?: number;
  /** Not-done look: red (primary) or outlined (secondary, next to "Empezar"). */
  tone?: "primary" | "secondary";
  className?: string;
}) {
  const outlined = done || tone === "secondary";
  const { t } = useTranslation();
  const colors = useColors();
  const check = usePop();
  const [burst, setBurst] = useState(0);
  // One press per settle: a second tap mid-burst mustn't finish twice.
  const pending = useRef(false);

  return (
    <PressableScale
      scaleTo={0.98}
      onPress={() => {
        if (pending.current) return;
        if (!done) {
          check.pop();
          setBurst((n) => n + 1);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        } else {
          Haptics.selectionAsync().catch(() => {});
        }
        if (settleMs > 0) {
          pending.current = true;
          setTimeout(() => {
            pending.current = false;
            onPress();
          }, settleMs);
        } else {
          onPress();
        }
      }}
      accessibilityRole="button"
      className={[
        outlined
          ? "flex-row items-center justify-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3.5"
          : "flex-row items-center justify-center gap-2 rounded-2xl bg-brand-primary px-5 py-3.5",
        className ?? "",
      ].join(" ")}
    >
      <View className="h-5 w-5 items-center justify-center">
        <Burst play={burst} from={13} to={22} colors={[colors.success, colors.contentPrimary]} />
        <AnimatedView style={check.style}>
          <Ionicons
            name={done ? "checkmark-circle" : "ellipse-outline"}
            size={20}
            color={done ? colors.success : outlined ? colors.contentSecondary : colors.white}
          />
        </AnimatedView>
      </View>
      <Text className={outlined ? "text-base font-semibold text-content-primary" : "text-base font-semibold text-white"}>
        {label ?? t(done ? "program.markedDone" : "program.markDoneCta")}
      </Text>
    </PressableScale>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone: "info" | "accent" | "muted" }) {
  const cls =
    tone === "info" ? "bg-info-soft" : tone === "accent" ? "bg-brand-accent-soft" : "bg-surface-elevated";
  const textCls =
    tone === "info"
      ? "text-brand-secondary"
      : tone === "accent"
        ? "text-brand-accent"
        : "text-content-tertiary";
  return (
    <View className={`rounded-md px-2 py-0.5 ${cls}`}>
      <Text className={`text-xs font-semibold ${textCls}`} style={TABULAR}>
        {children}
      </Text>
    </View>
  );
}

function Meta({
  icon,
  children,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View className="flex-row items-center gap-1">
      <Ionicons name={icon} size={12} color={colors.contentMuted} />
      <Text className="text-xs text-content-tertiary">{children}</Text>
    </View>
  );
}
