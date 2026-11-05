import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Actionsheet,
  ActionsheetBackdrop,
  ActionsheetContent,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
  ActionsheetItem,
  ActionsheetItemText,
} from "@/components/ui/actionsheet";
import { SharpChip } from "@/src/components/nutrition/sharp-chip";
import { useColors } from "@/src/theme/colors";
import { Pressable, Text } from "@/src/tw";
import type { ResolvedDay } from "@/src/utils/nutrition-plan";

const DAYS: ResolvedDay[] = ["training", "rest"];

/**
 * Today's day type on a cycling plan: «⚡ Día de entreno» (red) or «Día de
 * descanso», and whether it follows the program or the client changed it. A
 * tap offers the two days; the parent clears the override when the client
 * picks the program's own day.
 */
export function DayTypeChip({
  day,
  overridden,
  onChange,
}: {
  day: ResolvedDay;
  overridden: boolean;
  onChange: (day: ResolvedDay) => void;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const label = (d: ResolvedDay) => t(d === "training" ? "mealReg.trainingDay" : "mealReg.restDay");

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label(day)}, ${t(overridden ? "mealReg.overridden" : "mealReg.autoFromProgram")}`}
        hitSlop={6}
        className="flex-shrink flex-row items-center gap-2"
      >
        {day === "training" ? (
          <SharpChip tone="red" icon="flash">
            {label(day)}
          </SharpChip>
        ) : (
          <SharpChip tone="neutral">{label(day)}</SharpChip>
        )}
        <Text numberOfLines={1} className="flex-shrink text-[11px] text-content-tertiary">
          {t(overridden ? "mealReg.overridden" : "mealReg.autoFromProgram")}
        </Text>
        <Ionicons name="chevron-down" size={12} color={colors.contentTertiary} />
      </Pressable>

      <Actionsheet isOpen={open} onClose={() => setOpen(false)}>
        <ActionsheetBackdrop />
        <ActionsheetContent>
          <ActionsheetDragIndicatorWrapper>
            <ActionsheetDragIndicator />
          </ActionsheetDragIndicatorWrapper>
          {DAYS.map((d) => (
            <ActionsheetItem
              key={d}
              onPress={() => {
                setOpen(false);
                if (d !== day) onChange(d);
              }}
            >
              <Ionicons
                name={d === "training" ? "flash-outline" : "moon-outline"}
                size={20}
                color={d === day ? colors.brandPrimary : colors.contentSecondary}
              />
              <ActionsheetItemText className="flex-1">{label(d)}</ActionsheetItemText>
              {d === day && <Ionicons name="checkmark" size={18} color={colors.brandPrimary} />}
            </ActionsheetItem>
          ))}
        </ActionsheetContent>
      </Actionsheet>
    </>
  );
}
