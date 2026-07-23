import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ScrollView as RNScrollView } from "react-native";

import { kgToUnit1, unitToKg, useWeightUnit } from "@/src/lib/weight-unit";

import { Button, Card, LoadingBlock, Screen, useToast } from "@/src/components/ui";
import { useAuth } from "@/src/hooks/use-auth";
import { useProfile } from "@/src/hooks/use-profile";
import { useColors } from "@/src/theme/colors";
import { useThemeScheme } from "@/src/theme/theme-store";
import { Pressable, Text, TextInput, View } from "@/src/tw";
import type { Profile } from "@/src/types/database";
import { recommendedCalorieGoal } from "@/src/utils/calories";
import { cn } from "@/src/utils/cn";


type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

function StatTile({
  label,
  unit,
  value,
  editing,
  onEdit,
  onChangeText,
  onBlur,
  keyboardType,
}: {
  label: string;
  unit: string;
  value: string;
  editing: boolean;
  onEdit: () => void;
  onChangeText: (v: string) => void;
  onBlur: () => void;
  keyboardType: "number-pad" | "decimal-pad";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={editing ? undefined : onEdit}
      className="flex-1 items-center gap-1 rounded-2xl border border-border bg-surface py-3"
    >
      <Text className="text-[10.5px] font-bold uppercase tracking-wider text-content-muted">
        {label}
      </Text>
      {editing ? (
        <TextInput
          autoFocus
          value={value}
          onChangeText={onChangeText}
          onBlur={onBlur}
          keyboardType={keyboardType}
          selectTextOnFocus
          className="min-w-12 p-0 text-center text-[22px] font-extrabold text-content-primary"
        />
      ) : (
        <Text className="text-[22px] font-extrabold text-content-primary">
          {value !== "" ? value : "—"}
        </Text>
      )}
      <Text className="text-[11.5px] text-content-muted">{unit}</Text>
    </Pressable>
  );
}

function ActivityOption({
  label,
  description,
  selected,
  onPress,
}: {
  label: string;
  description: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={cn(
        "flex-row items-start gap-2.5 rounded-xl border p-3",
        selected ? "border-brand-primary bg-info-soft" : "border-border bg-surface"
      )}
    >
      <View
        className={cn(
          "mt-0.5 h-4.5 w-4.5 items-center justify-center rounded-full border-2",
          selected ? "border-brand-primary" : "border-border-strong"
        )}
      >
        {selected && <View className="h-2 w-2 rounded-full bg-brand-primary" />}
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-semibold text-content-primary">{label}</Text>
        <Text className="text-xs text-content-muted">{description}</Text>
      </View>
    </Pressable>
  );
}

function ProfessionCard({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon: IoniconName;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={cn(
        "flex-1 flex-row items-center justify-center gap-2 rounded-xl border py-3",
        selected ? "border-brand-primary bg-info-soft" : "border-border bg-surface"
      )}
    >
      <Ionicons
        name={icon}
        size={18}
        color={selected ? colors.brandPrimaryDark : colors.contentTertiary}
      />
      <Text
        className={cn(
          "text-sm font-semibold",
          selected ? "text-brand-primary-dark" : "text-content-secondary"
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function ProfileScreen() {
  const colors = useColors();
  // Chip text color must follow the app theme (store), not the `dark:`
  // variant — on web that variant tracks the OS media query, which diverges
  // from the class-driven theme when an explicit mode is set.
  const scheme = useThemeScheme();
  const { t } = useTranslation();
  const toast = useToast();
  const { user } = useAuth();
  const { profile, loading, updateProfile } = useProfile(user?.id);
  // Deep-link from the dashboard's goal KPI: scroll to and flash the
  // calorie-goal field. `ts` changes per tap so repeat taps re-trigger.
  const { highlight, ts } = useLocalSearchParams<{ highlight?: string; ts?: string }>();
  const scrollRef = useRef<RNScrollView>(null);
  const nutritionY = useRef(0);
  const [highlightGoal, setHighlightGoal] = useState(false);

  const [age, setAge] = useState("");
  const [sex, setSex] = useState<Profile["sex"]>(null);
  const [heightCm, setHeightCm] = useState("");
  // Held in the DISPLAY unit (kg or lb) — converted to kg on save.
  const weightUnit = useWeightUnit();
  const [weightKg, setWeightKg] = useState("");
  const weightSeed = useCallback(
    (p: Profile | null | undefined) =>
      p?.weight_kg != null ? String(kgToUnit1(p.weight_kg, weightUnit)) : "",
    [weightUnit],
  );
  const [editingStat, setEditingStat] = useState<"age" | "height" | "weight" | null>(
    null
  );
  const [activityLevel, setActivityLevel] = useState<Profile["activity_level"]>(null);
  const [professionType, setProfessionType] = useState<Profile["profession_type"]>(null);
  const [calorieGoal, setCalorieGoal] = useState("");
  const [goal, setGoal] = useState<Profile["goal"]>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Hydrate the form whenever a new profile object arrives (initial load and
  // background refetches — the same trigger the old effect keyed on). Done as
  // a render-phase state adjustment instead of a sync-setState effect: React
  // re-renders immediately before committing, and the hooks lint forbids the
  // effect version for its cascading-render cost.
  const [seededProfile, setSeededProfile] = useState<Profile | null>(null);
  if (profile != null && profile !== seededProfile) {
    setSeededProfile(profile);
    setAge(profile.age != null ? String(profile.age) : "");
    setSex(profile.sex);
    setHeightCm(profile.height_cm != null ? String(profile.height_cm) : "");
    setWeightKg(weightSeed(profile));
    setActivityLevel(profile.activity_level);
    setProfessionType(profile.profession_type);
    setCalorieGoal(profile.calorie_goal != null ? String(profile.calorie_goal) : "");
    setGoal(profile.goal);
  }

  useEffect(() => {
    if (highlight !== "calorie-goal" || loading) return;
    // Next tick, not synchronously — sync setState in an effect cascades
    // renders (same pattern as the rest-timer effect in routines/[id])
    const onTimer = setTimeout(() => setHighlightGoal(true), 0);
    // Small delay so the section's onLayout has reported its position
    const scrollTimer = setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, nutritionY.current - 12),
        animated: true,
      });
    }, 300);
    const clearTimer = setTimeout(() => setHighlightGoal(false), 2500);
    return () => {
      clearTimeout(onTimer);
      clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, [highlight, ts, loading]);

  // Live recommendation from the form's current values, so it updates as the
  // user edits age/sex/height/weight/activity before saving.
  const recommendedGoal = recommendedCalorieGoal({
    age: parseInt(age, 10) || null,
    sex,
    height_cm: parseFloat(heightCm) || null,
    weight_kg: unitToKg(parseFloat(weightKg), weightUnit) || null,
    activity_level: activityLevel,
    goal,
  });

  // Enable save only when something actually differs from the loaded profile
  // (same string-coercion as the seeding effect above, so they stay in sync).
  const dirty =
    age !== (profile?.age != null ? String(profile.age) : "") ||
    sex !== (profile?.sex ?? null) ||
    heightCm !== (profile?.height_cm != null ? String(profile.height_cm) : "") ||
    weightKg !== weightSeed(profile) ||
    activityLevel !== (profile?.activity_level ?? null) ||
    professionType !== (profile?.profession_type ?? null) ||
    goal !== (profile?.goal ?? null) ||
    calorieGoal !== (profile?.calorie_goal != null ? String(profile.calorie_goal) : "");

  const clearError = () => {
    if (formError != null) setFormError(null);
  };

  const validate = (): string | null => {
    const ageN = parseInt(age, 10);
    if (isNaN(ageN) || ageN < 13 || ageN > 120) return t("onboarding.ageBetween");
    if (!sex) return t("onboarding.fillAgeSex");
    const h = parseFloat(heightCm);
    if (isNaN(h) || h < 50 || h > 300) return t("onboarding.heightBetween");
    const w = unitToKg(parseFloat(weightKg), weightUnit);
    if (isNaN(w) || w < 20 || w > 500) return t("onboarding.weightBetween");
    if (!activityLevel || !professionType)
      return t("onboarding.selectActivityProfession");
    if (!goal) return t("profile.selectGoal");
    if (calorieGoal.trim() !== "") {
      const cg = parseInt(calorieGoal, 10);
      if (isNaN(cg) || cg < 800 || cg > 10000) return t("profile.calorieGoalBetween");
    }
    return null;
  };

  const handleSave = async () => {
    const error = validate();
    if (error != null) {
      setFormError(error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }
    try {
      setSaving(true);
      await updateProfile({
        age: parseInt(age, 10),
        sex,
        height_cm: parseFloat(heightCm),
        weight_kg: Math.round(unitToKg(parseFloat(weightKg), weightUnit) * 10) / 10,
        activity_level: activityLevel,
        profession_type: professionType,
        goal,
        calorie_goal: calorieGoal.trim() !== "" ? parseInt(calorieGoal, 10) : null,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast.show({ type: "success", message: t("profile.profileUpdated") });
    } catch {
      toast.show({ type: "error", message: t("common.somethingWentWrong") });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View className="flex-1 bg-brand-dark">
        <LoadingBlock />
      </View>
    );
  }

  return (
    <Screen
      keyboard
      scrollRef={scrollRef}
      contentContainerClassName="px-4 pt-5 pb-4 gap-4"
      footer={
        <View className="gap-2 border-t border-border bg-surface px-4 py-3">
          {formError != null && (
            <Text className="text-sm text-error">{formError}</Text>
          )}
          <Button
            onPress={handleSave}
            loading={saving}
            disabled={!dirty}
            className="w-full"
          >
            {t("profile.saveChanges")}
          </Button>
        </View>
      }
    >
      <Text className="-mt-1 text-[13px] text-content-tertiary">
        {t("profile.subtitle")}
      </Text>

      {/* Datos personales */}
      <Card className="gap-3.5">
        <Text className="text-[15px] font-bold text-content-primary">
          {t("onboarding.personalData")}
        </Text>

        <View className="flex-row gap-2.5">
          <StatTile
            label={t("onboarding.age")}
            unit={t("profile.unitYears")}
            value={age}
            editing={editingStat === "age"}
            onEdit={() => {
              Haptics.selectionAsync().catch(() => {});
              setEditingStat("age");
            }}
            onChangeText={(v) => {
              setAge(v);
              clearError();
            }}
            onBlur={() => setEditingStat(null)}
            keyboardType="number-pad"
          />
          <StatTile
            label={t("onboarding.heightLabel")}
            unit={t("onboarding.unitCm")}
            value={heightCm}
            editing={editingStat === "height"}
            onEdit={() => {
              Haptics.selectionAsync().catch(() => {});
              setEditingStat("height");
            }}
            onChangeText={(v) => {
              setHeightCm(v);
              clearError();
            }}
            onBlur={() => setEditingStat(null)}
            keyboardType="decimal-pad"
          />
          <StatTile
            label={t("profile.statWeight")}
            unit={weightUnit}
            value={weightKg}
            editing={editingStat === "weight"}
            onEdit={() => {
              Haptics.selectionAsync().catch(() => {});
              setEditingStat("weight");
            }}
            onChangeText={(v) => {
              setWeightKg(v);
              clearError();
            }}
            onBlur={() => setEditingStat(null)}
            keyboardType="decimal-pad"
          />
        </View>

        <View className="gap-1.5">
          <Text className="text-[12.5px] font-semibold text-content-secondary">
            {t("onboarding.sex")}
          </Text>
          <View className="flex-row gap-1 rounded-xl bg-surface-elevated p-1">
            {(["male", "female"] as const).map((s) => {
              const selected = sex === s;
              return (
                <Pressable
                  key={s}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setSex(s);
                    clearError();
                  }}
                  className={cn(
                    "flex-1 items-center justify-center rounded-lg py-2.5",
                    selected ? "bg-brand-primary" : "bg-transparent"
                  )}
                >
                  <Text
                    className={cn(
                      "text-sm font-semibold",
                      selected ? "text-white" : "text-content-secondary"
                    )}
                  >
                    {t(s === "male" ? "onboarding.male" : "onboarding.female")}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Card>

      {/* Actividad diaria */}
      <Card className="gap-3.5">
        <Text className="text-[15px] font-bold text-content-primary">
          {t("profile.activityDailyTitle")}
        </Text>

        <View className="gap-2">
          <ActivityOption
            label={t("onboarding.sedentary")}
            description={t("profile.sedentaryDesc")}
            selected={activityLevel === "sedentary"}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setActivityLevel("sedentary");
              clearError();
            }}
          />
          <ActivityOption
            label={t("onboarding.active")}
            description={t("onboarding.activeDesc")}
            selected={activityLevel === "active"}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setActivityLevel("active");
              clearError();
            }}
          />
          <ActivityOption
            label={t("onboarding.veryActive")}
            description={t("profile.veryActiveDesc")}
            selected={activityLevel === "very_active"}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setActivityLevel("very_active");
              clearError();
            }}
          />
        </View>

        <View className="gap-2">
          <Text className="text-[12.5px] font-semibold text-content-secondary">
            {t("onboarding.professionType")}
          </Text>
          <View className="flex-row gap-2">
            <ProfessionCard
              label={t("profile.desk")}
              icon="desktop-outline"
              selected={professionType === "desk"}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setProfessionType("desk");
                clearError();
              }}
            />
            <ProfessionCard
              label={t("profile.physical")}
              icon="barbell-outline"
              selected={professionType === "physical"}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setProfessionType("physical");
                clearError();
              }}
            />
          </View>
        </View>
      </Card>

      {/* Objetivo — shapes both the AI training plan and the calorie goal */}
      <Card className="gap-3.5">
        <Text className="text-[15px] font-bold text-content-primary">
          {t("profile.goalTitle")}
        </Text>
        <Text className="-mt-2 text-xs text-content-muted">
          {t("profile.goalSubtitle")}
        </Text>

        <View className="gap-2">
          <ActivityOption
            label={t("profile.goalLoseWeight")}
            description={t("profile.goalLoseWeightDesc")}
            selected={goal === "lose_weight"}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setGoal("lose_weight");
              clearError();
            }}
          />
          <ActivityOption
            label={t("profile.goalGainMuscle")}
            description={t("profile.goalGainMuscleDesc")}
            selected={goal === "gain_muscle"}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setGoal("gain_muscle");
              clearError();
            }}
          />
          <ActivityOption
            label={t("profile.goalMaintain")}
            description={t("profile.goalMaintainDesc")}
            selected={goal === "maintain"}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setGoal("maintain");
              clearError();
            }}
          />
        </View>
      </Card>

      {/* Meta nutricional */}
      <View
        onLayout={(e) => {
          nutritionY.current = e.nativeEvent.layout.y;
        }}
        className={cn(
          "-m-0.5 rounded-2xl border-2",
          highlightGoal ? "border-brand-primary" : "border-transparent"
        )}
      >
        <Card className="gap-3">
          <View className="gap-0.5">
            <Text className="text-[15px] font-bold text-content-primary">
              {t("profile.nutritionGoal")}
            </Text>
            <Text className="text-xs text-content-muted">
              {t("profile.nutritionGoalSubtitle")}
            </Text>
          </View>

          {recommendedGoal != null && (
            <View className="flex-row items-center gap-3 rounded-2xl bg-info-soft p-3.5">
              <Ionicons name="flash" size={20} color={colors.brandPrimary} />
              <View className="flex-1 gap-0.5">
                <Text
                  className="text-xs font-semibold"
                  style={{ color: scheme === "dark" ? colors.white : colors.brandPrimaryDark }}
                >
                  {t("profile.recommendedCaption")}
                </Text>
                <Text
                  className="text-xl font-extrabold"
                  style={{ color: scheme === "dark" ? colors.white : colors.brandPrimaryDark }}
                >
                  {t("profile.recommendedValue", { kcal: recommendedGoal })}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setCalorieGoal(String(recommendedGoal));
                  clearError();
                }}
                className="rounded-lg bg-brand-primary px-4 py-2.5"
              >
                <Text className="text-sm font-bold text-white">
                  {t("profile.useRecommended")}
                </Text>
              </Pressable>
            </View>
          )}

          <View className="flex-row items-center gap-3 py-0.5">
            <View className="h-px flex-1 bg-border" />
            <Text className="text-[11.5px] text-content-muted">
              {t("profile.orDefineOwnGoal")}
            </Text>
            <View className="h-px flex-1 bg-border" />
          </View>

          <View className="flex-row items-center rounded-xl border border-border bg-surface px-3.5">
            <TextInput
              value={calorieGoal}
              onChangeText={(v) => {
                setCalorieGoal(v);
                clearError();
              }}
              placeholder={t("profile.calorieGoalPlaceholder")}
              placeholderTextColor={colors.contentMuted}
              keyboardType="number-pad"
              accessibilityLabel={t("profile.calorieGoal")}
              className="flex-1 py-3 text-base text-content-primary"
            />
            <Text className="text-[12.5px] text-content-muted">{t("home.kcal")}</Text>
          </View>
        </Card>
      </View>

      {/* Training plan (días/semana, duración, días disponibles) is coach-set in
          the Admin Web Panel — hidden here so the client can't diverge from it. */}
    </Screen>
  );
}
