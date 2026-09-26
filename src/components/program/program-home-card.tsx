import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React from "react";
import { useTranslation } from "react-i18next";

import { Card, CapsLabel, PosterText, Skewed } from "@/src/components/ui";
import { useProgramLogging } from "@/src/hooks/use-program-logging";
import { useColors } from "@/src/theme/colors";
import { Text, View } from "@/src/tw";
import type { ProgramDayWithExercises, ProgramExercise, ProgramWeek, ProgramWithDetails } from "@/src/types/database";
import { dayLabel } from "@/src/utils/day-label";
import { currentWeekOf, effectivePrescription, formatReps, weekByNumber } from "@/src/utils/program";

// getDay() (0=Sun) → the stored lowercase English weekday.
const DOW = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const IS_IMAGE = /\.(gif|apng|webp|png|jpe?g)$/i;

type Props = {
  program: ProgramWithDetails;
  notStarted: boolean;
  /** Opens the program (Routines → Coach). */
  onPress: () => void;
};

// Home hero for the client's single active coach program. Shows the CURRENT
// day's actual session — the exercises (with their looping demo thumbnails) and
// prescriptions — so the client sees exactly what to train, then taps in to do
// it. Replaces the routines carousel on home when a program is assigned.
export function ProgramHomeCard({ program, notStarted, onPress }: Props) {
  const { t, i18n } = useTranslation();
  const colors = useColors();

  const autoWeek = currentWeekOf(program.start_date, program.duration_weeks);
  const logging = useProgramLogging(program);

  // Real progress: the fraction of all prescribed exercise-weeks the client has
  // actually checked off — 0 until they train, not calendar time elapsed.
  let done = 0;
  let total = 0;
  for (let w = 1; w <= program.duration_weeks; w++) {
    for (const d of program.program_days) {
      const dp = logging.dayProgress(d, w);
      done += dp.done;
      total += dp.total;
    }
  }
  const frac = total > 0 ? done / total : 0;
  const pct = Math.round(frac * 100);

  // The session to surface: the next unfinished day. A day scheduled for today
  // (when days carry a weekday) wins if still pending; otherwise the first
  // not-fully-done day of the current week, advancing to next week once the
  // whole week is cleared. Falls back to the last day when the block is done.
  const days = [...program.program_days].sort((a, b) => a.day_index - b.day_index);
  const pending = (d: ProgramDayWithExercises, w: number) =>
    d.program_exercises.length > 0 && logging.dayProgress(d, w).done < d.program_exercises.length;
  const dow = new Date().getDay();
  const todayDay = days.find((d) => d.weekday?.toLowerCase() === DOW[dow]) ?? null;

  let displayWeek = autoWeek;
  let day: ProgramDayWithExercises | null;
  if (todayDay != null && pending(todayDay, autoWeek)) {
    day = todayDay;
  } else {
    day = days.find((d) => pending(d, autoWeek)) ?? null;
    if (day == null && autoWeek < program.duration_weeks) {
      displayWeek = autoWeek + 1;
      day = days.find((d) => pending(d, displayWeek)) ?? null;
    }
    if (day == null) {
      displayWeek = autoWeek;
      day = days[days.length - 1] ?? null;
    }
  }
  const week = weekByNumber(program, displayWeek);

  // Show the WHOLE day in prescription order — capping the list hid either the
  // done or the pending rows depending on where the cut fell. The full day (with
  // its done/pending marks) is the honest, glanceable surface.
  const exercises = day?.program_exercises ?? [];
  const dayDone = day != null ? logging.dayProgress(day, displayWeek) : { done: 0, total: 0 };
  const dayTitle = day != null ? (day.label != null && day.label !== "" ? day.label : dayLabel(day.weekday, t)) : null;

  const startDate = new Date(`${program.start_date}T00:00:00`).toLocaleDateString(
    i18n.language === "es" ? "es-ES" : "en-US",
    { day: "numeric", month: "long" },
  );

  return (
    <Card onPress={onPress} topAccent={frac} className="rounded-[20px] p-[18px] gap-3">
      {/* Badge + week */}
      <View className="flex-row items-center justify-between">
        <Skewed deg={-10} className="bg-brand-primary px-2.5 py-1" contentClassName="gap-1">
          <Ionicons name="ribbon" size={11} color="#fff" />
          <CapsLabel size={9} em={0.14} style={{ color: "#fff" }}>
            {t("home.coachProgram")}
          </CapsLabel>
        </Skewed>
        <CapsLabel size={10} em={0.12} className="text-content-tertiary">
          {t("program.weekOfTotal", { n: displayWeek, total: program.duration_weeks })}
        </CapsLabel>
      </View>

      {/* Title + focus / start hint */}
      <View>
        <PosterText size={22} numberOfLines={2}>
          {program.name}
        </PosterText>
        {notStarted ? (
          <CapsLabel size={9.5} em={0.12} className="text-brand-primary" style={{ marginTop: 5 }}>
            {t("program.startsEyebrow")} · {startDate}
          </CapsLabel>
        ) : (
          program.focus != null &&
          program.focus !== "" && (
            <CapsLabel size={10} em={0.1} className="text-content-tertiary" style={{ marginTop: 4 }}>
              {program.focus}
            </CapsLabel>
          )
        )}
      </View>

      {day != null && (
        <>
          {/* Day header */}
          <View className="mt-0.5 flex-row items-center justify-between">
            <View className="flex-1 flex-row items-baseline gap-2">
              <CapsLabel size={9} em={0.16} className="text-brand-primary">
                {t("program.dayN", { n: day.day_index })}
              </CapsLabel>
              {dayTitle != null && dayTitle !== "" && (
                <Text className="flex-1 text-[15px] font-bold text-content-primary" numberOfLines={1}>
                  {dayTitle}
                </Text>
              )}
            </View>
            <View
              className={
                dayDone.done > 0
                  ? "flex-row items-center gap-1 rounded-full bg-success-soft px-2.5 py-1"
                  : "flex-row items-center gap-1 rounded-full bg-surface-elevated px-2.5 py-1"
              }
            >
              <Ionicons
                name={dayDone.done > 0 ? "checkmark-circle" : "ellipse-outline"}
                size={11}
                color={dayDone.done > 0 ? colors.success : colors.contentTertiary}
              />
              <CapsLabel
                size={9}
                em={0.08}
                className={dayDone.done > 0 ? "text-success" : "text-content-tertiary"}
                style={{ fontVariant: ["tabular-nums"] }}
              >
                {dayDone.done}/{dayDone.total}
              </CapsLabel>
            </View>
          </View>

          {/* Exercise rows — the actual session preview */}
          <View>
            {exercises.map((ex) => (
              <ExerciseMiniRow key={ex.id} exercise={ex} week={week} weekNumber={displayWeek} done={logging.isDone(ex.id, displayWeek)} />
            ))}
          </View>
        </>
      )}

      {/* Block progress */}
      <View className="gap-1.5">
        <View className="flex-row items-center justify-between">
          <CapsLabel size={8.5} em={0.14} className="text-content-tertiary">
            {t("program.blockProgress")}
          </CapsLabel>
          <PosterText size={12} tabular>
            {pct}%
          </PosterText>
        </View>
        <View className="h-1.5 overflow-hidden rounded-full bg-border">
          <View className="h-full rounded-full bg-brand-primary" style={{ width: `${pct}%` }} />
        </View>
      </View>

      {/* CTA — visual only; the whole card is the tap target (no nested Pressable). */}
      <Skewed deg={-10} className="self-stretch bg-brand-primary py-2.5" contentClassName="gap-2">
        <Ionicons name="barbell" size={14} color="#fff" />
        <CapsLabel size={12} em={0.1} style={{ color: "#fff" }}>
          {notStarted ? t("program.viewProgram") : t("program.trainToday")}
        </CapsLabel>
      </Skewed>
    </Card>
  );
}

function ExerciseMiniRow({
  exercise,
  week,
  weekNumber,
  done,
}: {
  exercise: ProgramExercise;
  week: ProgramWeek | null;
  weekNumber: number;
  done: boolean;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const p = effectivePrescription(exercise, week, weekNumber);
  const videoUrl = exercise.exercise?.video_url ?? null;
  const isInlineGif = videoUrl != null && videoUrl !== "" && IS_IMAGE.test(videoUrl.split("?")[0]);
  const setsReps = p.isUnilateral
    ? t("program.setsRepsPerSide", { sets: p.sets, reps: formatReps(p.repMin, p.repMax) })
    : t("program.setsReps", { sets: p.sets, reps: formatReps(p.repMin, p.repMax) });

  return (
    <View className="flex-row items-center gap-3 border-t border-border py-2.5">
      {isInlineGif ? (
        <View className="h-11 w-11 overflow-hidden rounded-lg bg-brand-dark">
          <Image
            source={{ uri: videoUrl! }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
          />
        </View>
      ) : (
        <View className="h-11 w-11 items-center justify-center rounded-lg bg-brand-dark">
          <Ionicons name="barbell-outline" size={16} color={colors.contentTertiary} />
        </View>
      )}
      <View className="flex-1">
        <Text
          className={
            done
              ? "text-[13.5px] font-semibold text-content-muted line-through"
              : "text-[13.5px] font-semibold text-content-primary"
          }
          numberOfLines={1}
        >
          {p.name}
        </Text>
        <Text
          className="text-[12px] font-medium text-content-secondary"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {setsReps}
        </Text>
      </View>
      <Ionicons
        name={done ? "checkmark-circle" : "ellipse-outline"}
        size={20}
        color={done ? colors.success : colors.contentMuted}
      />
    </View>
  );
}
