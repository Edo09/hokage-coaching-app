import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { ExerciseVideoModal } from "@/src/components/exercise-video-modal";
import { LockNote } from "@/src/components/program/lock-note";
import { ProgramExerciseRow } from "@/src/components/program/program-exercise-row";
import { CapsLabel, Card, ExpandChevron } from "@/src/components/ui";
import { useProgramLogging } from "@/src/hooks/use-program-logging";
import { exerciseSession } from "@/src/lib/exercise-session";
import { PressableScale, Reveal, Swap } from "@/src/lib/motion";
import { isHeld, useCelebration } from "@/src/providers/celebration-context";
import { useColors } from "@/src/theme/colors";
import { Pressable, ScrollView, Text, View } from "@/src/tw";
import type {
  ProgramDayWithExercises,
  ProgramExercise,
  ProgramWeek,
  ProgramWithDetails,
} from "@/src/types/database";
import { dayLabel } from "@/src/utils/day-label";

const TABULAR = { fontVariant: ["tabular-nums" as const] };

type Props = {
  program: ProgramWithDetails;
  week: ProgramWeek | null;
  selectedWeek: number;
  autoWeek: number;
  onSelectWeek: (week: number | null) => void;
  notStarted: boolean;
};

// Read-only render of an assigned coach program (Phase 2): header, week
// navigator (auto week marked "current"), the selected week's periodization
// summary, then each day with its prescriptions resolved for that week.
export function ProgramView({
  program,
  week,
  selectedWeek,
  autoWeek,
  onSelectWeek,
  notStarted,
}: Props) {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  // One shared player for every row's demo video.
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const logging = useProgramLogging(program);
  // "Solo semana actual": the selected week is view only until it opens (or
  // until the program starts). Always null for free programs.
  const lock = logging.lockOf(selectedWeek);
  // The exercise sheet lives in the tabs layout (ExerciseSessionHost) so an
  // exercise in progress can be hidden to a bar.
  const openExercise = (ex: ProgramExercise) => exerciseSession.open(ex.id, selectedWeek);
  // Manual expand/collapse per day and week. Held here, outside the week
  // Swap (which re-mounts the day cards), so a pin survives a look at
  // another week; per week, because each week has its own completion.
  const [pins, setPins] = useState<Record<string, boolean>>({});

  const startDate = new Date(`${program.start_date}T00:00:00`).toLocaleDateString(
    i18n.language === "es" ? "es-ES" : "en-US",
    { day: "numeric", month: "short", year: "numeric" },
  );

  return (
    <View className="gap-3">
      {/* Header */}
      <Card className="gap-2 border-brand-accent-soft">
        <View className="flex-row items-center gap-2">
          <View className="h-7 w-7 items-center justify-center rounded-lg bg-brand-accent-soft">
            <Ionicons name="ribbon" size={15} color={colors.brandAccent} />
          </View>
          <Text className="flex-1 text-[15px] font-bold text-content-primary">
            {program.name}
          </Text>
          <Text
            className="text-[10px] font-semibold text-brand-accent"
            style={{ letterSpacing: 0.4 }}
          >
            {t("coach.badge").toUpperCase()}
          </Text>
        </View>

        {program.focus != null && program.focus !== "" && (
          <Text className="text-[13px] text-content-secondary">{program.focus}</Text>
        )}
        {program.description != null && program.description !== "" && (
          <Text className="text-[13px] text-content-tertiary">{program.description}</Text>
        )}

        <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
          <Meta icon="calendar-outline">
            {t("program.weeksCount", { count: program.duration_weeks })}
          </Meta>
          <Meta icon="flag-outline">{t("program.startsOn", { date: startDate })}</Meta>
        </View>

        {/* With the week locked, its lock note below says when it starts. */}
        {notStarted && lock == null && (
          <View className="rounded-lg bg-info-soft px-3 py-2">
            <Text className="text-[12px] text-brand-secondary">
              {t("program.notStartedHint", { date: startDate })}
            </Text>
          </View>
        )}
      </Card>

      {/* Week navigator */}
      <WeekNavigator
        weeks={program.program_weeks}
        durationWeeks={program.duration_weeks}
        selectedWeek={selectedWeek}
        autoWeek={autoWeek}
        onSelectWeek={onSelectWeek}
      />

      {/* The selected week's header and days swap in from the side of travel */}
      <Swap id={selectedWeek} order={selectedWeek} className="gap-3">
        {/* Selected week's periodization, as a divider over its days (caps
            label + hairline) rather than a card that reads like one more day.
            Not the red-dash label: the tab header above already uses it for
            the block's current week. */}
        {week != null && (
          <View className="gap-1.5 px-1 pt-2">
            <View className="flex-row items-center gap-2.5">
              <CapsLabel size={11} em={0.18} className="text-content-tertiary">
                {week.label ?? t("program.weekN", { n: week.week_number })}
              </CapsLabel>
              {week.is_deload && (
                <View className="rounded-full bg-warning-soft px-2 py-0.5">
                  <Text className="text-[11px] font-semibold text-warning">
                    {t("program.deload")}
                  </Text>
                </View>
              )}
              <View className="h-px flex-1 bg-border" />
            </View>
            {(weekRir(week) != null || weekLoad(week) != null || week.sets_override != null) && (
              <View className="flex-row flex-wrap gap-x-4 gap-y-1">
                {weekRir(week) != null && (
                  <Text className="text-[12px] text-content-secondary" style={TABULAR}>
                    {weekRir(week)}
                  </Text>
                )}
                {weekLoad(week) != null && (
                  <Text className="text-[12px] text-content-secondary" style={TABULAR}>
                    {t("program.loadLabel", { load: weekLoad(week) })}
                  </Text>
                )}
                {week.sets_override != null && (
                  <Text className="text-[12px] text-content-secondary" style={TABULAR}>
                    {t("program.setsOverride", { sets: week.sets_override })}
                  </Text>
                )}
              </View>
            )}
            {week.notes != null && week.notes !== "" && (
              <Text className="text-[12px] text-content-tertiary">{week.notes}</Text>
            )}
          </View>
        )}

        {/* A week that isn't open yet (every week, before the start) is view
            only: say when it opens. */}
        {lock != null && <LockNote lock={lock} />}

        {/* Days */}
        {program.program_days.map((day) => (
          <DayCard
            key={day.id}
            day={day}
            week={week}
            selectedWeek={selectedWeek}
            onOpenExercise={openExercise}
            onPlayVideo={setVideoUri}
            logging={logging}
            locked={lock != null}
            manualCollapsed={pins[`${day.id}:${selectedWeek}`] ?? null}
            onPin={(collapsed) =>
              setPins((p) => ({ ...p, [`${day.id}:${selectedWeek}`]: collapsed }))
            }
          />
        ))}
      </Swap>

      {/* Program-level notes / rules */}
      {(program.tempo_default != null || program.progression_rule != null || program.notes != null) && (
        <Card className="gap-2 py-3">
          <Text className="text-[12px] font-bold uppercase text-content-tertiary" style={{ letterSpacing: 0.4 }}>
            {t("program.coachNotes")}
          </Text>
          {program.tempo_default != null && program.tempo_default !== "" && (
            <NoteLine icon="time-outline" label={t("program.tempo")} value={program.tempo_default} />
          )}
          {program.progression_rule != null && program.progression_rule !== "" && (
            <NoteLine icon="trending-up-outline" label={t("program.progression")} value={program.progression_rule} />
          )}
          {program.notes != null && program.notes !== "" && (
            <NoteLine icon="information-circle-outline" label={t("program.notes")} value={program.notes} />
          )}
        </Card>
      )}

      <ExerciseVideoModal uri={videoUri} onClose={() => setVideoUri(null)} />
    </View>
  );
}

function DayCard({
  day,
  week,
  selectedWeek,
  onOpenExercise,
  onPlayVideo,
  logging,
  locked,
  manualCollapsed,
  onPin,
}: {
  day: ProgramDayWithExercises;
  week: ProgramWeek | null;
  selectedWeek: number;
  onOpenExercise: (exercise: ProgramExercise) => void;
  onPlayVideo: (uri: string) => void;
  logging: ReturnType<typeof useProgramLogging>;
  /** "Solo semana actual": this week isn't open yet, so nothing can be checked. */
  locked: boolean;
  /** The client's own expand/collapse for this day and week; null = automatic. */
  manualCollapsed: boolean | null;
  onPin: (collapsed: boolean) => void;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const weekday = dayLabel(day.weekday, t);
  const progress = logging.dayProgress(day, selectedWeek);
  const allDone = progress.total > 0 && progress.done === progress.total;

  // A finished day collapses itself so the next day is one scroll away; tapping
  // the header (or the chevron) reopens it. A manual toggle pins the choice.
  // Not while its celebration is on: the last check's burst plays in place.
  const celebration = useCelebration();
  const collapsed = manualCollapsed ?? (allDone && !isHeld(celebration, day.id, selectedWeek));
  const toggleCollapsed = () => onPin(!collapsed);

  return (
    <Card className="gap-0 py-3">
      <View className="flex-row items-start gap-2 pb-1">
        <Pressable
          className="flex-1"
          onPress={toggleCollapsed}
          accessibilityRole="button"
          accessibilityLabel={t(collapsed ? "program.expandDay" : "program.collapseDay")}
        >
          <View className="flex-row items-center gap-2">
            <Text className="text-[10px] font-bold text-brand-primary" style={TABULAR}>
              {t("program.dayN", { n: day.day_index })}
            </Text>
            {weekday != null && (
              <Text className="text-[10px] font-medium uppercase text-content-muted" style={{ letterSpacing: 0.3 }}>
                {weekday}
              </Text>
            )}
          </View>
          {day.label != null && day.label !== "" && (
            <Text className="pt-0.5 text-[15px] font-bold text-content-primary">{day.label}</Text>
          )}
        </Pressable>

        {/* Day completion: progress + one-tap mark-all toggle. Locked, it
            still shows the count but can't be pressed. */}
        <Pressable
          onPress={() => logging.setDayCompletion(day, selectedWeek, !allDone)}
          disabled={locked}
          accessibilityRole="button"
          accessibilityState={{ disabled: locked }}
          accessibilityLabel={t(allDone ? "program.markDayUndone" : "program.markDayDone")}
          className={
            allDone
              ? "flex-row items-center gap-1 rounded-full bg-success-soft px-2.5 py-1"
              : "flex-row items-center gap-1 rounded-full bg-surface-elevated px-2.5 py-1"
          }
        >
          <Ionicons
            name={allDone ? "checkmark-done" : locked ? "lock-closed" : "ellipse-outline"}
            size={13}
            color={allDone ? colors.success : colors.contentTertiary}
          />
          <Text
            className={allDone ? "text-[11px] font-bold text-success" : "text-[11px] font-bold text-content-tertiary"}
            style={TABULAR}
          >
            {progress.done}/{progress.total}
          </Text>
        </Pressable>

        <Pressable
          onPress={toggleCollapsed}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t(collapsed ? "program.expandDay" : "program.collapseDay")}
          className="pt-0.5"
        >
          <ExpandChevron open={!collapsed} size={18} color={colors.contentMuted} />
        </Pressable>
      </View>

      <Reveal open={!collapsed}>
        {day.program_exercises.map((ex, i) => {
          // Consecutive rows sharing a letter are one superset: a red bar
          // runs down the group and its first row carries the label.
          const group = ex.superset_group ?? null;
          const prevGroup = i > 0 ? (day.program_exercises[i - 1].superset_group ?? null) : null;
          const nextGroup = day.program_exercises[i + 1]?.superset_group ?? null;
          const inGroup = group != null && (group === prevGroup || group === nextGroup);
          const startsGroup = inGroup && group !== prevGroup;
          return (
          <View
            key={ex.id}
            className={[
              i === 0 || (inGroup && !startsGroup) ? "" : "border-t border-border",
              inGroup ? "border-l-[3px] border-l-brand-primary pl-2.5" : "",
            ].join(" ")}
          >
            {startsGroup && (
              <Text className="pt-2 text-[10px] font-bold uppercase text-brand-primary" style={{ letterSpacing: 1.2 }}>
                {t("program.superset", { letter: group })}
              </Text>
            )}
            <ProgramExerciseRow
              exercise={ex}
              week={week}
              weekNumber={selectedWeek}
              done={logging.isDone(ex.id, selectedWeek)}
              onToggleDone={() =>
                logging.setCompletion(ex.id, selectedWeek, !logging.isDone(ex.id, selectedWeek))
              }
              locked={locked}
              onOpen={() => onOpenExercise(ex)}
              onPlay={onPlayVideo}
              loggedCount={logging.setsFor(ex.id, selectedWeek).length}
            />
          </View>
          );
        })}
      </Reveal>
    </Card>
  );
}

function WeekNavigator({
  weeks,
  durationWeeks,
  selectedWeek,
  autoWeek,
  onSelectWeek,
}: {
  weeks: ProgramWeek[];
  durationWeeks: number;
  selectedWeek: number;
  autoWeek: number;
  onSelectWeek: (week: number | null) => void;
}) {
  const { t } = useTranslation();
  const numbers = Array.from({ length: durationWeeks }, (_, i) => i + 1);
  const labelFor = (n: number) =>
    weeks.find((w) => w.week_number === n)?.label ?? null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="flex-row gap-2 px-0.5"
    >
      {numbers.map((n) => {
        const active = n === selectedWeek;
        const isAuto = n === autoWeek;
        return (
          <PressableScale
            key={n}
            haptic={!active}
            onPress={() => onSelectWeek(n === autoWeek ? null : n)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t("program.weekN", { n })}
            className={
              active
                ? "min-w-[64px] items-center rounded-xl border border-brand-primary bg-brand-primary px-3 py-2"
                : "min-w-[64px] items-center rounded-xl border border-border bg-surface px-3 py-2"
            }
          >
            <Text
              className={
                active
                  ? "text-[11px] font-bold text-white"
                  : "text-[11px] font-bold text-content-secondary"
              }
              style={TABULAR}
            >
              {t("program.weekShort", { n })}
            </Text>
            {isAuto ? (
              <Text
                className={active ? "text-[9px] font-semibold text-white/90" : "text-[9px] font-semibold text-brand-primary"}
              >
                {t("program.currentWeek")}
              </Text>
            ) : (
              labelFor(n) != null && (
                <Text
                  numberOfLines={1}
                  className={active ? "max-w-[70px] text-[9px] text-white/80" : "max-w-[70px] text-[9px] text-content-muted"}
                >
                  {labelFor(n)}
                </Text>
              )
            )}
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

function NoteLine({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
}) {
  const colors = useColors();
  return (
    <View className="flex-row gap-2">
      <Ionicons name={icon} size={14} color={colors.contentTertiary} style={{ marginTop: 2 }} />
      {/* shrink, not flex-1: Android over-measures a nested Text from a zero
          basis (same fix as the muscles card's alert). */}
      <Text className="shrink text-[12px] text-content-secondary">
        <Text className="font-semibold text-content-primary">{label}: </Text>
        {value}
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
      <Text className="text-[12px] text-content-tertiary">{children}</Text>
    </View>
  );
}

function weekRir(w: ProgramWeek): string | null {
  if (w.rir_min == null && w.rir_max == null) return null;
  if (w.rir_min != null && w.rir_max != null)
    return w.rir_min === w.rir_max ? `RIR ${w.rir_min}` : `RIR ${w.rir_min}–${w.rir_max}`;
  return `RIR ${w.rir_min ?? w.rir_max}`;
}

function weekLoad(w: ProgramWeek): string | null {
  if (w.load_pct_min == null && w.load_pct_max == null) return null;
  if (w.load_pct_min != null && w.load_pct_max != null)
    return w.load_pct_min === w.load_pct_max
      ? `${w.load_pct_min}%`
      : `${w.load_pct_min}–${w.load_pct_max}%`;
  return `${w.load_pct_min ?? w.load_pct_max}%`;
}
