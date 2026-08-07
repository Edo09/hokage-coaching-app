import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { useTranslation } from "react-i18next";

import { Card } from "@/src/components/ui";
import { useColors } from "@/src/theme/colors";
import { Text, View } from "@/src/tw";
import type {
  SupplementPlanItem,
  SupplementPlanWithDetails,
  SupplementTier,
} from "@/src/types/database";
import {
  supplementSchedule,
  visibleSupplements,
  type ResolvedDay,
} from "@/src/utils/nutrition-plan";

const TIERS: SupplementTier[] = ["base", "conditional", "optional"];

export function SupplementStackView({
  plan,
  day,
  cycling,
}: {
  plan: SupplementPlanWithDetails;
  day: ResolvedDay;
  /** Only filter by day type when the nutrition plan actually cycles. */
  cycling: boolean;
}) {
  const { t } = useTranslation();
  const colors = useColors();

  const items = cycling
    ? visibleSupplements(plan.supplement_plan_items, day)
    : plan.supplement_plan_items;
  // The "horario" table is derived, never stored — group by when it's taken.
  const schedule = supplementSchedule(items);

  return (
    <View className="gap-3">
      <Card className="flex-row items-center gap-2">
        <View className="h-7 w-7 items-center justify-center rounded-lg bg-brand-primary/15">
          <Ionicons name="medkit" size={15} color={colors.brandPrimary} />
        </View>
        <Text className="flex-1 text-base font-bold text-content-primary" numberOfLines={2}>
          {plan.name}
        </Text>
        <Text className="text-[10px] font-bold tracking-widest text-brand-primary">COACH</Text>
      </Card>

      {TIERS.map((tier) => {
        const rows = items.filter((i) => i.tier === tier);
        if (rows.length === 0) return null;
        return (
          <Card key={tier} className="gap-2">
            <View className="flex-row items-baseline gap-2">
              <Text className="text-[10px] font-bold tracking-widest text-content-tertiary">
                {t(`supplements.tier${cap(tier)}` as "supplements.tierBase").toUpperCase()}
              </Text>
              <Text className="text-[10px] text-content-tertiary">
                {t(`supplements.tier${cap(tier)}Hint` as "supplements.tierBaseHint")}
              </Text>
            </View>
            {rows.map((item) => (
              <SupplementRow key={item.id} item={item} />
            ))}
          </Card>
        );
      })}

      {schedule.length > 0 && (
        <Card className="gap-2">
          <Text className="text-[10px] font-bold tracking-widest text-content-tertiary">
            {t("supplements.scheduleTitle").toUpperCase()}
          </Text>
          {schedule.map((group) => (
            <View key={group.slot} className="flex-row gap-2">
              <Text className="w-[104px] text-xs font-bold text-content-secondary">
                {t(`supplements.timing_${group.slot}` as "supplements.timing_any")}
              </Text>
              <Text className="flex-1 text-xs text-content-tertiary">
                {group.items.map((i) => i.name).join(" + ")}
              </Text>
            </View>
          ))}
        </Card>
      )}

      {plan.notes != null && (
        <Card>
          <Text className="text-sm text-content-secondary">{plan.notes}</Text>
        </Card>
      )}
    </View>
  );
}

function SupplementRow({ item }: { item: SupplementPlanItem }) {
  const { t } = useTranslation();
  return (
    <View className="rounded-lg bg-surface-elevated p-2.5 gap-0.5">
      <Text className="text-sm font-bold text-content-primary">{item.name}</Text>
      {item.dose != null && (
        <Text className="text-sm text-content-secondary">{item.dose}</Text>
      )}
      {(item.timing_note ?? item.timing_slot !== "any") && (
        <Text className="text-xs text-content-tertiary">
          {item.timing_note ??
            t(`supplements.timing_${item.timing_slot}` as "supplements.timing_any")}
        </Text>
      )}
      {item.purpose != null && (
        <Text className="text-xs text-content-tertiary">{item.purpose}</Text>
      )}
      {item.notes != null && (
        <Text className="text-xs text-content-tertiary italic">{item.notes}</Text>
      )}
    </View>
  );
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
