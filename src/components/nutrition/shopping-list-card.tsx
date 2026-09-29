import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Card, ExpandChevron } from "@/src/components/ui";
import { Reveal } from "@/src/lib/motion";
import { useColors } from "@/src/theme/colors";
import { Pressable, Text } from "@/src/tw";
import type { NutritionPlanWithDetails } from "@/src/types/database";
import { shoppingList } from "@/src/utils/nutrition-plan";

// Ticks are a per-device convenience (like the history section's collapse
// state), keyed by plan so a new plan starts with a clean list.
const storageKey = (planId: string) => `hokage-shopping-${planId}`;

/** Collapsible grocery list: every food in the plan once, tick as you shop. */
export function ShoppingListCard({ plan }: { plan: NutritionPlanWithDetails }) {
  const { t } = useTranslation();
  const colors = useColors();
  const items = useMemo(() => shoppingList(plan), [plan]);
  const [open, setOpen] = useState(false);
  // Tagged with the plan they belong to, so switching plans never shows the
  // previous plan's ticks while the new ones load.
  const [saved, setSaved] = useState<{ planId: string; names: string[] } | null>(null);
  const checked = saved?.planId === plan.id ? saved.names : [];

  useEffect(() => {
    AsyncStorage.getItem(storageKey(plan.id))
      .then((raw) => setSaved({ planId: plan.id, names: raw ? (JSON.parse(raw) as string[]) : [] }))
      .catch(() => {});
  }, [plan.id]);

  const persist = (names: string[]) => {
    setSaved({ planId: plan.id, names });
    AsyncStorage.setItem(storageKey(plan.id), JSON.stringify(names)).catch(() => {});
  };

  const toggle = (name: string) =>
    persist(checked.includes(name) ? checked.filter((n) => n !== name) : [...checked, name]);

  const clear = () => persist([]);

  if (items.length === 0) return null;
  const done = items.filter((n) => checked.includes(n)).length;

  return (
    <Card className="gap-2">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        className="flex-row items-center gap-2"
      >
        <Ionicons name="cart-outline" size={16} color={colors.contentTertiary} />
        <Text className="flex-1 text-[10px] font-bold tracking-widest text-content-tertiary">
          {t("nutritionPlan.shoppingList").toUpperCase()}
        </Text>
        <Text className="text-xs text-content-tertiary" style={{ fontVariant: ["tabular-nums"] }}>
          {done}/{items.length}
        </Text>
        <ExpandChevron open={open} size={16} color={colors.contentTertiary} />
      </Pressable>

      <Reveal open={open} className="gap-1">
        {items.map((name) => {
          const isChecked = checked.includes(name);
          return (
            <Pressable
              key={name}
              onPress={() => toggle(name)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isChecked }}
              className="flex-row items-center gap-2.5 py-1.5"
            >
              <Ionicons
                name={isChecked ? "checkbox" : "square-outline"}
                size={20}
                color={isChecked ? colors.success : colors.contentTertiary}
              />
              <Text
                className={
                  isChecked
                    ? "flex-1 text-sm text-content-tertiary line-through"
                    : "flex-1 text-sm text-content-primary"
                }
              >
                {name}
              </Text>
            </Pressable>
          );
        })}
        {done > 0 && (
          <Pressable onPress={clear} accessibilityRole="button" className="self-start py-1">
            <Text className="text-sm font-semibold text-brand-primary">
              {t("nutritionPlan.shoppingListClear")}
            </Text>
          </Pressable>
        )}
      </Reveal>
    </Card>
  );
}
