import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { MEAL_ICON } from "@/src/components/nutrition/meal-icons";
import { SharpChip } from "@/src/components/nutrition/sharp-chip";
import { StatusBox, type StatusBoxState } from "@/src/components/nutrition/status-box";
import { CapsLabel, PosterText, SkewButton } from "@/src/components/ui";
import { useRegistrationPhotoUri } from "@/src/lib/photo-queue";
import { useColors } from "@/src/theme/colors";
import { Pressable, Text, View } from "@/src/tw";
import type { MealItem, NutritionPlanMeal } from "@/src/types/database";
import { cn } from "@/src/utils/cn";
import { missingEstimate } from "@/src/utils/meal-counting";
import { optionFoods, optionLabel, type TodayMeal } from "@/src/utils/meal-registration";
import type { ResolvedDay } from "@/src/utils/nutrition-plan";

// One of today's plan meals (spec «Meal card states»): pending, open (the next
// meal, or one the client tapped), or registered from the plan, as «otra
// cosa» or as «No la comí», with the estimate state on the right. Buttons are
// never nested: the card's own tap target is a backdrop behind its content
// (as program-exercise-row.tsx does).

type Props = {
  item: TodayMeal;
  name: string;
  isNext: boolean;
  open: boolean;
  day: ResolvedDay;
  cycling: boolean;
  popKey: number;
  onOpen: () => void;
  onRegister: (optionId: string | null) => void;
  onEdit: () => void;
  onRetry: () => void;
};

export function MealCard(props: Props) {
  if (props.item.registration != null) return <RegisteredCard {...props} registration={props.item.registration} />;
  if (props.open) return <OpenCard {...props} />;
  return <PendingCard {...props} />;
}

function MealIcon({ meal, red = false }: { meal: NutritionPlanMeal; red?: boolean }) {
  const colors = useColors();
  return (
    <View
      className={cn(
        "h-[40px] w-[40px] items-center justify-center rounded-[12px] border",
        red ? "border-brand-primary bg-brand-primary-soft" : "border-border bg-brand-dark",
      )}
    >
      <Ionicons name={MEAL_ICON[meal.meal_type]} size={19} color={red ? colors.brandPrimary : colors.contentMuted} />
    </View>
  );
}

function PendingCard({ item, name, popKey, onOpen }: Props) {
  const { t } = useTranslation();
  const { meal } = item;
  return (
    <View
      className={cn(
        "flex-row items-center gap-2.5 rounded-[16px] border border-border bg-surface p-2.5",
        meal.is_optional && "opacity-70",
      )}
    >
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={name} className="absolute inset-0" />
      <View pointerEvents="none">
        <MealIcon meal={meal} />
      </View>
      <View pointerEvents="none" className="min-w-0 flex-1 gap-1.5">
        <PosterText size={15} numberOfLines={1}>
          {name}
        </PosterText>
        <View className="flex-row items-center gap-1.5">
          {meal.is_optional && <SharpChip tone="neutral">{t("mealReg.optional")}</SharpChip>}
          <Text numberOfLines={1} className="flex-shrink text-[11px] text-content-tertiary">
            {[meal.time_hint, t("mealReg.optionsCount", { count: item.options.length })].filter(Boolean).join(" · ")}
          </Text>
        </View>
      </View>
      <View pointerEvents="none">
        <StatusBox state="pending" popKey={popKey} />
      </View>
    </View>
  );
}

function OpenCard({ item, name, isNext, day, cycling, popKey, onRegister }: Props) {
  const { t } = useTranslation();
  const { meal, options } = item;
  const [tab, setTab] = useState(0);
  const selected = options[Math.min(tab, options.length - 1)] ?? null;
  const foods = selected != null ? optionFoods(selected, day, cycling) : [];

  return (
    <View className="gap-3 rounded-[16px] border border-brand-primary bg-surface p-3">
      <View className="flex-row items-center gap-2.5">
        <MealIcon meal={meal} red />
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row items-center gap-2">
            <PosterText size={19} numberOfLines={1}>
              {name}
            </PosterText>
            {isNext && <SharpChip tone="solid">{t("mealReg.next")}</SharpChip>}
          </View>
          <Text numberOfLines={1} className="text-[11px] text-content-tertiary">
            {[meal.time_hint, t("mealReg.optionsCount", { count: options.length })].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <StatusBox state={isNext ? "next" : "pending"} popKey={popKey} />
      </View>

      {options.length > 1 && (
        <View className="flex-row gap-4 border-b border-border">
          {options.map((o, i) => (
            <Pressable
              key={o.id}
              onPress={() => setTab(i)}
              accessibilityRole="tab"
              accessibilityState={{ selected: i === tab }}
              className={cn("pb-2", i === tab && "border-b-2 border-brand-primary")}
            >
              <CapsLabel
                size={9.5}
                em={0.1}
                className={cn("font-extrabold", i === tab ? "text-content-primary" : "text-content-muted")}
              >
                {optionLabel(o, meal.nutrition_plan_options.indexOf(o), (n) => t("mealReg.optionN", { n }))}
              </CapsLabel>
            </Pressable>
          ))}
        </View>
      )}

      {foods.length > 0 && (
        <View className="gap-1.5">
          {foods.map((f) => (
            <View key={f.id} className="flex-row items-center gap-2">
              <View className="h-[5px] w-[5px] bg-brand-primary" style={{ transform: [{ skewX: "-10deg" }] }} />
              <Text className="flex-1 text-[13px] text-content-primary">{f.name}</Text>
            </View>
          ))}
        </View>
      )}
      {selected?.notes != null && selected.notes.trim() !== "" && (
        <Text className="text-[12px] text-content-tertiary">{selected.notes}</Text>
      )}

      <SkewButton onPress={() => onRegister(selected?.id ?? null)}>
        {t("mealReg.registerMeal", { meal: name.toLocaleLowerCase() })}
      </SkewButton>
    </View>
  );
}

function RegisteredCard({ item, name, popKey, onEdit, onRetry, registration }: Props & { registration: MealItem }) {
  const { t } = useTranslation();
  const colors = useColors();
  const photo = useRegistrationPhotoUri(registration);
  const { meal } = item;
  const kind = registration.kind ?? "plan";
  const gap = missingEstimate(registration);
  const state: StatusBoxState = kind === "skipped" ? "skipped" : kind === "other" ? "other" : "plan";

  // «Opción N» counts by the coach's plan order, as the open card's tabs do.
  const option = item.options.find((o) => o.id === registration.plan_option_id);
  const chip =
    kind === "skipped" ? (
      <SharpChip tone="neutral">{t("mealReg.skipped")}</SharpChip>
    ) : kind === "other" ? (
      <SharpChip tone="neutral">{t("mealReg.otherMeal")}</SharpChip>
    ) : option != null ? (
      <SharpChip tone="red">
        {optionLabel(option, meal.nutrition_plan_options.indexOf(option), (n) => t("mealReg.optionN", { n }))}
      </SharpChip>
    ) : (
      <SharpChip tone="red">{t("mealReg.fromPlan")}</SharpChip>
    );
  const detail = kind === "other" ? registration.name : meal.time_hint;

  return (
    <View className="flex-row items-center gap-2.5 rounded-[16px] border border-border bg-surface p-2.5">
      <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={name} className="absolute inset-0" />
      <View pointerEvents="none">
        {photo != null && kind !== "skipped" ? (
          <Image source={{ uri: photo }} style={{ width: 40, height: 40, borderRadius: 12 }} contentFit="cover" />
        ) : (
          <MealIcon meal={meal} />
        )}
      </View>
      <View pointerEvents="none" className="min-w-0 flex-1 gap-1.5">
        <PosterText size={15} numberOfLines={1} className={cn(kind === "skipped" && "text-content-tertiary")}>
          {name}
        </PosterText>
        <View className="flex-row items-center gap-1.5">
          {chip}
          {detail != null && detail !== "" && (
            <Text numberOfLines={1} className="flex-shrink text-[11px] text-content-tertiary">
              {detail}
            </Text>
          )}
        </View>
      </View>
      {kind !== "skipped" &&
        (gap === "pending" ? (
          <View pointerEvents="none" className="flex-row items-center gap-1">
            <Ionicons name="sparkles" size={10} color={colors.brandAccent} />
            <CapsLabel size={9.5} em={0.1} className="font-extrabold text-brand-accent">
              {t("mealReg.estimating")}
            </CapsLabel>
          </View>
        ) : gap === "failed" ? (
          <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button" className="flex-row items-center gap-1">
            <Ionicons name="refresh" size={11} color={colors.contentMuted} />
            <CapsLabel size={9.5} em={0.1} className="font-extrabold text-content-muted">
              {t("mealReg.notEstimated")}
            </CapsLabel>
          </Pressable>
        ) : (
          <View pointerEvents="none" className="items-end">
            <PosterText size={18} tabular>
              {Math.round(registration.calories)}
            </PosterText>
            <CapsLabel size={8.5}>kcal</CapsLabel>
          </View>
        ))}
      <View pointerEvents="none">
        <StatusBox state={state} popKey={popKey} />
      </View>
    </View>
  );
}

/** A meal the day type leaves out today, kept for its note (the substitution
 *  the client still needs). No box: there is nothing to register. */
export function NotTodayRow({ name, note }: { name: string; note: string }) {
  const { t } = useTranslation();
  return (
    <View className="gap-1 rounded-[16px] border border-border bg-surface px-3 py-2.5 opacity-80">
      <View className="flex-row items-center gap-2">
        <PosterText size={13} numberOfLines={1} className="text-content-tertiary">
          {name}
        </PosterText>
        <SharpChip tone="neutral">{t("mealReg.notToday")}</SharpChip>
      </View>
      <Text className="text-[12px] text-content-secondary">{note}</Text>
    </View>
  );
}
