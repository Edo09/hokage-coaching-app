import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { CapsLabel, Card, PosterText } from "@/src/components/ui";
import { useColors } from "@/src/theme/colors";
import { Pressable, Text, View } from "@/src/tw";
import type { MealWithItems, NutritionPlanTarget } from "@/src/types/database";
import { macrosConsumed } from "@/src/utils/calories";
import { combinedEstimateState, hoyAccent, hoyStatus, itemsOf } from "@/src/utils/meal-counting";
import { formatRange } from "@/src/utils/nutrition-plan";

const TABULAR = { fontVariant: ["tabular-nums" as const] };

// Spec «Hoy card»: today's registered kcal against the coach's range, the
// three macros, and whether an estimate is still missing. Without a target
// row it shows the totals alone.
export function TodayCard({
  target,
  todays,
  onRetry,
}: {
  target: NutritionPlanTarget | null;
  todays: MealWithItems[];
  onRetry: () => void;
}) {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const locale = i18n.language === "es" ? "es-ES" : "en-US";
  const fmt = (n: number) => Math.round(n).toLocaleString(locale);

  const totals = macrosConsumed(todays);
  const kcal = Math.round(totals.kcal);
  const min = target?.kcal_min ?? null;
  const max = target?.kcal_max ?? null;
  const kcalTarget = formatRange(min, max, fmt);
  const status = hoyStatus(kcal, min, max);
  const gap = combinedEstimateState(itemsOf(todays));

  return (
    <Card
      topAccent={kcalTarget != null ? hoyAccent(kcal, min, max) : undefined}
      className="gap-3 rounded-[20px] p-[18px]"
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1 gap-1.5">
          <View className="flex-row items-center gap-1">
            <CapsLabel size={8.5} em={0.16} className="font-extrabold text-content-tertiary">
              {`${t("mealReg.today")} ·`}
            </CapsLabel>
            <Ionicons name="sparkles" size={9} color={colors.brandAccent} />
            <CapsLabel size={8.5} em={0.16} className="font-extrabold text-brand-accent">
              {t("mealReg.aiEstimated")}
            </CapsLabel>
          </View>
          <View className="flex-row items-baseline gap-1.5">
            <PosterText size={30} tabular>
              {fmt(kcal)}
            </PosterText>
            <Text numberOfLines={1} className="flex-shrink text-[12px] font-semibold text-content-muted" style={TABULAR}>
              {kcalTarget != null ? `/ ${kcalTarget} kcal` : "kcal"}
            </Text>
          </View>
          {gap === "pending" ? (
            <View className="flex-row items-center gap-1">
              <Ionicons name="sparkles" size={10} color={colors.brandAccent} />
              <CapsLabel size={9.5} em={0.1} className="font-extrabold text-brand-accent">
                {t("mealReg.estimating")}
              </CapsLabel>
            </View>
          ) : gap === "failed" ? (
            <Pressable
              onPress={onRetry}
              hitSlop={8}
              accessibilityRole="button"
              className="flex-row items-center gap-1 self-start"
            >
              <Ionicons name="refresh" size={11} color={colors.contentMuted} />
              <CapsLabel size={9.5} em={0.1} className="font-extrabold text-content-muted">
                {t("mealReg.notEstimated")}
              </CapsLabel>
            </Pressable>
          ) : null}
        </View>
        {status != null && (
          <CapsLabel
            size={9.5}
            em={0.08}
            className={status.kind === "over" ? "font-extrabold text-warning" : "font-extrabold text-success"}
          >
            {status.kind === "remaining"
              ? t("mealReg.remaining", { n: fmt(status.n) })
              : status.kind === "over"
                ? t("mealReg.over", { n: fmt(status.n) })
                : t("mealReg.inRange")}
          </CapsLabel>
        )}
      </View>

      <View className="flex-row border-t border-border pt-3">
        <MacroColumn
          label={t("meals.proteinName")}
          value={totals.protein_g}
          target={formatRange(target?.protein_min_g ?? null, target?.protein_max_g ?? null, fmt)}
          color={colors.macroProtein}
          fmt={fmt}
        />
        <View className="w-px bg-border" />
        <MacroColumn
          label={t("meals.carbsName")}
          value={totals.carbs_g}
          target={formatRange(target?.carbs_min_g ?? null, target?.carbs_max_g ?? null, fmt)}
          color={colors.macroCarbs}
          fmt={fmt}
        />
        <View className="w-px bg-border" />
        <MacroColumn
          label={t("meals.fatName")}
          value={totals.fat_g}
          target={formatRange(target?.fat_min_g ?? null, target?.fat_max_g ?? null, fmt)}
          color={colors.macroFat}
          fmt={fmt}
        />
      </View>
    </Card>
  );
}

/** «92 / 150–155 g» as the coach set it, or «92 g» with no target. */
function MacroColumn({
  label,
  value,
  target,
  color,
  fmt,
}: {
  label: string;
  value: number;
  target: string | null;
  color: string;
  fmt: (n: number) => string;
}) {
  return (
    <View className="flex-1 items-center gap-1">
      <View className="flex-row items-baseline gap-1">
        <PosterText size={15} tabular style={{ color }}>
          {fmt(value)}
        </PosterText>
        <Text className="text-[11px] font-semibold text-content-muted" style={TABULAR}>
          {target != null ? `/ ${target} g` : "g"}
        </Text>
      </View>
      <CapsLabel size={8.5} em={0.16} className="font-extrabold text-content-tertiary">
        {label}
      </CapsLabel>
    </View>
  );
}
