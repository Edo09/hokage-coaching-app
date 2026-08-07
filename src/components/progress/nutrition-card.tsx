import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";

import { Card } from "@/src/components/ui";
import { useColors } from "@/src/theme/colors";
import { Pressable, Text, View } from "@/src/tw";
import { dateKeyToDate, toDateKey } from "@/src/utils/dates";
import type { NutritionStats, Periodo } from "@/src/utils/progress";

const TABULAR = { fontVariant: ["tabular-nums" as const] };
const CHART_HEIGHT = 96;

type NutritionCardProps = {
  periodo: Periodo;
  nutrition: NutritionStats & { goal: number | null; hasData: boolean };
};

// kcal + protein adherence explains the weight trend. Fully computable from
// meal_items today. Unlogged days render no bar and never count against
// adherence; >110% of goal turns the bar amber (warning, not failure-red).
export function NutritionCard({ periodo, nutrition }: NutritionCardProps) {
  const colors = useColors();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "es" ? "es-ES" : "en-US";

  const { perDay, goal } = nutrition;
  const max = Math.max(...perDay.map((d) => d.kcal ?? 0), goal ?? 0, 1);
  const today = toDateKey();

  const dayLetters = t("progress.dayLetters").split(",");
  const letterFor = (date: string) => {
    const idx = (dateKeyToDate(date).getDay() + 6) % 7;
    return dayLetters[idx] ?? "";
  };

  if (!nutrition.hasData) {
    return (
      <Card className="gap-3">
        <Text className="text-[15px] font-bold text-content-primary">
          {t("progress.nutricion")}
        </Text>
        <View className="items-center gap-2 py-3">
          <View className="h-12 w-12 items-center justify-center rounded-full border border-border bg-brand-dark">
            <Ionicons name="nutrition-outline" size={22} color={colors.contentMuted} />
          </View>
          <Text className="px-4 text-center text-[13px] text-content-tertiary">
            {t("progress.emptyNutricion")}
          </Text>
          <Pressable
            onPress={() => router.push("/(tabs)/nutrition")}
            accessibilityRole="button"
            hitSlop={8}
          >
            <Text className="text-[13px] font-semibold text-brand-primary">
              {t("progress.registrarComida")}
            </Text>
          </Pressable>
        </View>
      </Card>
    );
  }

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-[15px] font-bold text-content-primary">
          {t("progress.nutricion")}
        </Text>
        <Text className="text-[11px] text-content-muted">
          {periodo === "week" ? t("progress.ultimos7") : t("progress.ultimos30")}
        </Text>
      </View>

      <View>
        <View
          className={periodo === "week" ? "flex-row items-end gap-2" : "flex-row items-end gap-1"}
          style={{ height: CHART_HEIGHT }}
        >
          {perDay.map((day) => {
            if (day.kcal == null) return <View key={day.date} className="flex-1" />;
            const over = goal != null && day.kcal > 1.1 * goal;
            return (
              <View
                key={day.date}
                className={over ? "flex-1 rounded-t bg-warning" : "flex-1 rounded-t bg-brand-secondary"}
                style={{ height: Math.max(3, (day.kcal / max) * CHART_HEIGHT) }}
              />
            );
          })}
        </View>
        {goal != null && (
          <View
            className="absolute left-0 right-0 items-end"
            style={{ bottom: (goal / max) * CHART_HEIGHT }}
            pointerEvents="none"
          >
            <Text
              className="bg-surface px-1 font-semibold text-content-tertiary"
              style={{ fontSize: 9, marginBottom: 1, ...TABULAR }}
            >
              {t("progress.metaLinea", { n: goal.toLocaleString(locale) })}
            </Text>
            <View
              className="w-full border-t border-dashed border-content-tertiary"
              style={{ borderTopWidth: 1.5 }}
            />
          </View>
        )}
      </View>

      {periodo === "week" && (
        <View className="flex-row gap-2">
          {perDay.map((day) => (
            <Text
              key={day.date}
              className={
                day.date === today
                  ? "flex-1 text-center text-[10px] font-medium text-content-primary"
                  : "flex-1 text-center text-[10px] font-medium text-content-muted"
              }
            >
              {letterFor(day.date)}
            </Text>
          ))}
        </View>
      )}

      <View className="flex-row border-t border-border pt-3">
        <View className="flex-1 items-center gap-0.5">
          <Text className="text-base font-bold text-content-primary" style={TABULAR}>
            {nutrition.avgKcal != null ? nutrition.avgKcal.toLocaleString(locale) : "—"}
          </Text>
          <Text className="text-[11px] text-content-muted">
            {t("progress.kcalPromedio")}
          </Text>
        </View>
        <View className="w-px bg-border" />
        <View className="flex-1 items-center gap-0.5">
          <Text className="text-base font-bold text-content-primary" style={TABULAR}>
            {nutrition.avgProtein != null ? `${nutrition.avgProtein} g` : "—"}
          </Text>
          <Text className="text-[11px] text-content-muted">
            {t("progress.proteinaDia")}
          </Text>
        </View>
        <View className="w-px bg-border" />
        <View className="flex-1 items-center gap-0.5">
          <Text className="text-base font-bold text-success" style={TABULAR}>
            {goal != null ? `${nutrition.adherentDays}/${nutrition.loggedDays}` : "—"}
          </Text>
          <Text className="text-[11px] text-content-muted">
            {t("progress.diasEnMeta")}
          </Text>
        </View>
      </View>

      {nutrition.macro != null && (
        <View className="gap-2">
          <View className="h-2 flex-row overflow-hidden rounded-full">
            <View style={{ flex: nutrition.macro.protein, backgroundColor: colors.macroProtein }} />
            <View style={{ flex: nutrition.macro.carbs, backgroundColor: colors.macroCarbs }} />
            <View style={{ flex: nutrition.macro.fat, backgroundColor: colors.macroFat }} />
          </View>
          <View className="flex-row gap-4">
            <MacroLegend color={colors.macroProtein} label={`${t("meals.proteinName")} ${nutrition.macro.protein}%`} />
            <MacroLegend color={colors.macroCarbs} label={`${t("meals.carbsName")} ${nutrition.macro.carbs}%`} />
            <MacroLegend color={colors.macroFat} label={`${t("meals.fatName")} ${nutrition.macro.fat}%`} />
          </View>
        </View>
      )}
    </Card>
  );
}

function MacroLegend({ color, label }: { color: string; label: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <View className="h-2 w-2 rounded" style={{ backgroundColor: color }} />
      <Text className="text-[11px] text-content-tertiary" style={TABULAR}>
        {label}
      </Text>
    </View>
  );
}
