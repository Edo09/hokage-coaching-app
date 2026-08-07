import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { useTranslation } from "react-i18next";

import { Card, SegmentedControl } from "@/src/components/ui";
import { PressableScale } from "@/src/lib/motion";
import { useColors } from "@/src/theme/colors";
import { Text, View } from "@/src/tw";
import type {
  NutritionPlanMeal,
  NutritionPlanOption,
  NutritionPlanWithDetails,
  PlanMealType,
} from "@/src/types/database";
import {
  appliesOn,
  formatRange,
  targetFor,
  visibleItems,
  visibleMeals,
  type ResolvedDay,
} from "@/src/utils/nutrition-plan";

type Props = {
  plan: NutritionPlanWithDetails;
  day: ResolvedDay;
  autoDay: ResolvedDay;
  overridden: boolean;
  onSelectDay: (day: ResolvedDay | null) => void;
  onRegister: (meal: NutritionPlanMeal, option: NutritionPlanOption) => void;
};

// Read-only render of the coach's protocol. Two filters run at once: applies_to
// hides whole slots, and each food's own day_type hides individual lines — which
// together are what "carb cycling" means in the client's hands.
export function NutritionPlanView({
  plan,
  day,
  autoDay,
  overridden,
  onSelectDay,
  onRegister,
}: Props) {
  const { t } = useTranslation();
  const colors = useColors();

  const target = targetFor(plan, day);
  const meals = visibleMeals(plan, day);

  const kcal = target ? formatRange(target.kcal_min, target.kcal_max) : null;
  const protein = target
    ? formatRange(target.protein_min_g, target.protein_max_g)
    : null;
  const carbs = target ? formatRange(target.carbs_min_g, target.carbs_max_g) : null;
  const fat = target ? formatRange(target.fat_min_g, target.fat_max_g) : null;
  const hasTarget = kcal != null || protein != null || carbs != null || fat != null;

  return (
    <View className="gap-3">
      {/* Plan header */}
      <Card className="gap-2">
        <View className="flex-row items-center gap-2">
          <View className="h-7 w-7 items-center justify-center rounded-lg bg-brand-primary/15">
            <Ionicons name="nutrition" size={16} color={colors.brandPrimary} />
          </View>
          <Text className="flex-1 text-base font-bold text-content-primary" numberOfLines={2}>
            {plan.name}
          </Text>
          <Text className="text-[10px] font-bold tracking-widest text-brand-primary">
            COACH
          </Text>
        </View>
        {plan.focus != null && (
          <Text className="text-sm text-content-secondary">{plan.focus}</Text>
        )}
      </Card>

      {/* Day-type control. Only shown when the plan actually cycles — otherwise
          there is only one kind of day and the toggle would be a lie. */}
      {plan.day_cycling && (
        <View className="gap-1.5">
          <SegmentedControl
            segments={[
              { key: "training", label: t("nutritionPlan.trainingDay") },
              { key: "rest", label: t("nutritionPlan.restDay") },
            ]}
            value={day}
            // Picking the day the program already implies clears the override,
            // so the screen goes back to following the training calendar.
            onChange={(k) => onSelectDay(k === autoDay ? null : (k as ResolvedDay))}
          />
          <Text className="text-xs text-content-tertiary">
            {overridden
              ? t("nutritionPlan.overridden")
              : t("nutritionPlan.autoFromProgram")}
          </Text>
        </View>
      )}

      {/* Today's macro target — the only numbers the coach wrote. */}
      {hasTarget && (
        <Card className="gap-1.5">
          <Text className="text-[10px] font-bold tracking-widest text-content-tertiary">
            {t("nutritionPlan.targetTitle").toUpperCase()}
          </Text>
          {kcal != null && (
            <Text
              className="text-2xl font-bold text-content-primary"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {kcal}{" "}
              <Text className="text-sm font-normal text-content-tertiary">
                {t("nutritionPlan.kcal")}
              </Text>
            </Text>
          )}
          <View className="flex-row flex-wrap gap-x-4 gap-y-1">
            {protein != null && (
              <MacroBit label={t("nutritionPlan.protein")} value={protein} color={colors.macroProtein} />
            )}
            {carbs != null && (
              <MacroBit label={t("nutritionPlan.carbs")} value={carbs} color={colors.macroCarbs} />
            )}
            {fat != null && (
              <MacroBit label={t("nutritionPlan.fat")} value={fat} color={colors.macroFat} />
            )}
          </View>
        </Card>
      )}

      {meals.map((meal) => (
        <MealCard
          key={meal.id}
          meal={meal}
          day={day}
          cycling={plan.day_cycling}
          onRegister={(option) => onRegister(meal, option)}
        />
      ))}

      {plan.notes != null && (
        <Card className="gap-1.5">
          <Text className="text-[10px] font-bold tracking-widest text-content-tertiary">
            {t("nutritionPlan.coachNotes").toUpperCase()}
          </Text>
          <Text className="text-sm text-content-secondary">{plan.notes}</Text>
        </Card>
      )}
    </View>
  );
}

function MacroBit({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <Text className="text-sm" style={{ fontVariant: ["tabular-nums"] }}>
      <Text className="font-bold" style={{ color }}>
        {label}{" "}
      </Text>
      <Text className="text-content-secondary">{value} g</Text>
    </Text>
  );
}

const MEAL_ICON: Record<PlanMealType, React.ComponentProps<typeof Ionicons>["name"]> = {
  breakfast: "sunny-outline",
  lunch: "restaurant-outline",
  dinner: "moon-outline",
  snack: "cafe-outline",
  pre_workout: "flash-outline",
  post_workout: "barbell-outline",
};

function MealCard({
  meal,
  day,
  cycling,
  onRegister,
}: {
  meal: NutritionPlanMeal;
  day: ResolvedDay;
  cycling: boolean;
  onRegister: (option: NutritionPlanOption) => void;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const applies = !cycling || appliesOn(meal.applies_to, day);
  const title = meal.label ?? t(`meals.${meal.meal_type as "breakfast"}`, meal.meal_type);

  return (
    <Card className="gap-2">
      <View className="flex-row items-center gap-2">
        <Ionicons name={MEAL_ICON[meal.meal_type]} size={15} color={colors.contentTertiary} />
        <Text className="flex-1 text-base font-bold text-content-primary">{title}</Text>
        {meal.is_optional && (
          <View className="rounded-full bg-info/15 px-2 py-[2px]">
            <Text className="text-[10px] font-bold text-info">
              {t("nutritionPlan.optional")}
            </Text>
          </View>
        )}
      </View>

      {meal.time_hint != null && (
        <Text className="text-xs text-content-tertiary">{meal.time_hint}</Text>
      )}

      {!applies ? (
        // The slot is gated off today — but its note is the substitution the
        // client still needs, so it surfaces instead of the slot vanishing.
        <View className="rounded-lg bg-warning/10 p-2.5">
          <Text className="text-xs font-bold text-warning">
            {t("nutritionPlan.slotHiddenToday")}
          </Text>
          {meal.notes != null && (
            <Text className="mt-1 text-sm text-content-secondary">{meal.notes}</Text>
          )}
        </View>
      ) : (
        <>
          {meal.nutrition_plan_options.map((option) => {
            const foods = cycling ? visibleItems(option, day) : option.nutrition_plan_option_items;
            if (foods.length === 0) return null;
            return (
              <View key={option.id} className="rounded-lg bg-surface-elevated p-2.5 gap-1.5">
                {option.label != null && (
                  <Text className="text-xs font-bold text-content-tertiary">
                    {option.label}
                  </Text>
                )}
                {foods.map((food) => (
                  <Text key={food.id} className="text-sm text-content-secondary">
                    · {food.name}
                  </Text>
                ))}
                {option.notes != null && (
                  <Text className="text-xs text-content-tertiary">{option.notes}</Text>
                )}
                <PressableScale
                  haptic
                  onPress={() => onRegister(option)}
                  accessibilityRole="button"
                  accessibilityLabel={t("nutritionPlan.register")}
                  className="mt-1 flex-row items-center justify-center gap-1.5 rounded-lg bg-brand-primary/15 py-2"
                >
                  <Ionicons name="camera-outline" size={14} color={colors.brandPrimary} />
                  <Text className="text-xs font-bold text-brand-primary">
                    {t("nutritionPlan.register")}
                  </Text>
                </PressableScale>
              </View>
            );
          })}
          {meal.notes != null && (
            <Text className="text-xs text-content-tertiary">{meal.notes}</Text>
          )}
        </>
      )}
    </Card>
  );
}
