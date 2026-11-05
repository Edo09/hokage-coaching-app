import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { useTranslation } from "react-i18next";

import { DoneCheckbox } from "@/src/components/program/program-exercise-row";
import { CapsLabel, Card, PosterText } from "@/src/components/ui";
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
const TABULAR = { fontVariant: ["tabular-nums" as const] };

export function SupplementStackView({
  plan,
  day,
  cycling,
  isTaken,
  onToggleTaken,
}: {
  plan: SupplementPlanWithDetails;
  day: ResolvedDay;
  /** Only filter by day type when the nutrition plan actually cycles. */
  cycling: boolean;
  /** Today's check-off, by supplement name (use-supplement-log.ts). */
  isTaken: (name: string) => boolean;
  onToggleTaken: (name: string) => void;
}) {
  const { t } = useTranslation();
  const colors = useColors();

  const items = cycling
    ? visibleSupplements(plan.supplement_plan_items, day)
    : plan.supplement_plan_items;
  // The "horario" table is derived, never stored — group by when it's taken.
  const schedule = supplementSchedule(items);
  const takenCount = items.filter((i) => isTaken(i.name)).length;

  return (
    <View className="gap-3">
      {/* Poster header: the stack's name and today's check-offs. */}
      <Card
        topAccent={items.length > 0 ? takenCount / items.length : undefined}
        className="gap-2 rounded-[20px] p-[18px]"
      >
        <View className="flex-row items-center gap-3">
          <View className="h-[40px] w-[40px] items-center justify-center rounded-[12px] border border-brand-primary bg-brand-primary-soft">
            <Ionicons name="medkit" size={18} color={colors.brandPrimary} />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <CapsLabel size={8.5} em={0.16} className="font-extrabold text-brand-primary">
              COACH
            </CapsLabel>
            <PosterText size={22} numberOfLines={2}>
              {plan.name}
            </PosterText>
          </View>
        </View>
        {items.length > 0 && (
          <Text className="text-[12px] text-content-tertiary" style={TABULAR}>
            {t("supplements.takenToday", { done: takenCount, total: items.length })}
          </Text>
        )}
      </Card>

      {TIERS.map((tier) => {
        const rows = items.filter((i) => i.tier === tier);
        if (rows.length === 0) return null;
        return (
          <Card key={tier} className="gap-2.5">
            <View className="flex-row flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <CapsLabel size={8.5} em={0.16} className="font-extrabold text-content-tertiary">
                {t(`supplements.tier${cap(tier)}` as "supplements.tierBase")}
              </CapsLabel>
              <Text className="text-[11px] text-content-muted">
                {t(`supplements.tier${cap(tier)}Hint` as "supplements.tierBaseHint")}
              </Text>
            </View>
            {rows.map((item) => (
              <SupplementRow
                key={item.id}
                item={item}
                taken={isTaken(item.name)}
                onToggle={() => onToggleTaken(item.name)}
              />
            ))}
          </Card>
        );
      })}

      {schedule.length > 0 && (
        <Card className="gap-2">
          <CapsLabel size={8.5} em={0.16} className="font-extrabold text-content-tertiary">
            {t("supplements.scheduleTitle")}
          </CapsLabel>
          {schedule.map((group) => (
            <View key={group.slot} className="flex-row gap-2">
              <Text className="w-[104px] text-[12px] font-bold text-content-secondary">
                {t(`supplements.timing_${group.slot}` as "supplements.timing_any")}
              </Text>
              <Text className="flex-1 text-[12px] text-content-tertiary">
                {group.items.map((i) => i.name).join(" + ")}
              </Text>
            </View>
          ))}
        </Card>
      )}

      {plan.notes != null && (
        <Card>
          <Text className="text-[13px] text-content-secondary">{plan.notes}</Text>
        </Card>
      )}
    </View>
  );
}

function SupplementRow({
  item,
  taken,
  onToggle,
}: {
  item: SupplementPlanItem;
  taken: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="flex-row gap-3 rounded-[14px] border border-border bg-brand-dark p-3">
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-[14px] font-bold text-content-primary">{item.name}</Text>
        {item.dose != null && <Text className="text-[13px] text-content-secondary">{item.dose}</Text>}
        {(item.timing_note ?? item.timing_slot !== "any") && (
          <Text className="text-[12px] text-content-tertiary">
            {item.timing_note ?? t(`supplements.timing_${item.timing_slot}` as "supplements.timing_any")}
          </Text>
        )}
        {item.purpose != null && <Text className="text-[12px] text-content-tertiary">{item.purpose}</Text>}
        {item.notes != null && <Text className="text-[12px] italic text-content-tertiary">{item.notes}</Text>}
      </View>
      <DoneCheckbox
        done={taken}
        name={item.name}
        onToggle={onToggle}
        label={t(taken ? "supplements.markNotTaken" : "supplements.markTaken", { name: item.name })}
      />
    </View>
  );
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
