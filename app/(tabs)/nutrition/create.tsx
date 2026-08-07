import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Chip, Input, Screen, useToast } from "@/src/components/ui";
import { useAuth } from "@/src/hooks/use-auth";
import { useMeals } from "@/src/hooks/use-meals";
import { enter } from "@/src/lib/motion";
import { useIsOnline } from "@/src/lib/online";
import {
  estimateMealNutrition,
  estimateMealNutritionFromPhoto,
} from "@/src/services/ai-nutrition";
import { uploadMealPhoto } from "@/src/services/meal-photos";
import type { ImageInput } from "@/src/services/llm";
import { useColors } from "@/src/theme/colors";
import { Pressable, Text, View } from "@/src/tw";
import { AnimatedView } from "@/src/tw/animated";
import type { MealType } from "@/src/types/database";
import { formatDayLabel, isDateKey, toDateKey } from "@/src/utils/dates";
import { MEAL_SLOTS, suggestedSlot } from "@/src/utils/meal-slots";

type PickedPhoto = ImageInput & { uri: string };

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["images"],
  quality: 0.5,
  base64: true,
  allowsEditing: false,
  exif: false,
};

type Estimate = {
  name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  portion: string;
};

export default function AddFoodScreen() {
  const colors = useColors();
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const online = useIsOnline();
  const { user } = useAuth();
  const { getOrCreateSlotMeal, addMealItem } = useMeals();
  const params = useLocalSearchParams<{ mealType?: string; date?: string }>();

  const todayKey = toDateKey();
  // Bad/missing slot → time-of-day suggestion; bad/future date → today
  const [mealType, setMealType] = useState<MealType>(() =>
    MEAL_SLOTS.includes(params.mealType as MealType)
      ? (params.mealType as MealType)
      : suggestedSlot(),
  );
  const date =
    isDateKey(params.date) && params.date <= todayKey ? params.date : todayKey;

  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | undefined>();
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [aiEstimate, setAiEstimate] = useState(true);
  const [loading, setLoading] = useState(false);

  // Manual nutrition (shown when the AI path is unavailable or disabled)
  const [manualCalories, setManualCalories] = useState("");
  const [manualProtein, setManualProtein] = useState("");
  const [manualCarbs, setManualCarbs] = useState("");
  const [manualFat, setManualFat] = useState("");
  const [manualPortion, setManualPortion] = useState("");
  const manualVisible = photo == null && (!aiEstimate || !online);

  const toPicked = (asset: ImagePicker.ImagePickerAsset): PickedPhoto | null => {
    if (!asset.base64) return null;
    return {
      uri: asset.uri,
      base64: asset.base64,
      mimeType: asset.mimeType ?? "image/jpeg",
    };
  };

  const pickFromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      toast.show({ type: "info", message: t("meals.cameraPermission") });
      return;
    }
    const result = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
    if (!result.canceled && result.assets[0] != null) {
      const picked = toPicked(result.assets[0]);
      if (picked != null) setPhoto(picked);
      if (nameError != null) setNameError(undefined);
    }
  };

  const pickFromGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
    if (!result.canceled && result.assets[0] != null) {
      const picked = toPicked(result.assets[0]);
      if (picked != null) setPhoto(picked);
      if (nameError != null) setNameError(undefined);
    }
  };

  const handleAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed && photo == null) {
      setNameError(t("meals.nameOrPhotoRequired"));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }

    try {
      setLoading(true);

      // Resolve nutrition BEFORE touching data, so a failed photo analysis
      // never creates an orphan slot container.
      let estimate: Estimate | null = null;
      let aiFailed = false;

      if (photo != null) {
        try {
          if (!online) throw new Error("offline");
          estimate = await estimateMealNutritionFromPhoto(
            photo,
            i18n.language,
            trimmed || undefined,
          );
        } catch {
          if (!trimmed) {
            // Nothing to name the food with — surface and stop.
            setNameError(t("meals.noFoodDetected"));
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
            return;
          }
          // Photo analysis failed but the user named the food — estimate
          // from the name instead of dropping the AI estimate entirely.
          try {
            estimate = online
              ? await estimateMealNutrition(trimmed, mealType, i18n.language)
              : null;
          } catch {
            estimate = null;
          }
          aiFailed = estimate == null;
        }
      } else if (aiEstimate && online) {
        try {
          estimate = await estimateMealNutrition(trimmed, mealType, i18n.language);
        } catch {
          aiFailed = true;
        }
      }

      // Persist the photo (best-effort) so it can thumbnail in the diary
      let photoPath: string | undefined;
      if (photo != null && online) {
        photoPath = (await uploadMealPhoto(user!.id, photo)) ?? undefined;
      }

      // The AI's refined name wins over the raw typed one (it keeps the
      // user's intent — fixes typos/casing); typed name is the fallback.
      const itemName = estimate?.name || trimmed;
      const meal = await getOrCreateSlotMeal(date, mealType);
      await addMealItem({
        meal_id: meal.id,
        name: itemName,
        calories: estimate?.calories ?? (parseInt(manualCalories, 10) || 0),
        protein_g: estimate?.protein_g ?? (parseFloat(manualProtein) || 0),
        carbs_g: estimate?.carbs_g ?? (parseFloat(manualCarbs) || 0),
        fat_g: estimate?.fat_g ?? (parseFloat(manualFat) || 0),
        portion: estimate?.portion ?? (manualPortion.trim() || undefined),
        photo_path: photoPath,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (aiFailed) {
        // Item landed, but with zero macros — tell the user why
        toast.show({ type: "info", message: t("meals.aiEstimateFailed") });
      } else {
        toast.show({
          type: "success",
          message: t("meals.foodAdded", { slot: t(`meals.${mealType}`) }),
        });
      }
      router.back(); // diary already shows the item optimistically
    } catch {
      toast.show({ type: "error", message: t("meals.couldNotAdd") });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen keyboard>
      <View className="gap-4">
        {/* Where this food is going */}
        <Text className="text-sm text-content-tertiary">
          {t("meals.addToSlot", { slot: t(`meals.${mealType}`) })} ·{" "}
          {formatDayLabel(date, i18n.language, t)}
        </Text>

        {/* Meal photo */}
        <View className="gap-2">
          <Text className="text-sm font-medium text-content-secondary">
            {t("meals.mealPhoto")}
          </Text>
          {photo == null ? (
            <>
              <View className="flex-row gap-2">
                <Button
                  variant="secondary"
                  icon="camera-outline"
                  onPress={pickFromCamera}
                  containerClassName="flex-1"
                  className="w-full"
                  disabled={loading || !online}
                >
                  {t("meals.takePhoto")}
                </Button>
                <Button
                  variant="secondary"
                  icon="images-outline"
                  onPress={pickFromGallery}
                  containerClassName="flex-1"
                  className="w-full"
                  disabled={loading || !online}
                >
                  {t("meals.fromGallery")}
                </Button>
              </View>
              <Text className="text-xs text-content-muted">
                {online ? t("meals.mealPhotoNote") : t("meals.photoRequiresInternet")}
              </Text>
            </>
          ) : (
            <View className="rounded-xl overflow-hidden border border-border">
              <Image
                source={{ uri: photo.uri }}
                style={{ width: "100%", height: 180 }}
                contentFit="cover"
              />
              {/* Inline rgba: bg-black/60 (opacity modifier) doesn't compile
                  under react-native-css */}
              <Pressable
                onPress={() => setPhoto(null)}
                accessibilityRole="button"
                accessibilityLabel={t("meals.removePhoto")}
                className="absolute top-2 right-2 h-8 w-8 items-center justify-center rounded-full"
                style={{ backgroundColor: "rgba(0, 0, 0, 0.6)" }}
              >
                <Ionicons name="close" size={18} color={colors.white} />
              </Pressable>
              <View
                className="absolute bottom-2 left-2 flex-row items-center gap-1.5 rounded-full px-3 py-1"
                style={{ backgroundColor: "rgba(0, 0, 0, 0.6)" }}
              >
                <Ionicons name="sparkles" size={12} color={colors.brandPrimary} />
                <Text className="text-xs text-white">{t("meals.aiEstimate")}</Text>
              </View>
            </View>
          )}
        </View>

        <Input
          label={t("meals.foodName")}
          placeholder={t("meals.foodNamePlaceholder")}
          value={name}
          onChangeText={(text) => {
            setName(text);
            if (nameError != null) setNameError(undefined);
          }}
          error={nameError}
        />

        {/* Slot selector (pre-selected from the diary, still changeable) */}
        <View className="gap-2">
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
        </View>

        {/* AI nutrition estimate toggle — photo implies AI, so only shown without one */}
        {photo == null && (
          <Pressable
            onPress={() => {
              if (!online) return;
              Haptics.selectionAsync().catch(() => {});
              setAiEstimate((v) => !v);
            }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: aiEstimate && online, disabled: !online }}
            className={`flex-row items-center gap-3 bg-surface border border-border rounded-xl p-4 ${online ? "" : "opacity-50"}`}
          >
            <Ionicons
              name={aiEstimate && online ? "checkbox" : "square-outline"}
              size={22}
              color={aiEstimate && online ? colors.brandPrimary : colors.contentMuted}
            />
            <View className="flex-1">
              <View className="flex-row items-center gap-1.5">
                <Ionicons name="sparkles" size={14} color={colors.brandPrimary} />
                <Text className="text-sm font-medium text-content-primary">
                  {t("meals.aiEstimate")}
                </Text>
              </View>
              <Text className="text-xs text-content-muted mt-0.5">
                {online ? t("meals.aiEstimateNote") : t("common.requiresInternet")}
              </Text>
            </View>
          </Pressable>
        )}

        {/* Manual nutrition when the AI path is off or unavailable */}
        {manualVisible && (
          <AnimatedView entering={enter()} className="gap-3">
            <Text className="text-sm font-medium text-content-secondary">
              {t("meals.manualNutrition")}
            </Text>
            <View className="flex-row gap-2">
              <Input
                label={t("meals.calories")}
                keyboardType="number-pad"
                value={manualCalories}
                onChangeText={setManualCalories}
                containerClassName="flex-1"
                textAlign="center"
                className="bg-brand-dark"
              />
              <Input
                label={t("meals.protein")}
                keyboardType="decimal-pad"
                value={manualProtein}
                onChangeText={setManualProtein}
                containerClassName="flex-1"
                textAlign="center"
                className="bg-brand-dark"
              />
            </View>
            <View className="flex-row gap-2">
              <Input
                label={t("meals.carbs")}
                keyboardType="decimal-pad"
                value={manualCarbs}
                onChangeText={setManualCarbs}
                containerClassName="flex-1"
                textAlign="center"
                className="bg-brand-dark"
              />
              <Input
                label={t("meals.fat")}
                keyboardType="decimal-pad"
                value={manualFat}
                onChangeText={setManualFat}
                containerClassName="flex-1"
                textAlign="center"
                className="bg-brand-dark"
              />
              <Input
                label={t("meals.portion")}
                placeholder={t("meals.portionPlaceholder")}
                value={manualPortion}
                onChangeText={setManualPortion}
                containerClassName="flex-1"
                textAlign="center"
                className="bg-brand-dark"
              />
            </View>
          </AnimatedView>
        )}
      </View>

      <Button size="lg" onPress={handleAdd} loading={loading} className="mt-2">
        {t("meals.addFood")}
      </Button>
    </Screen>
  );
}
