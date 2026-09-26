import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { MuscleHeatMap } from "@/src/components/progress/muscle-heat-map";
import { Card } from "@/src/components/ui";
import { useColors } from "@/src/theme/colors";
import { Pressable, Text, View } from "@/src/tw";
import { isWeakGroup, type MuscleAlert, type MuscleGroup, type MuscleRow, type Periodo } from "@/src/utils/progress";

const TABULAR = { fontVariant: ["tabular-nums" as const] };

type MusclesCardProps = {
  periodo: Periodo;
  rows: MuscleRow[];
  alert: MuscleAlert | null;
  /** Picks the body drawing; anything but "female" uses the male one. */
  sex: "male" | "female" | "other" | null | undefined;
};

// Diagnosis card: raw logs → "what am I neglecting". A heat map of the body
// shows it at a glance; the bars give the numbers. Amber marks a group under
// 25% of the leader (both views); the "other" bucket is informational and
// never flagged. Tapping a muscle or a bar selects its group in both. No LLM.
export function MusclesCard({ periodo, rows, alert, sex }: MusclesCardProps) {
  const colors = useColors();
  const { t } = useTranslation();
  const [selected, setSelected] = useState<MuscleGroup | null>(null);

  const max = Math.max(...rows.map((r) => r.sets), 1);
  const groupName = (group: string) => t(`progress.musculo_${group}`);
  const windowLabel = periodo === "week" ? t("progress.ultimos14") : t("progress.ultimos30");
  const selectedRow = selected != null ? rows.find((r) => r.group === selected) : undefined;
  const toggle = (group: MuscleGroup) => setSelected((g) => (g === group ? null : group));

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-[15px] font-bold text-content-primary">
          {t("progress.gruposMusculares")}
        </Text>
        <Text className="text-[11px] text-content-muted">{windowLabel}</Text>
      </View>

      <MuscleHeatMap
        rows={rows}
        alert={alert}
        gender={sex === "female" ? "female" : "male"}
        selected={selected}
        onSelect={setSelected}
      />

      {rows.length === 0 ? (
        <Text className="text-center text-xs leading-4 text-content-tertiary">
          {t("progress.mapaVacio")}
        </Text>
      ) : (
        <>
          <Text className="text-center text-xs text-content-tertiary" accessibilityLiveRegion="polite">
            {selected == null ? (
              t("progress.mapaToca")
            ) : (
              <>
                <Text className="text-xs font-bold text-content-primary">{groupName(selected)}</Text>
                {selectedRow != null
                  ? t("progress.mapaSeleccion", { count: selectedRow.sets })
                  : t("progress.mapaSinSets")}
              </>
            )}
          </Text>

          <View className="gap-1">
            {rows.map((row) => {
              const weak = isWeakGroup(row, max);
              const active = selected === row.group;
              const dimmed = selected != null && !active;
              return (
                <Pressable
                  key={row.group}
                  onPress={() => toggle(row.group)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${groupName(row.group)}, ${t("progress.setsCount", { count: row.sets })}`}
                  className="flex-row items-center gap-2 py-[3px]"
                  style={{ opacity: dimmed ? 0.45 : 1 }}
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
      )}

      {alert != null && (
        <View className="flex-row items-start gap-2 rounded-xl bg-warning-soft px-3 py-2.5">
          <Ionicons name="pulse-outline" size={15} color={colors.warning} />
          <Text className="flex-1 text-xs leading-4 text-warning">
            {alert.kind === "recency" ? (
              <>
                <Text className="text-xs font-bold text-warning">
                  {groupName(alert.group)}
                </Text>
                {alert.routineDayKey != null
                  ? t("progress.sinEstimuloSugerencia", {
                      count: alert.days,
                      dia: t(`daysLong.${alert.routineDayKey}`).toLowerCase(),
                    })
                  : t("progress.sinEstimulo", { count: alert.days })}
              </>
            ) : (
              <>
                <Text className="text-xs font-bold text-warning">
                  {groupName(alert.group)}
                </Text>
                {t("progress.desbalance")}
              </>
            )}
          </Text>
        </View>
      )}
    </Card>
  );
}
