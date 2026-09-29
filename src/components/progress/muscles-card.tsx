import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { MuscleHeatMap } from "@/src/components/progress/muscle-heat-map";
import { Card, SegmentedControl } from "@/src/components/ui";
import { Swap } from "@/src/lib/motion";
import { setMuscleMapView, useMuscleMapView, type MuscleMapView } from "@/src/lib/muscle-map-view";
import { useColors } from "@/src/theme/colors";
import { Pressable, Text, View } from "@/src/tw";
import {
  isWeakGroup,
  type MuscleAlert,
  type MuscleGroup,
  type MuscleRow,
  type MuscleWeek,
  type Periodo,
} from "@/src/utils/progress";

const TABULAR = { fontVariant: ["tabular-nums" as const] };
const GROUP_ORDER: MuscleGroup[] = ["legs", "back", "chest", "shoulders", "arms", "core", "other"];

type MusclesCardProps = {
  periodo: Periodo;
  rows: MuscleRow[];
  alert: MuscleAlert | null;
  /** This program week, or null without an active program. */
  week: MuscleWeek | null;
  /** Picks the body drawing; anything but "female" uses the male one. */
  sex: "male" | "female" | "other" | null | undefined;
};

// Muscles card, two views the client switches between:
//  - "Esta semana": this program week — what's assigned (blue), what's been
//    worked (red), what isn't in the week (slate); the list gives done/assigned.
//  - "Volumen": sets per group over the period — the heat map and bars, with
//    amber for a group under 25% of the leader ("other" is never flagged).
// Without a program only "Volumen" exists. The last view picked is remembered
// on the device (src/lib/muscle-map-view.ts). Tapping a muscle or a row
// selects its group in both the figure and the list. No LLM.
export function MusclesCard({ periodo, rows, alert, week, sex }: MusclesCardProps) {
  const colors = useColors();
  const { t } = useTranslation();
  const picked = useMuscleMapView();
  const [selected, setSelected] = useState<MuscleGroup | null>(null);
  // The last view picked; "Esta semana" until the client chooses, when
  // there's a program to show.
  const mode: MuscleMapView = week == null ? "volume" : (picked ?? "week");

  const groupName = (group: string) => t(`progress.musculo_${group}`);
  const toggle = (group: MuscleGroup) => setSelected((g) => (g === group ? null : group));

  const headerLabel =
    mode === "week" && week != null
      ? week.notStarted
        ? t("progress.mapaSemanaPronto", { total: week.totalWeeks })
        : t("progress.mapaSemana", { week: week.week, total: week.totalWeeks })
      : periodo === "week"
        ? t("progress.ultimos14")
        : t("progress.ultimos30");

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-[15px] font-bold text-content-primary">{t("progress.gruposMusculares")}</Text>
        <Text className="text-[11px] text-content-muted">{headerLabel}</Text>
      </View>

      {week != null && (
        <SegmentedControl
          segments={[
            { key: "week", label: t("progress.mapaVistaSemana") },
            { key: "volume", label: t("progress.mapaVistaVolumen") },
          ]}
          value={mode}
          onChange={(k) => void setMuscleMapView(k as MuscleMapView)}
        />
      )}

      <MuscleHeatMap
        mode={mode}
        rows={rows}
        alert={alert}
        week={week}
        gender={sex === "female" ? "female" : "male"}
        selected={selected}
        onSelect={setSelected}
      />

      <Swap id={mode} order={mode === "week" ? 0 : 1}>
        {mode === "week" && week != null ? (
          <WeekList week={week} selected={selected} onToggle={toggle} groupName={groupName} />
        ) : (
          <VolumeList rows={rows} selected={selected} onToggle={toggle} groupName={groupName} />
        )}
      </Swap>

      {alert != null && (
        <View className="flex-row items-start gap-2 rounded-xl bg-warning-soft px-3 py-2.5">
          <Ionicons name="pulse-outline" size={15} color={colors.warning} />
          {/* No leading-* here, and no text-* size on the nested spans. On
              native, react-native-css hands leading-*'s --tw-leading down to
              every descendant, and a descendant's text-* reads it as a multiple
              of its font size: the bold span got a 147dp line, and Android drew
              the whole alert as one huge line. text-xs alone gives the same
              line height as leading-4 did on web; the spans inherit it. */}
          <Text className="shrink text-xs text-warning">
            {alert.kind === "recency" ? (
              <>
                <Text className="font-bold text-warning">{groupName(alert.group)}</Text>
                {alert.routineDayKey != null
                  ? t("progress.sinEstimuloSugerencia", {
                      count: alert.days,
                      dia: t(`daysLong.${alert.routineDayKey}`).toLowerCase(),
                    })
                  : t("progress.sinEstimulo", { count: alert.days })}
              </>
            ) : (
              <>
                <Text className="font-bold text-warning">{groupName(alert.group)}</Text>
                {t("progress.desbalance")}
              </>
            )}
          </Text>
        </View>
      )}
    </Card>
  );
}

type ListProps = {
  selected: MuscleGroup | null;
  onToggle: (group: MuscleGroup) => void;
  groupName: (group: string) => string;
};

/** "Esta semana": each group in the week with done/assigned and a bar. */
function WeekList({ week, selected, onToggle, groupName }: ListProps & { week: MuscleWeek }) {
  const colors = useColors();
  const { t } = useTranslation();
  const groups = GROUP_ORDER.filter((g) => (week.assigned[g] ?? 0) > 0 || (week.done[g] ?? 0) > 0);
  const a = (g: MuscleGroup) => week.assigned[g] ?? 0;
  const d = (g: MuscleGroup) => week.done[g] ?? 0;

  if (groups.length === 0) {
    return <Text className="text-center text-xs text-content-tertiary">{t("progress.mapaSemanaVacia")}</Text>;
  }

  const caption = (g: MuscleGroup) =>
    a(g) === 0
      ? d(g) > 0
        ? t("progress.mapaExtra", { count: d(g) })
        : t("progress.mapaNoEnSemana")
      : t("progress.mapaSemanaSeleccion", { done: d(g), assigned: a(g) });

  return (
    <>
      <Caption selected={selected} groupName={groupName} text={selected != null ? caption(selected) : null} />
      <View className="gap-1">
        {groups.map((g) => {
          const active = selected === g;
          const worked = d(g) > 0;
          return (
            <Pressable
              key={g}
              onPress={() => onToggle(g)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${groupName(g)}, ${t("progress.setsDeAsignados", { done: d(g), assigned: a(g) })}`}
              className="flex-row items-center gap-2 py-[3px]"
              style={{ opacity: selected != null && !active ? 0.45 : 1 }}
            >
              <View
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: worked ? colors.brandPrimary : colors.brandSecondary }}
              />
              <Text
                className={
                  active
                    ? "w-[58px] text-xs font-bold text-content-primary"
                    : "w-[58px] text-xs font-medium text-content-secondary"
                }
              >
                {groupName(g)}
              </Text>
              <View className="h-2.5 flex-1 overflow-hidden rounded-full bg-brand-dark">
                {worked && (
                  <View
                    className="h-full rounded-full bg-brand-primary"
                    style={{ width: `${Math.max(4, Math.min(100, a(g) > 0 ? (d(g) / a(g)) * 100 : 100))}%` }}
                  />
                )}
              </View>
              <Text className="w-16 text-right text-[11px] text-content-tertiary" style={TABULAR}>
                {t("progress.setsDeAsignados", { done: d(g), assigned: a(g) })}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

/** "Volumen": sets per group in the period, amber under 25% of the leader. */
function VolumeList({ rows, selected, onToggle, groupName }: ListProps & { rows: MuscleRow[] }) {
  const { t } = useTranslation();
  const max = Math.max(...rows.map((r) => r.sets), 1);
  const selectedRow = selected != null ? rows.find((r) => r.group === selected) : undefined;

  if (rows.length === 0) {
    return <Text className="text-center text-xs text-content-tertiary">{t("progress.mapaVacio")}</Text>;
  }

  return (
    <>
      <Caption
        selected={selected}
        groupName={groupName}
        text={
          selected == null
            ? null
            : selectedRow != null
              ? t("progress.mapaSeleccion", { count: selectedRow.sets })
              : t("progress.mapaSinSets")
        }
      />
      <View className="gap-1">
        {rows.map((row) => {
          const weak = isWeakGroup(row, max);
          const active = selected === row.group;
          return (
            <Pressable
              key={row.group}
              onPress={() => onToggle(row.group)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${groupName(row.group)}, ${t("progress.setsCount", { count: row.sets })}`}
              className="flex-row items-center gap-2 py-[3px]"
              style={{ opacity: selected != null && !active ? 0.45 : 1 }}
            >
              <Text
                className={
                  active
                    ? "w-[66px] text-xs font-bold text-content-primary"
                    : "w-[66px] text-xs font-medium text-content-secondary"
                }
              >
                {groupName(row.group)}
              </Text>
              <View className="h-2.5 flex-1 overflow-hidden rounded-full bg-brand-dark">
                <View
                  className={weak ? "h-full rounded-full bg-warning" : "h-full rounded-full bg-brand-primary"}
                  style={{ width: `${Math.max(4, (row.sets / max) * 100)}%` }}
                />
              </View>
              <Text className="w-14 text-right text-[11px] text-content-tertiary" style={TABULAR}>
                {t("progress.setsCount", { count: row.sets })}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

/** The tap hint, or the selected group's line ("Piernas: 17 de 19 sets…"). */
function Caption({
  selected,
  groupName,
  text,
}: {
  selected: MuscleGroup | null;
  groupName: (group: string) => string;
  text: string | null;
}) {
  const { t } = useTranslation();
  return (
    <Text className="text-center text-xs text-content-tertiary" accessibilityLiveRegion="polite">
      {selected == null || text == null ? (
        t("progress.mapaToca")
      ) : (
        <>
          <Text className="font-bold text-content-primary">{groupName(selected)}</Text>
          {text}
        </>
      )}
    </Text>
  );
}
