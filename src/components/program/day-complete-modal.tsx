import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "react-native";
import Body, { type ExtendedBodyPart } from "react-native-body-highlighter";
import {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { type DrawnGroup, GROUP_SLUGS, NON_MUSCLE } from "@/src/components/progress/muscle-heat-map";
import { Burst, CapsLabel, Card, PosterText, SkewButton } from "@/src/components/ui";
import { useAuth } from "@/src/hooks/use-auth";
import { useProfile } from "@/src/hooks/use-profile";
import { useProgramLogging } from "@/src/hooks/use-program-logging";
import { exerciseSession } from "@/src/lib/exercise-session";
import { DUR, EASE_IN, EASE_OUT } from "@/src/lib/motion";
import { kgToUnit, kgToUnit1, useWeightUnit } from "@/src/lib/weight-unit";
import type { DayCelebration } from "@/src/providers/celebration-context";
import { useColors } from "@/src/theme/colors";
import { Pressable, ScrollView, Text, View } from "@/src/tw";
import { AnimatedView } from "@/src/tw/animated";
import type {
  ProgramDayWithExercises,
  ProgramWeek,
  ProgramWithDetails,
  WorkoutSetLog,
} from "@/src/types/database";
import { formatShortDate } from "@/src/utils/dates";
import { dayLabel } from "@/src/utils/day-label";
import { effectivePrescription, weekByNumber, weekOpensOn } from "@/src/utils/program";
import { muscleGroupForBodyPart } from "@/src/utils/progress";
import { dayRecords } from "@/src/utils/records";

/** When the seal hits the card: the card's entrance, then the stamp's fall. */
const STAMP_DELAY = 160;
const STAMP_MS = 200;
const IMPACT_MS = STAMP_DELAY + STAMP_MS;

type Props = {
  day: DayCelebration;
  /** New for every celebration; replays the impact lines. */
  openId: number;
  visible: boolean;
  onClose: () => void;
};

/**
 * "Sellado": the client finished every exercise of a program day, and the
 * day gets stamped. One orchestrated moment (the card rises, a red seal
 * slams onto it, impact lines fly off, a success haptic), then a quiet
 * summary of what they did and what comes next.
 */
export function DayCompleteModal({ day: celebration, openId, visible, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const unit = useWeightUnit();
  const { user } = useAuth();
  const { profile } = useProfile(user?.id);
  const { program, dayId, week } = celebration;
  const logging = useProgramLogging(program);
  const reduced = useReducedMotion();

  const enter = useSharedValue(0);
  const stamp = useSharedValue(0);
  const thud = useSharedValue(0);

  useEffect(() => {
    if (!visible) {
      // Fade the card out with the backdrop; the next opening starts clear.
      enter.set(withTiming(0, { duration: DUR.fast, easing: EASE_IN }));
      return;
    }
    if (reduced) {
      enter.set(1);
      stamp.set(1);
    } else {
      stamp.set(0);
      enter.set(withTiming(1, { duration: DUR.base, easing: EASE_OUT }));
      // The stamp accelerates in (ease-in): it lands, it doesn't glide.
      stamp.set(withDelay(STAMP_DELAY, withTiming(1, { duration: STAMP_MS, easing: EASE_IN })));
      thud.set(
        withDelay(
          IMPACT_MS,
          withSequence(
            withTiming(1, { duration: 50 }),
            withTiming(0, { duration: 160, easing: EASE_OUT }),
          ),
        ),
      );
    }
    const haptic = setTimeout(
      () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
      reduced ? 0 : IMPACT_MS,
    );
    return () => clearTimeout(haptic);
  }, [visible, reduced, enter, stamp, thud]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: enter.get(),
    transform: [{ scale: 0.94 + 0.06 * enter.get() }, { translateY: 4 * thud.get() }],
  }));
  const sealStyle = useAnimatedStyle(() => {
    const s = stamp.get();
    return {
      opacity: Math.min(1, s * 3),
      transform: [{ rotate: `${-18 + 10 * s}deg` }, { scale: 2.2 - 1.2 * s }],
    };
  });

  const day = program.program_days.find((d) => d.id === dayId);
  if (day == null) return null;

  const locale = i18n.language === "es" ? "es-ES" : "en-US";
  const title = dayTitle(day, t);
  const summary = daySummary(program, day, weekByNumber(program, week), week, logging.setLogs);
  // Time on the day's exercises that were done with the clock running
  // (opened, then finished). Shown only when any were.
  const trainedSeconds = day.program_exercises.reduce(
    (sum, e) => sum + (exerciseSession.finishedSeconds(e.id, week) ?? 0),
    0,
  );

  // The week at a glance: one marker per training day, in program order.
  const days = program.program_days
    .filter((d) => d.program_exercises.length > 0)
    .sort((a, b) => a.day_index - b.day_index);
  const doneFlags = days.map((d) => {
    const p = logging.dayProgress(d, week);
    return p.done === p.total;
  });
  const doneCount = doneFlags.filter(Boolean).length;
  const next = days.find((_, i) => !doneFlags[i]) ?? null;
  const nextTitle = next != null ? dayTitle(next, t) : null;
  // "Solo semana actual": with the week done and the next one still closed,
  // say when it opens instead of pointing at it. Its own opening date, not
  // the lock's (before the start, the lock only knows the start date).
  // Always false for free programs.
  const nextWeekLocked = week < program.duration_weeks && logging.lockOf(week + 1) != null;
  const nextLine =
    next != null
      ? nextTitle != null
        ? t("program.dayDoneNext", { n: next.day_index, label: nextTitle })
        : t("program.dayDoneNextBare", { n: next.day_index })
      : week < program.duration_weeks
        ? nextWeekLocked
          ? t("program.nextWeekOpens", {
              n: week + 1,
              date: formatShortDate(weekOpensOn(program.start_date, week + 1), i18n.language),
            })
          : t("program.dayDoneNextWeek", { n: week + 1 })
        : t("program.dayDoneBlock");

  const record = summary.records[0] ?? null;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center px-4 py-10">
        <Pressable
          onPress={onClose}
          accessibilityLabel={t("common.close")}
          className="absolute inset-0"
          style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
        />
        <AnimatedView
          accessibilityViewIsModal
          style={[cardStyle, { width: "100%", maxWidth: 380, maxHeight: "100%" }]}
        >
          <Card topAccent={1} className="shrink rounded-[20px] p-0">
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerClassName="gap-5 px-[22px] pb-[22px] pt-7"
            >
              {/* The seal. The burst sits behind it, timed to the impact. */}
              <View className="items-center justify-center py-2">
                <Burst
                  play={visible ? openId : 0}
                  delay={IMPACT_MS - 20}
                  from={64}
                  to={116}
                  count={14}
                  length={14}
                  thickness={3.5}
                  colors={[colors.brandPrimary, colors.brandAccent, colors.contentPrimary]}
                />
                <AnimatedView style={sealStyle}>
                  <Seal dayIndex={day.day_index} />
                </AnimatedView>
              </View>

              {title != null && (
                <Text className="-mt-1 text-center text-[17px] font-bold text-content-primary">{title}</Text>
              )}

              {/* What they did, as poster numerals — no boxes. */}
              <View className="flex-row items-stretch">
                <Stat value={String(summary.exercises)} label={t("program.statExercises", { count: summary.exercises })} />
                <Rule />
                <Stat value={String(summary.sets)} label={t("program.statSets", { count: summary.sets })} />
                {trainedSeconds > 0 && (
                  <>
                    <Rule />
                    <Stat
                      value={String(Math.max(1, Math.round(trainedSeconds / 60)))}
                      label={t("program.statMinutes")}
                    />
                  </>
                )}
                {summary.volumeKg > 0 && (
                  <>
                    <Rule />
                    <Stat
                      value={Math.round(kgToUnit(summary.volumeKg, unit)).toLocaleString(locale)}
                      label={t("progress.kgVolumen", { unit })}
                    />
                  </>
                )}
              </View>

              {record != null && (
                <View
                  className="flex-row items-center gap-3 rounded-xl border px-3.5 py-3"
                  style={{ borderColor: colors.brandAccentBorder, backgroundColor: colors.brandAccentSoft }}
                >
                  <Ionicons name="trophy" size={20} color={colors.brandAccent} />
                  <View className="flex-1 gap-0.5">
                    <Text className="text-[12px] font-bold text-brand-accent">
                      {t("program.dayDoneRecord", { count: summary.records.length })}
                    </Text>
                    <Text className="text-[14px] font-semibold text-content-primary" style={TABULAR}>
                      {t("program.dayDoneRecordLine", {
                        name: record.name,
                        weight: kgToUnit1(record.weightKg, unit),
                        unit,
                        reps: record.reps,
                      })}
                    </Text>
                    {summary.records.length > 1 && (
                      <Text className="text-[12px] text-content-tertiary">
                        {t("program.dayDoneRecordMore", { count: summary.records.length - 1 })}
                      </Text>
                    )}
                  </View>
                </View>
              )}

              {summary.groups.length > 0 && (
                <TrainedBody groups={summary.groups} gender={profile?.sex === "female" ? "female" : "male"} />
              )}

              {/* This week so far, and where to go next. */}
              <View className="gap-2">
                <Text className="text-[13px] font-semibold text-content-primary" style={TABULAR}>
                  {doneCount === days.length
                    ? t("program.dayDoneWeekComplete", { n: week })
                    : t("program.dayDoneWeek", { n: week, done: doneCount, total: days.length })}
                </Text>
                <View className="flex-row gap-1.5 px-1">
                  {doneFlags.map((done, i) => (
                    <View
                      key={days[i].id}
                      className="h-2 flex-1"
                      style={{
                        backgroundColor: done ? colors.brandPrimary : colors.border,
                        transform: [{ skewX: "-8deg" }],
                      }}
                    />
                  ))}
                </View>
                <Text className="text-[13px] text-content-tertiary">{nextLine}</Text>
              </View>

              <SkewButton onPress={onClose} className="mt-1">
                {t("program.dayDoneCta")}
              </SkewButton>
            </ScrollView>
          </Card>
        </AnimatedView>
      </View>
    </Modal>
  );
}

const TABULAR = { fontVariant: ["tabular-nums" as const] };

/** Double-ruled rubber stamp in brand red, with a faint ink wash. */
function Seal({ dayIndex }: { dayIndex: number }) {
  const { t } = useTranslation();
  const colors = useColors();
  const ink = { color: colors.brandPrimary };
  return (
    <View style={{ borderWidth: 3, borderColor: colors.brandPrimary, borderRadius: 6, padding: 3 }}>
      <View
        className="items-center"
        style={{
          borderWidth: 1,
          borderColor: colors.brandPrimary,
          borderRadius: 3,
          backgroundColor: colors.brandPrimarySoft,
          paddingHorizontal: 20,
          paddingTop: 8,
          paddingBottom: 4,
        }}
      >
        <CapsLabel size={11} em={0.24} style={ink}>
          {t("program.dayN", { n: dayIndex })}
        </CapsLabel>
        <PosterText size={38} style={ink}>
          {t("program.dayDoneSeal")}
        </PosterText>
      </View>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View className="flex-1 items-center gap-0.5">
      <PosterText size={30} tabular>
        {value}
      </PosterText>
      <Text className="text-center text-[12px] text-content-tertiary">{label}</Text>
    </View>
  );
}

/** Hairline between stats, leaning with the rest of the poster language. */
function Rule() {
  return <View className="w-px bg-border" style={{ transform: [{ skewX: "-10deg" }] }} />;
}

/** Front and back figures with the day's muscle groups inked in. */
function TrainedBody({ groups, gender }: { groups: DrawnGroup[]; gender: "male" | "female" }) {
  const { t } = useTranslation();
  const colors = useColors();
  const data: ExtendedBodyPart[] = [];
  for (const [group, slugs] of Object.entries(GROUP_SLUGS) as [DrawnGroup, typeof GROUP_SLUGS.chest][]) {
    const fill = groups.includes(group) ? colors.brandPrimary : colors.borderStrong;
    for (const slug of slugs) data.push({ slug, styles: { fill } });
  }
  for (const slug of NON_MUSCLE) data.push({ slug, styles: { fill: colors.border } });

  return (
    <View className="items-center gap-2">
      <View className="flex-row justify-center gap-5">
        {(["front", "back"] as const).map((side) => (
          <Body
            key={side}
            data={data}
            gender={gender}
            side={side}
            scale={0.4}
            border="none"
            defaultFill={colors.borderStrong}
          />
        ))}
      </View>
      <Text className="text-center text-[13px] text-content-secondary">
        {t("program.dayDoneMuscles", {
          list: groups.map((g) => t(`progress.musculo_${g}`)).join(", "),
        })}
      </Text>
    </View>
  );
}

function dayTitle(
  day: ProgramDayWithExercises,
  t: ReturnType<typeof useTranslation>["t"],
): string | null {
  if (day.label != null && day.label !== "") return day.label;
  const weekday = dayLabel(day.weekday, t);
  return weekday != null && weekday !== "" ? weekday : null;
}

/**
 * What the client did on this day this week. Sets: the logged ones, or the
 * prescribed count for an exercise checked off with nothing logged (the same
 * rule as the muscle map). Volume: logged weight × reps, unilateral work
 * counted per side. Records: dayRecords (src/utils/records.ts, the rule the
 * check card shares), so a first-ever log sets a baseline, not a record.
 */
function daySummary(
  program: ProgramWithDetails,
  day: ProgramDayWithExercises,
  weekRow: ProgramWeek | null,
  week: number,
  setLogs: WorkoutSetLog[],
) {
  let sets = 0;
  let volumeKg = 0;
  const trained = new Set<DrawnGroup>();

  for (const ex of day.program_exercises) {
    const p = effectivePrescription(ex, weekRow, week);
    const mine = setLogs.filter((s) => s.program_exercise_id === ex.id && s.week_number === week);
    sets += mine.length > 0 ? mine.length : p.sets;
    for (const s of mine) {
      if (s.weight_kg != null && s.reps != null) volumeKg += s.weight_kg * s.reps * (p.isUnilateral ? 2 : 1);
    }
    const group = muscleGroupForBodyPart(ex.exercise?.body_part?.name);
    if (group !== "other") trained.add(group);
  }

  return {
    exercises: day.program_exercises.length,
    sets,
    volumeKg: Math.round(volumeKg),
    records: dayRecords(program, day, week, setLogs),
    // In the drawing's order, so the caption reads top to bottom.
    groups: (Object.keys(GROUP_SLUGS) as DrawnGroup[]).filter((g) => trained.has(g)),
  };
}
