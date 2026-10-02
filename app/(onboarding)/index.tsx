import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Keyboard, Platform } from "react-native";
import RAnimated, {
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from "react-native-reanimated";

import { Button, Chip, Input, Screen, useToast } from "@/src/components/ui";
import { useAuth } from "@/src/hooks/use-auth";
import { useProfile } from "@/src/hooks/use-profile";
import { DUR, EASE_OUT, enter, exit, slideEnter } from "@/src/lib/motion";
import { requestPermission } from "@/src/lib/notification-permission";
import { setReminderPrefs } from "@/src/lib/reminder-prefs";
import { setWeightUnit } from "@/src/lib/weight-unit";
import { useColors } from "@/src/theme/colors";
import { Pressable, Text, View } from "@/src/tw";
import { AnimatedView } from "@/src/tw/animated";
import type { ProfileGoal } from "@/src/types/database";
import { cn } from "@/src/utils/cn";

// The last step asks for notification permission, for the local reminders on
// the client's training days. Reminders don't run on web, so there the step
// is left out and the training-plan step stays the last one.
const ASKS_REMINDERS = Platform.OS !== "web";
const REMINDERS_STEP = 5;
const TOTAL_STEPS = ASKS_REMINDERS ? 6 : 5;

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_VALUES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

type FormData = {
  age: string;
  sex: "male" | "female" | "other" | null;
  height_cm: string;
  height_ft: string;
  height_in: string;
  height_unit: "cm" | "ft";
  weight: string;
  weight_unit: "kg" | "lbs";
  activity_level: "sedentary" | "active" | "very_active" | null;
  profession_type: "desk" | "physical" | null;
  goal: ProfileGoal | null;
  days_per_week: string;
  session_duration: string;
  available_days: string[];
};

// Canonical storage is metric; imperial inputs convert on validate/submit.
const toHeightCm = (form: FormData): number =>
  form.height_unit === "cm"
    ? parseFloat(form.height_cm)
    : (parseFloat(form.height_ft || "0") * 12 + parseFloat(form.height_in || "0")) * 2.54;

const toWeightKg = (form: FormData): number =>
  form.weight_unit === "kg" ? parseFloat(form.weight) : parseFloat(form.weight) * 0.453592;

function OptionButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const handlePress = () => {
    Haptics.selectionAsync().catch(() => {});
    onPress();
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={cn(
        "flex-1 py-3 rounded-xl items-center border",
        selected ? "bg-brand-primary border-brand-primary" : "bg-surface border-border"
      )}
      onPress={handlePress}
    >
      <Text
        className={cn(
          "font-semibold text-sm",
          selected ? "text-white" : "text-content-secondary"
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ProgressSegment({ active }: { active: boolean }) {
  const colors = useColors();
  const progress = useDerivedValue(() =>
    withTiming(active ? 1 : 0, { duration: DUR.base, easing: EASE_OUT }),
  );
  const fill = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [colors.surfaceElevated, colors.brandPrimary],
    ),
  }));
  return (
    <RAnimated.View style={[{ flex: 1, height: 4, borderRadius: 999 }, fill]} />
  );
}

function ProgressBar({ step }: { step: number }) {
  return (
    <View className="flex-row gap-2 px-6 mt-4">
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <ProgressSegment key={i} active={i <= step} />
      ))}
    </View>
  );
}

export default function Onboarding() {
  const colors = useColors();
  const { t } = useTranslation();
  const toast = useToast();
  const { user, markOnboarded } = useAuth();
  const { updateProfile } = useProfile(user?.id);
  const [step, setStep] = useState(0);
  // Slide direction for the step transition; set in the same batch as setStep
  const [direction, setDirection] = useState<1 | -1>(1);
  const [saving, setSaving] = useState(false);
  // «Activar» was tapped: its button shows the spinner while the phone's
  // prompt is up and during the save that follows.
  const [enabling, setEnabling] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>({
    age: "",
    sex: null,
    height_cm: "",
    height_ft: "",
    height_in: "",
    height_unit: "cm",
    weight: "",
    weight_unit: "kg",
    activity_level: null,
    profession_type: null,
    goal: null,
    days_per_week: "4",
    session_duration: "60",
    available_days: [],
  });

  const updateForm = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (stepError != null) setStepError(null);
  };

  const toggleDay = (day: string) => {
    setForm((prev) => ({
      ...prev,
      available_days: prev.available_days.includes(day)
        ? prev.available_days.filter((d) => d !== day)
        : [...prev.available_days, day],
    }));
    if (stepError != null) setStepError(null);
  };

  const failStep = (message: string): false => {
    setStepError(message);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    return false;
  };

  const validateStep = (): boolean => {
    switch (step) {
      case 0: {
        if (!form.age || !form.sex) return failStep(t("onboarding.fillAgeSex"));
        const age = parseInt(form.age, 10);
        if (isNaN(age) || age < 13 || age > 120) return failStep(t("onboarding.ageBetween"));
        return true;
      }
      case 1: {
        const heightMissing =
          form.height_unit === "cm" ? !form.height_cm : !form.height_ft;
        if (heightMissing || !form.weight) return failStep(t("onboarding.fillHeightWeight"));
        const h = toHeightCm(form);
        const w = toWeightKg(form);
        if (isNaN(h) || h < 50 || h > 300) return failStep(t("onboarding.heightBetween"));
        if (isNaN(w) || w < 20 || w > 500) return failStep(t("onboarding.weightBetween"));
        return true;
      }
      case 2: {
        if (!form.activity_level || !form.profession_type)
          return failStep(t("onboarding.selectActivityProfession"));
        return true;
      }
      case 3: {
        if (!form.goal) return failStep(t("profile.selectGoal"));
        return true;
      }
      case 4: {
        const dpw = parseInt(form.days_per_week, 10);
        const sd = parseInt(form.session_duration, 10);
        if (isNaN(dpw) || dpw < 1 || dpw > 7) return failStep(t("onboarding.daysBetween"));
        if (isNaN(sd) || sd < 15 || sd > 300)
          return failStep(t("onboarding.durationBetween"));
        if (form.available_days.length === 0)
          return failStep(t("onboarding.selectAtLeastOneDay"));
        return true;
      }
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (!validateStep()) return;
    if (step < TOTAL_STEPS - 1) {
      // Dismiss before the swap so the exiting snapshot isn't taken
      // mid-keyboard-resize
      Keyboard.dismiss();
      setStepError(null);
      setDirection(1);
      setStep(step + 1);
    } else {
      handleSubmit();
    }
  };

  const handleBack = () => {
    if (step > 0) {
      Keyboard.dismiss();
      setStepError(null);
      setDirection(-1);
      setStep(step - 1);
    }
  };

  const handleSubmit = async () => {
    if (!user) return;
    try {
      setSaving(true);
      // Local-first: applies to the cache and queues the write, so
      // onboarding completes even offline.
      await updateProfile({
        age: parseInt(form.age, 10),
        sex: form.sex,
        height_cm: Math.round(toHeightCm(form) * 10) / 10,
        weight_kg: Math.round(toWeightKg(form) * 10) / 10,
        activity_level: form.activity_level,
        profession_type: form.profession_type,
        goal: form.goal,
        days_per_week: parseInt(form.days_per_week, 10),
        session_duration: parseInt(form.session_duration, 10),
        available_days: form.available_days,
        onboarding_completed: true,
      });
      markOnboarded();
      // The unit picked on the weight step becomes the app-wide preference.
      void setWeightUnit(form.weight_unit === "lbs" ? "lb" : "kg");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace("/(tabs)");
    } catch {
      toast.show({ type: "error", message: t("onboarding.couldNotSave") });
    } finally {
      setSaving(false);
    }
  };

  // «Activar»: training-day reminders on, the phone's permission prompt, then
  // the same save as «Ahora no». Onboarding finishes whatever the client
  // answers; a "no" can be turned around later in Ajustes → Notificaciones.
  // The preferences are per device, so an earlier client's "off" on this
  // phone (or a failed «Ahora no» save just before) doesn't stay.
  const handleEnableReminders = async () => {
    if (saving || enabling) return;
    setEnabling(true);
    void setReminderPrefs({ training: true });
    try {
      await requestPermission();
    } catch {
      // A prompt that fails only means no reminders; the save still runs
    }
    await handleSubmit();
    setEnabling(false);
  };

  // «Ahora no»: no prompt, and the training-day reminder off. Android 12 and
  // older allow notifications without asking, so without this the client
  // would get them anyway. Ajustes → Notificaciones turns it back on.
  const handleNotNow = async () => {
    if (saving || enabling) return;
    void setReminderPrefs({ training: false });
    await handleSubmit();
  };

  // Skipping marks onboarding as done with an empty profile; AI features stay
  // locked until the profile is completed from the Profile tab.
  const handleSkip = async () => {
    if (!user || saving) return;
    try {
      setSaving(true);
      await updateProfile({ onboarding_completed: true });
      markOnboarded();
      toast.show({ type: "info", message: t("onboarding.skipToast") });
      router.replace("/(tabs)");
    } catch {
      toast.show({ type: "error", message: t("onboarding.couldNotSave") });
    } finally {
      setSaving(false);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <View className="gap-6">
            <View className="gap-1">
              <Text className="text-2xl font-bold text-content-primary">
                {t("onboarding.personalData")}
              </Text>
              <Text className="text-content-tertiary text-base">
                {t("onboarding.tellUsAboutYou")}
              </Text>
            </View>

            <Input
              label={t("onboarding.age")}
              placeholder={t("onboarding.agePlaceholder")}
              keyboardType="number-pad"
              value={form.age}
              onChangeText={(v) => updateForm("age", v)}
            />

            <View className="gap-2">
              <Text className="text-sm font-medium text-content-secondary">
                {t("onboarding.sex")}
              </Text>
              <View className="flex-row gap-2">
                <OptionButton
                  label={t("onboarding.male")}
                  selected={form.sex === "male"}
                  onPress={() => updateForm("sex", "male")}
                />
                <OptionButton
                  label={t("onboarding.female")}
                  selected={form.sex === "female"}
                  onPress={() => updateForm("sex", "female")}
                />
                <OptionButton
                  label={t("onboarding.other")}
                  selected={form.sex === "other"}
                  onPress={() => updateForm("sex", "other")}
                />
              </View>
            </View>
          </View>
        );

      case 1:
        return (
          <View className="gap-6">
            <View className="gap-1">
              <Text className="text-2xl font-bold text-content-primary">
                {t("onboarding.bodyMeasurements")}
              </Text>
              <Text className="text-content-tertiary text-base">
                {t("onboarding.measurementsSubtitle")}
              </Text>
            </View>

            <View className="gap-2">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-medium text-content-secondary">
                  {t("onboarding.heightLabel")}
                </Text>
                <View className="flex-row gap-2">
                  <Chip
                    label={t("onboarding.unitCm")}
                    selected={form.height_unit === "cm"}
                    onPress={() => updateForm("height_unit", "cm")}
                  />
                  <Chip
                    label={t("onboarding.unitFt")}
                    selected={form.height_unit === "ft"}
                    onPress={() => updateForm("height_unit", "ft")}
                  />
                </View>
              </View>
              {form.height_unit === "cm" ? (
                <Input
                  placeholder={t("onboarding.heightPlaceholder")}
                  keyboardType="decimal-pad"
                  value={form.height_cm}
                  onChangeText={(v) => updateForm("height_cm", v)}
                />
              ) : (
                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <Input
                      label={t("onboarding.feet")}
                      placeholder={t("onboarding.heightFtPlaceholder")}
                      keyboardType="number-pad"
                      value={form.height_ft}
                      onChangeText={(v) => updateForm("height_ft", v)}
                    />
                  </View>
                  <View className="flex-1">
                    <Input
                      label={t("onboarding.inches")}
                      placeholder={t("onboarding.heightInPlaceholder")}
                      keyboardType="number-pad"
                      value={form.height_in}
                      onChangeText={(v) => updateForm("height_in", v)}
                    />
                  </View>
                </View>
              )}
            </View>

            <View className="gap-2">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-medium text-content-secondary">
                  {t("onboarding.weightLabel")}
                </Text>
                <View className="flex-row gap-2">
                  <Chip
                    label={t("onboarding.unitKg")}
                    selected={form.weight_unit === "kg"}
                    onPress={() => updateForm("weight_unit", "kg")}
                  />
                  <Chip
                    label={t("onboarding.unitLbs")}
                    selected={form.weight_unit === "lbs"}
                    onPress={() => updateForm("weight_unit", "lbs")}
                  />
                </View>
              </View>
              <Input
                placeholder={
                  form.weight_unit === "kg"
                    ? t("onboarding.weightPlaceholder")
                    : t("onboarding.weightLbsPlaceholder")
                }
                keyboardType="decimal-pad"
                value={form.weight}
                onChangeText={(v) => updateForm("weight", v)}
              />
            </View>
          </View>
        );

      case 2:
        return (
          <View className="gap-6">
            <View className="gap-1">
              <Text className="text-2xl font-bold text-content-primary">
                {t("onboarding.lifestyle")}
              </Text>
              <Text className="text-content-tertiary text-base">
                {t("onboarding.lifestyleSubtitle")}
              </Text>
            </View>

            <View className="gap-2">
              <Text className="text-sm font-medium text-content-secondary">
                {t("onboarding.activityLevel")}
              </Text>
              <View className="gap-2">
                <OptionButton
                  label={t("onboarding.sedentary")}
                  selected={form.activity_level === "sedentary"}
                  onPress={() => updateForm("activity_level", "sedentary")}
                />
                <OptionButton
                  label={t("onboarding.active")}
                  selected={form.activity_level === "active"}
                  onPress={() => updateForm("activity_level", "active")}
                />
                <OptionButton
                  label={t("onboarding.veryActive")}
                  selected={form.activity_level === "very_active"}
                  onPress={() => updateForm("activity_level", "very_active")}
                />
              </View>
            </View>

            <View className="gap-2">
              <Text className="text-sm font-medium text-content-secondary">
                {t("onboarding.professionType")}
              </Text>
              <View className="flex-row gap-2">
                <OptionButton
                  label={t("onboarding.deskJob")}
                  selected={form.profession_type === "desk"}
                  onPress={() => updateForm("profession_type", "desk")}
                />
                <OptionButton
                  label={t("onboarding.physicalJob")}
                  selected={form.profession_type === "physical"}
                  onPress={() => updateForm("profession_type", "physical")}
                />
              </View>
            </View>
          </View>
        );

      case 3:
        return (
          <View className="gap-6">
            <View className="gap-1">
              <Text className="text-2xl font-bold text-content-primary">
                {t("profile.goalTitle")}
              </Text>
              <Text className="text-content-tertiary text-base">
                {t("profile.goalSubtitle")}
              </Text>
            </View>

            <View className="gap-2">
              <OptionButton
                label={t("profile.goalLoseWeight")}
                selected={form.goal === "lose_weight"}
                onPress={() => updateForm("goal", "lose_weight")}
              />
              <OptionButton
                label={t("profile.goalGainMuscle")}
                selected={form.goal === "gain_muscle"}
                onPress={() => updateForm("goal", "gain_muscle")}
              />
              <OptionButton
                label={t("profile.goalMaintain")}
                selected={form.goal === "maintain"}
                onPress={() => updateForm("goal", "maintain")}
              />
            </View>
          </View>
        );

      case 4:
        return (
          <View className="gap-6">
            <View className="gap-1">
              <Text className="text-2xl font-bold text-content-primary">
                {t("onboarding.trainingPlan")}
              </Text>
              <Text className="text-content-tertiary text-base">
                {t("onboarding.trainingSubtitle")}
              </Text>
            </View>

            <Input
              label={t("onboarding.daysPerWeek")}
              placeholder={t("onboarding.daysPlaceholder")}
              keyboardType="number-pad"
              value={form.days_per_week}
              onChangeText={(v) => updateForm("days_per_week", v)}
            />

            <Input
              label={t("onboarding.sessionDuration")}
              placeholder={t("onboarding.durationPlaceholder")}
              keyboardType="number-pad"
              value={form.session_duration}
              onChangeText={(v) => updateForm("session_duration", v)}
            />

            <View className="gap-2">
              <Text className="text-sm font-medium text-content-secondary">
                {t("onboarding.availableDays")}
              </Text>
              <View className="flex-row gap-2 flex-wrap">
                {DAY_KEYS.map((key, i) => (
                  <Chip
                    key={key}
                    label={t(`days.${key}`)}
                    selected={form.available_days.includes(DAY_VALUES[i])}
                    onPress={() => toggleDay(DAY_VALUES[i])}
                  />
                ))}
              </View>
            </View>
          </View>
        );

      case REMINDERS_STEP:
        return (
          <View className="gap-6">
            <View className="w-16 h-16 bg-brand-primary-soft rounded-2xl items-center justify-center">
              <Ionicons name="notifications-outline" size={32} color={colors.brandPrimary} />
            </View>
            <View className="gap-1">
              <Text className="text-2xl font-bold text-content-primary">
                {t("reminders.onboardingTitle")}
              </Text>
              <Text className="text-content-tertiary text-base">
                {t("reminders.onboardingText")}
              </Text>
            </View>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <Screen keyboard contentContainerClassName="flex-grow px-0 py-0 gap-0">
      <View className="px-6 pt-16 pb-4 flex-row items-center gap-3">
        <View className="w-12 h-12 bg-brand-primary rounded-xl items-center justify-center">
          <Ionicons name="barbell" size={26} color={colors.white} />
        </View>
        <Text className="flex-1 text-3xl font-extrabold text-brand-primary">The Hokage Coaching APP</Text>
        {/* Not on the reminders step: skipping doesn't save the profile, so
            there it would throw away every answer the client just gave. */}
        {step !== REMINDERS_STEP && (
          <Pressable
            accessibilityRole="button"
            onPress={handleSkip}
            disabled={saving}
            hitSlop={8}
          >
            <Text className="text-base font-semibold text-content-tertiary">
              {t("onboarding.skip")}
            </Text>
          </Pressable>
        )}
      </View>

      <ProgressBar step={step} />

      <View className="flex-1 px-6 pt-8 pb-6">
        {/* Keyed by step: new step slides in from the travel direction while
            the old one fades out (exits are direction-agnostic on purpose —
            a direction-aware exiting prop would be captured stale) */}
        <AnimatedView key={step} entering={slideEnter(direction)} exiting={exit()}>
          {renderStep()}
        </AnimatedView>
        {stepError != null && (
          <AnimatedView
            entering={enter()}
            exiting={exit()}
            className="bg-error-soft rounded-xl p-3 mt-6"
          >
            <Text className="text-error text-sm">{stepError}</Text>
          </AnimatedView>
        )}
      </View>

      <View className="px-6 pb-12 gap-3">
        {step === REMINDERS_STEP ? (
          <>
            <Button
              size="lg"
              onPress={handleEnableReminders}
              loading={enabling}
              disabled={saving}
            >
              {t("reminders.enable")}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onPress={handleNotNow}
              loading={saving && !enabling}
              disabled={enabling}
            >
              {t("reminders.notNow")}
            </Button>
          </>
        ) : (
          <Button size="lg" onPress={handleNext} loading={saving}>
            {step === TOTAL_STEPS - 1 ? t("common.start") : t("common.next")}
          </Button>
        )}

        {step > 0 && (
          <Button variant="ghost" onPress={handleBack} disabled={saving || enabling}>
            {t("common.back")}
          </Button>
        )}
      </View>
    </Screen>
  );
}
