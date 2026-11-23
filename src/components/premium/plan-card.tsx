import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { useTranslation } from "react-i18next";

import { Badge, PosterText } from "@/src/components/ui";
import type { PlanKind } from "@/src/config/purchases";
import { PressableScale } from "@/src/lib/motion";
import { useColors } from "@/src/theme/colors";
import { Text, View } from "@/src/tw";
import { cn } from "@/src/utils/cn";
import type { Plan } from "@/src/utils/purchase";

const NAME: Record<PlanKind, string> = {
  monthly: "premium.paywall.planMonthly",
  quarterly: "premium.paywall.planQuarterly",
  annual: "premium.paywall.planAnnual",
};

const PERIOD: Record<PlanKind, string> = {
  monthly: "premium.paywall.periodMonthly",
  quarterly: "premium.paywall.periodQuarterly",
  annual: "premium.paywall.periodAnnual",
};

type Props = {
  plan: Plan;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
};

/**
 * One plan of the paywall: its name and length, the store's own price string
 * as the biggest number on the card (what Apple asks for: the amount charged
 * is the most prominent figure), the per-month equivalent and the saving
 * beneath it, smaller.
 */
export function PlanCard({ plan, selected, disabled, onSelect }: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const name = t(NAME[plan.kind]);
  const period = t(PERIOD[plan.kind]);
  // The monthly plan's per-month figure is its price: nothing to add.
  const perMonth =
    plan.kind !== "monthly" && plan.perMonthString != null
      ? t("premium.paywall.perMonth", { price: plan.perMonthString })
      : null;

  return (
    <PressableScale
      onPress={onSelect}
      disabled={disabled}
      haptic
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={`${name}, ${plan.priceString} ${period}`}
      className={cn(
        "gap-2.5 rounded-[20px] border bg-surface p-4",
        selected ? "border-brand-primary" : "border-border",
        disabled && "opacity-60",
      )}
    >
      <View className="flex-row items-center gap-3">
        <Ionicons
          name={selected ? "radio-button-on" : "radio-button-off"}
          size={20}
          color={selected ? colors.brandPrimary : colors.contentMuted}
        />
        <View className="flex-1">
          <Text className="text-[15px] font-bold text-content-primary">{name}</Text>
          <Text className="text-[12px] text-content-tertiary">{period}</Text>
        </View>
        <View className="items-end">
          <PosterText size={24} tabular>
            {plan.priceString}
          </PosterText>
          {perMonth != null && <Text className="text-[11px] text-content-tertiary">{perMonth}</Text>}
        </View>
      </View>
      {plan.savingPercent != null && (
        <Badge variant="trend-up" icon={null}>
          {t("premium.paywall.saving", { percent: plan.savingPercent })}
        </Badge>
      )}
    </PressableScale>
  );
}
