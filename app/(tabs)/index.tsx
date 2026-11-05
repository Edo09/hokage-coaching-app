import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";

import { AppMenu } from "@/src/components/app-menu";
import { ProgramHomeCard } from "@/src/components/program/program-home-card";
import { Ring } from "@/src/components/progress/ring";
import {
  CapsLabel,
  Card,
  DashLabel,
  ErrorState,
  HeaderPanel,
  LoadingBlock,
  PosterText,
  Screen,
  SectionHeader,
} from "@/src/components/ui";
import { useAuth } from "@/src/hooks/use-auth";
import { useMealRegistrations } from "@/src/hooks/use-meal-registrations";
import { useMeals } from "@/src/hooks/use-meals";
import { useNutritionPlan } from "@/src/hooks/use-nutrition-plan";
import { useProfile } from "@/src/hooks/use-profile";
import { useProgram } from "@/src/hooks/use-program";
import { useProgramLogging } from "@/src/hooks/use-program-logging";
import { useProgress } from "@/src/hooks/use-progress";
import { useRefreshOnFocus } from "@/src/hooks/use-refresh-on-focus";
import { exit, staggered, useArrival } from "@/src/lib/motion";
import { useToday } from "@/src/lib/today";
import { useColors } from "@/src/theme/colors";
import { Pressable, Text, View } from "@/src/tw";
import { AnimatedView } from "@/src/tw/animated";
import {
  caloriesConsumed,
  estimateCaloriesBurned,
  estimateProgramBurn,
  recommendedCalorieGoal,
} from "@/src/utils/calories";
import { toDateKey } from "@/src/utils/dates";
import { combinedEstimateState, fuelSlots, itemsOf } from "@/src/utils/meal-counting";
import { capitalizeFirst } from "@/src/utils/meal-registration";
import { planCalorieGoal } from "@/src/utils/nutrition-plan";

export default function HomeScreen() {
  const colors = useColors();
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const meals = useMeals();
  const progress = useProgress();
  const { profile } = useProfile(user?.id);
  const {
    program,
    notStarted: programNotStarted,
    loading: programLoading,
    refresh: refreshProgram,
  } = useProgram();
  const programLogging = useProgramLogging(program);
  const nutrition = useNutritionPlan();
  // Today's registrations by the day-reactive key (useToday), counted by the
  // nutrition rules: «No la comí» adds nothing, a missing estimate is flagged.
  const { todays } = useMealRegistrations();
  const todayDate = useToday();

  const { todaysLogs } = progress;

  // Daily calorie KPIs — recompute whenever today's meals/logs change, so
  // logging a meal or workout updates the dashboard immediately.
  // An assigned nutrition plan's target for today's day type (training/rest)
  // wins over the profile's single calorie goal.
  const calorieGoal =
    planCalorieGoal(nutrition.plan, nutrition.day) ??
    profile?.calorie_goal ??
    recommendedCalorieGoal(profile);
  const consumed = caloriesConsumed(todays);
  // Burned = logged sessions (legacy) + an estimate from today's program
  // check-offs, since checking exercises off records no duration of its own.
  const programDoneToday = programLogging.completions.filter(
    (c) => toDateKey(new Date(c.completed_at)) === toDateKey(),
  ).length;
  const burned =
    todaysLogs.reduce((sum, log) => sum + estimateCaloriesBurned(log, profile), 0) +
    estimateProgramBurn(programDoneToday, profile);
  const remaining = calorieGoal != null ? calorieGoal - consumed + burned : null;
  const fuelFrac = calorieGoal != null && calorieGoal > 0 ? consumed / calorieGoal : 0;

  const numberLocale = i18n.language === "es" ? "es-ES" : "en-US";
  const kcal = (value: number | null) =>
    value != null ? Math.round(value).toLocaleString(numberLocale) : "—";

  // «Combustible de Hoy»: one row per diary type with rows today.
  const fuel = fuelSlots(todays);
  const hasTodayRows = itemsOf(todays).length > 0;
  const estimateGap = combinedEstimateState(itemsOf(todays));

  const loading = meals.loading || progress.loading;
  const error = meals.error || progress.error;
  const hasData = program != null || meals.meals.length > 0 || progress.logs.length > 0;
  // Fades in only when it replaces the loader; cached data arrives with the screen.
  const arrive = useArrival(loading && !hasData);

  const mealsRefresh = meals.refresh;
  const progressRefresh = progress.refresh;

  // Resolves when all three land, so a pull's indicator lasts until then.
  const refreshAll = React.useCallback(
    () => Promise.all([mealsRefresh(), progressRefresh(), refreshProgram()]),
    [mealsRefresh, progressRefresh, refreshProgram],
  );

  // Tab switches don't trigger react-query refetches in RN — refetch
  // whenever the dashboard regains focus so it reflects changes made
  // on other tabs.
  useRefreshOnFocus(refreshAll);

  const displayName =
    (user?.user_metadata?.display_name as string | undefined) ??
    user?.email?.split("@")[0] ??
    "there";

  const today = todayDate.toLocaleDateString(i18n.language === "es" ? "es-ES" : "en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  // Program exercises the client checked off TODAY, newest first, resolved to
  // names — legacy workout_logs (todaysLogs) don't cover coach programs, so
  // these are merged into Recent Activity below.
  const programActivityToday = React.useMemo(() => {
    if (program == null) return [];
    const names = new Map<string, string>();
    for (const d of program.program_days) {
      for (const e of d.program_exercises) {
        names.set(e.id, e.exercise?.name ?? e.custom_name ?? "");
      }
    }
    const todayKey = toDateKey();
    return programLogging.completions
      .filter((c) => toDateKey(new Date(c.completed_at)) === todayKey)
      .sort((a, b) => b.completed_at.localeCompare(a.completed_at))
      .map((c) => ({
        id: c.id,
        name: (c.program_exercise_id != null ? names.get(c.program_exercise_id) : null) ?? "",
      }));
  }, [program, programLogging.completions]);

  const activityRows = [
    ...programActivityToday.map((a) => ({ key: a.id, title: a.name, sub: program?.name ?? null })),
    ...todaysLogs.map((l) => ({
      key: l.id,
      title: l.routine_name,
      sub: l.duration_minutes != null ? `${l.duration_minutes} ${t("home.minutes")}` : null,
    })),
  ].slice(0, 3);

  // Fuel-card breakdown rows: caps label left, Anton numeral right
  const fuelRows = [
    { key: "goal", label: t("home.goalShort"), value: kcal(calorieGoal), color: colors.contentPrimary },
    { key: "burned", label: t("home.caloriesBurned"), value: kcal(burned), color: colors.info },
    {
      key: "left",
      label: t("home.caloriesRemaining"),
      value: kcal(remaining),
      color: remaining != null && remaining < 0 ? colors.error : colors.success,
    },
  ];

  return (
    <Screen
      onRefresh={refreshAll}
      contentContainerClassName="px-0 py-0 pb-12 gap-0"
    >
      {/* Poster header: brand row → greeting → red dash + date */}
      <HeaderPanel>
        <View className="flex-row items-center justify-between">
          <Pressable
            onPress={() => router.push("/(tabs)/profile")}
            accessibilityRole="button"
            accessibilityLabel={t("tabs.profile")}
            className="flex-row items-center gap-2.5 flex-1 mr-2"
          >
            <Image
              source={require("@/assets/images/app-icon/icon.png")}
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: colors.border,
              }}
              accessibilityIgnoresInvertColors
            />
            <Text
              className="text-brand-primary font-display text-[19px] flex-1"
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              The Hokage Coaching
            </Text>
          </Pressable>
          <AppMenu />
        </View>
        <View className="mt-5">
          <PosterText size={27} numberOfLines={1} adjustsFontSizeToFit>
            {t("home.hey", { name: displayName })}
          </PosterText>
          <DashLabel className="mt-2.5">{today}</DashLabel>
        </View>
      </HeaderPanel>

      {loading && !hasData ? (
        <LoadingBlock />
      ) : error && !hasData ? (
        <ErrorState onRetry={refreshAll} />
      ) : (
        <AnimatedView entering={arrive}>
          {/* Fuel summary: ring + goal/burned/left breakdown. Tapping opens
              the profile's calorie-goal section (unchanged behavior). */}
          <View className="px-5 pt-2">
            <Card
              topAccent={fuelFrac}
              className="rounded-[20px] p-[18px]"
              onPress={() =>
                router.push({
                  pathname: "/(tabs)/profile",
                  params: { highlight: "calorie-goal", ts: String(Date.now()) },
                })
              }
            >
              <View className="flex-row items-center gap-[18px]">
                <View className="items-center gap-1.5">
                  <Ring
                    size={104}
                    strokeWidth={9}
                    frac={fuelFrac}
                    color={colors.brandPrimary}
                    trackColor={colors.border}
                  >
                    <PosterText size={23} tabular>
                      {kcal(consumed)}
                    </PosterText>
                    <CapsLabel size={8.5} em={0.14}>
                      {t("home.caloriesConsumed")}
                    </CapsLabel>
                  </Ring>
                  <EstimateGapLabel gap={estimateGap} />
                </View>
                <View className="flex-1">
                  {fuelRows.map((row, i) => (
                    <View
                      key={row.key}
                      className={
                        i < fuelRows.length - 1
                          ? "flex-row items-center justify-between py-[7px] border-b border-border"
                          : "flex-row items-center justify-between py-[7px]"
                      }
                    >
                      <CapsLabel size={9.5} em={0.14}>
                        {row.label}
                      </CapsLabel>
                      <PosterText size={17} tabular style={{ color: row.color }}>
                        {row.value}
                      </PosterText>
                    </View>
                  ))}
                </View>
              </View>
            </Card>
            {calorieGoal == null && (
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: "/(tabs)/profile",
                    params: { highlight: "calorie-goal", ts: String(Date.now()) },
                  })
                }
                accessibilityRole="button"
                className="bg-brand-primary-soft px-4 py-3 mt-3"
              >
                <Text className="text-brand-primary text-sm font-semibold text-center">
                  {t("home.setCalorieGoalHint")}
                </Text>
              </Pressable>
            )}
          </View>

          {/* Coach program — the client's single training plan (one active per
              client). No self-made routines / AI generator in the coach app. */}
          <View className="pt-7">
            <SectionHeader
              title={t("home.yourProgram")}
              actionLabel={t("common.seeAll")}
              onAction={() => router.push("/(tabs)/routines")}
              className="px-5 mb-3"
            />
            {program != null ? (
              <View className="px-5">
                <ProgramHomeCard
                  program={program}
                  notStarted={programNotStarted}
                  onPress={() => router.push("/(tabs)/routines")}
                />
              </View>
            ) : programLoading ? (
              <View className="px-5">
                <View className="h-[168px] rounded-[20px] border border-border bg-surface" />
              </View>
            ) : (
              <View className="px-5">
                <Card
                  onPress={() => router.push("/(tabs)/routines")}
                  className="items-center gap-2 rounded-[20px] p-6"
                >
                  <Ionicons name="ribbon-outline" size={26} color={colors.contentTertiary} />
                  <Text className="text-center text-[13px] text-content-secondary">
                    {t("coach.noProgramHint")}
                  </Text>
                </Card>
              </View>
            )}
          </View>

          {/* Today's meals */}
          <View className="px-5 pt-7 gap-3">
            <SectionHeader
              title={t("home.todaysNutrition")}
              actionLabel={t("common.seeAll")}
              onAction={() => router.push("/(tabs)/nutrition")}
            />

            {!hasTodayRows ? (
              <Pressable
                key="meals-empty"
                onPress={() => router.push("/(tabs)/nutrition")}
                className="bg-surface rounded-2xl p-7 items-center border-2 border-dashed border-border-strong"
              >
                <Text className="text-content-tertiary font-medium mb-2">
                  {t("home.fuelYourBody")}
                </Text>
                <View className="flex-row items-center gap-1.5">
                  <Ionicons name="add" size={16} color={colors.brandPrimary} />
                  <CapsLabel size={11} className="text-brand-primary font-extrabold">
                    {t("home.logMeal")}
                  </CapsLabel>
                </View>
              </Pressable>
            ) : (
              <View key="meals-list" className="gap-2.5">
                {fuel.map((row, index) => (
                  <AnimatedView key={row.slot} entering={staggered(index)} exiting={exit()}>
                    <Pressable
                      onPress={() => router.push("/(tabs)/nutrition")}
                      className="bg-surface rounded-2xl px-4 py-3.5 flex-row items-center gap-3.5 border border-border"
                    >
                      <Ionicons
                        name={row.slot === "breakfast" ? "cafe-outline" : "restaurant-outline"}
                        size={20}
                        color={colors.brandPrimary}
                      />
                      <View className="flex-1">
                        <Text className="text-sm font-bold text-content-primary">
                          {capitalizeFirst(t(`meals.${row.slot}`, { defaultValue: row.slot }))}
                        </Text>
                        <Text className="text-content-muted text-[11px]">
                          {row.skippedOnly ? t("mealReg.skipped") : t("mealReg.mealsCount", { count: row.meals })}
                        </Text>
                      </View>
                      {!row.skippedOnly && (
                        <View className="items-end gap-0.5">
                          <View className="flex-row items-baseline gap-1">
                            <PosterText size={17} tabular>
                              {kcal(row.kcal)}
                            </PosterText>
                            <Text className="text-[10px] text-content-muted">{t("home.kcal")}</Text>
                          </View>
                          <EstimateGapLabel gap={row.gap} />
                        </View>
                      )}
                    </Pressable>
                  </AnimatedView>
                ))}
              </View>
            )}
          </View>

          {/* Recent activity */}
          <View className="px-5 pt-7 gap-3">
            <SectionHeader
              title={t("home.recentActivity")}
              actionLabel={t("common.seeAll")}
              onAction={() => router.push("/(tabs)/progress")}
            />

            {activityRows.length === 0 ? (
              <Pressable
                key="logs-empty"
                onPress={() => router.push("/(tabs)/routines")}
                className="bg-surface rounded-2xl p-7 items-center border-2 border-dashed border-border-strong"
              >
                <Text className="text-content-tertiary font-medium mb-2">
                  {t("home.noActivityToday")}
                </Text>
                <CapsLabel size={11} className="text-brand-primary font-extrabold">
                  {t("program.trainToday")}
                </CapsLabel>
              </Pressable>
            ) : (
              <View key="logs-list" className="gap-2.5">
                {activityRows.map((row, index) => (
                  <AnimatedView
                    key={row.key}
                    entering={staggered(index)}
                    exiting={exit()}
                    className="bg-surface rounded-2xl px-4 py-3.5 flex-row items-center gap-3.5 border border-border"
                  >
                    <Ionicons name="checkmark-circle" size={22} color={colors.success} />
                    <View className="flex-1">
                      <Text className="text-sm font-bold text-content-primary" numberOfLines={1}>
                        {row.title}
                      </Text>
                      {row.sub != null && (
                        <Text className="text-content-muted text-[11px]" numberOfLines={1}>
                          {row.sub}
                        </Text>
                      )}
                    </View>
                  </AnimatedView>
                ))}
              </View>
            )}
          </View>
        </AnimatedView>
      )}
    </Screen>
  );
}

/** «✦ Calculando…» in gold while an estimate is pending, else a muted «Sin
 *  estimar» while one has failed (spec «Inicio and Progreso»). */
function EstimateGapLabel({ gap }: { gap: "pending" | "failed" | null }) {
  const { t } = useTranslation();
  const colors = useColors();
  if (gap === "pending") {
    return (
      <View className="flex-row items-center gap-1">
        <Ionicons name="sparkles" size={9} color={colors.brandAccent} />
        <CapsLabel size={8.5} em={0.1} className="font-extrabold text-brand-accent">
          {t("mealReg.estimating")}
        </CapsLabel>
      </View>
    );
  }
  if (gap === "failed") {
    return (
      <CapsLabel size={8.5} em={0.1} className="font-extrabold text-content-muted">
        {t("mealReg.notEstimated")}
      </CapsLabel>
    );
  }
  return null;
}
