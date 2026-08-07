import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Card, Chip, Input, Screen, useToast } from "@/src/components/ui";
import { useMeals } from "@/src/hooks/use-meals";
import { mealPhotoUrl } from "@/src/services/meal-photos";
import { useColors } from "@/src/theme/colors";
import { Text, View } from "@/src/tw";
import type { MealType } from "@/src/types/database";
import { MEAL_SLOTS } from "@/src/utils/meal-slots";

export default function EditFoodScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const toast = useToast();
  const { itemId } = useLocalSearchParams<{ itemId?: string }>();
  const { meals, updateDiaryItem } = useMeals();

  // No useMemo: the React Compiler refuses to compile the component when it
  // can't preserve the manual memoization ("Compilation Skipped") — and it
  // auto-memoizes this anyway. The scan is cheap regardless.
  const findEntry = () => {
    for (const meal of meals) {
      const item = meal.meal_items.find((i) => i.id === itemId);
      if (item != null) return { item, meal };
    }
    return null;
  };
  const entry = findEntry();

  // Prefilled once on mount; the entry exists because we navigated from its row
  const [name, setName] = useState(entry?.item.name ?? "");
  const [nameError, setNameError] = useState<string | undefined>();
  const [mealType, setMealType] = useState<MealType>(
    entry?.meal.meal_type ?? "breakfast",
  );
  const [calories, setCalories] = useState(
    entry != null ? String(entry.item.calories) : "",
  );
  const [protein, setProtein] = useState(
    entry != null ? String(entry.item.protein_g) : "",
  );
  const [carbs, setCarbs] = useState(
    entry != null ? String(entry.item.carbs_g) : "",
  );
  const [fat, setFat] = useState(entry != null ? String(entry.item.fat_g) : "");
  const [portion, setPortion] = useState(entry?.item.portion ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Item vanished (removed on another device / sync) — nothing to edit
    if (entry == null) router.back();
  }, [entry]);

  if (entry == null) return null;

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(t("common.fieldRequired"));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }
    try {
      setSaving(true);
      await updateDiaryItem(
        entry.item.id,
        {
          name: trimmed,
          calories: parseInt(calories, 10) || 0,
          protein_g: parseFloat(protein) || 0,
          carbs_g: parseFloat(carbs) || 0,
          fat_g: parseFloat(fat) || 0,
          portion: portion.trim() || null,
        },
        mealType,
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast.show({ type: "success", message: t("meals.foodUpdated") });
      router.back();
    } catch {
      toast.show({ type: "error", message: t("meals.couldNotUpdate") });
    } finally {
      setSaving(false);
    }
  };

  const kcalPreview = parseInt(calories, 10) || 0;

  return (
    <Screen keyboard>
      <View className="gap-5">
        {/* Full-width hero photo when the item has one */}
        {entry.item.photo_path != null && (
          <View className="rounded-2xl overflow-hidden border border-border">
            <Image
              source={{ uri: mealPhotoUrl(entry.item.photo_path) }}
              style={{ width: "100%", height: 180 }}
              contentFit="cover"
              transition={200}
              cachePolicy="disk"
            />
          </View>
        )}

        {/* What & where */}
        <Card className="gap-4">
          <Input
            label={t("meals.foodName")}
            value={name}
            onChangeText={(text) => {
              setName(text);
              if (nameError != null) setNameError(undefined);
            }}
            error={nameError}
            className="bg-brand-dark"
          />
          <View className="flex-row gap-2 flex-wrap">
            {MEAL_SLOTS.map((type) => (
              <Chip
                key={type}
                label={t(`meals.${type}`, { defaultValue: type })}
                selected={mealType === type}
                onPress={() => setMealType(type)}
              />
            ))}
          </View>
        </Card>

        {/* Nutrition */}
        <Card className="gap-4">
          <View className="flex-row items-center justify-between">
            <Text className="font-semibold text-content-primary">
              {t("meals.nutrition")}
            </Text>
            <View className="flex-row items-baseline gap-1">
              <Text
                className="text-xl font-bold"
                style={{ color: colors.brandPrimary, fontVariant: ["tabular-nums"] }}
              >
                {kcalPreview}
              </Text>
              <Text className="text-xs text-content-tertiary">{t("meals.kcal")}</Text>
            </View>
          </View>

          <View className="flex-row gap-3">
            <Input
              label={t("meals.calories")}
              keyboardType="number-pad"
              value={calories}
              onChangeText={setCalories}
              containerClassName="flex-1"
              textAlign="center"
              className="bg-brand-dark"
            />
            <Input
              label={t("meals.protein")}
              keyboardType="decimal-pad"
              value={protein}
              onChangeText={setProtein}
              containerClassName="flex-1"
              textAlign="center"
              className="bg-brand-dark"
            />
          </View>
          <View className="flex-row gap-3">
            <Input
              label={t("meals.carbs")}
              keyboardType="decimal-pad"
              value={carbs}
              onChangeText={setCarbs}
              containerClassName="flex-1"
              textAlign="center"
              className="bg-brand-dark"
            />
            <Input
              label={t("meals.fat")}
              keyboardType="decimal-pad"
              value={fat}
              onChangeText={setFat}
              containerClassName="flex-1"
              textAlign="center"
              className="bg-brand-dark"
            />
          </View>
          {/* Portion gets a full row so long values ("3 manzanas (~750g)") never clip */}
          <Input
            label={t("meals.portion")}
            placeholder={t("meals.portionPlaceholder")}
            value={portion}
            onChangeText={setPortion}
            className="bg-brand-dark"
          />
        </Card>
      </View>

      <Button size="lg" onPress={handleSave} loading={saving} className="mt-2">
        {t("common.save")}
      </Button>
    </Screen>
  );
}
