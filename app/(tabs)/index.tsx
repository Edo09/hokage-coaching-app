import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useState } from "react";
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
import { useMeals } from "@/src/hooks/use-meals";
import { useProfile } from "@/src/hooks/use-profile";
import { useProgram } from "@/src/hooks/use-program";
import { useProgramLogging } from "@/src/hooks/use-program-logging";
import { useProgress } from "@/src/hooks/use-progress";
import { useRefreshOnFocus } from "@/src/hooks/use-refresh-on-focus";
import { enterFade, exit, staggered } from "@/src/lib/motion";
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
import { MEAL_SLOTS, suggestedSlot } from "@/src/utils/meal-slots";

export default function HomeScreen() {
  const colors = useColors();
  const [menuOpen, setMenuOpen] = useState(false);
  const { t, i18n } = useTranslation();
  const { user, signOut } = useAuth();
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

  const { todaysMeals } = meals;
  const { todaysLogs } = progress;

  // Daily calorie KPIs — recompute whenever today's meals/logs change, so
  // logging a meal or workout updates the dashboard immediately.
  const calorieGoal = profile?.calorie_goal ?? recommendedCalorieGoal(profile);
  const consumed = caloriesConsumed(todaysMeals);
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

  // Per-slot summary for the nutrition section (only slots with items)
  const slotSummaries = MEAL_SLOTS.map((slot) => {
    const items = todaysMeals
      .filter((m) => m.meal_type === slot)
      .flatMap((m) => m.meal_items);
    return {
      slot,
      count: items.length,
      kcal: items.reduce((sum, i) => sum + i.calories, 0),
    };
  }).filter((s) => s.count > 0);

  const loading = meals.loading || progress.loading;
  const error = meals.error || progress.error;
  const refreshing = meals.refreshing || progress.refreshing;
  const hasData = program != null || meals.meals.length > 0 || progress.logs.length > 0;

  const mealsRefresh = meals.refresh;
  const progressRefresh = progress.refresh;

  const refreshAll = React.useCallback(() => {
    mealsRefresh();
    progressRefresh();
    refreshProgram();
  }, [mealsRefresh, progressRefresh, refreshProgram]);

  // Tab switches don't trigger react-query refetches in RN — refetch
  // whenever the dashboard regains focus so it reflects changes made
  // on other tabs.
  useRefreshOnFocus(refreshAll);

  const displayName =
    (user?.user_metadata?.display_name as string | undefined) ??
    user?.email?.split("@")[0] ??
    "there";

  const today = new Date().toLocaleDateString(i18n.language === "es" ? "es-ES" : "en-US", {
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
      .map((c) => ({ id: c.id, name: names.get(c.program_exercise_id) ?? "" }));
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
      refreshing={refreshing}
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
          <Pressable
            onPress={() => setMenuOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t("common.menu")}
            className="w-11 h-11 rounded-xl bg-surface items-center justify-center border border-border"
          >
            <Ionicons name="ellipsis-vertical" size={18} color={colors.contentSecondary} />
          </Pressable>
        </View>
        <View className="mt-5">
          <PosterText size={27} numberOfLines={1} adjustsFontSizeToFit>
            {t("home.hey", { name: displayName })}
          </PosterText>
          <DashLabel className="mt-2.5">{today}</DashLabel>
        </View>
      </HeaderPanel>

      <Actionsheet isOpen={menuOpen} onClose={() => setMenuOpen(false)}>
        <ActionsheetBackdrop />
        <ActionsheetContent>
          <ActionsheetDragIndicatorWrapper>
            <ActionsheetDragIndicator />
          </ActionsheetDragIndicatorWrapper>
          <ActionsheetItem
            onPress={() => {
              setMenuOpen(false);
              router.push("/(tabs)/profile");
            }}
          >
            <Ionicons name="person-outline" size={20} color={colors.contentSecondary} />
            <ActionsheetItemText>{t("tabs.profile")}</ActionsheetItemText>
          </ActionsheetItem>
          {/* Theme/language/unit toggles live in Settings now */}
          <ActionsheetItem
            onPress={() => {
              setMenuOpen(false);
              router.push("/(tabs)/settings");
            }}
          >
            <Ionicons name="settings-outline" size={20} color={colors.contentSecondary} />
            <ActionsheetItemText>{t("settings.title")}</ActionsheetItemText>
          </ActionsheetItem>
          <ActionsheetItem
            onPress={() => {
              setMenuOpen(false);
              signOut();
            }}
          >
            <Ionicons name="log-out-outline" size={20} color={colors.error} />
            <ActionsheetItemText className="text-error">
              {t("auth.signOut")}
            </ActionsheetItemText>
          </ActionsheetItem>
        </ActionsheetContent>
      </Actionsheet>

      {loading && !hasData ? (
        <LoadingBlock />
      ) : error && !hasData ? (
        <ErrorState onRetry={refreshAll} />
      ) : (
        <AnimatedView entering={enterFade()}>
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
              onAction={() => router.push("/(tabs)/meals")}
            />

            {slotSummaries.length === 0 ? (
              <Pressable
                key="meals-empty"
                onPress={() => {
                  // Seed the Meals tab's own stack with its index first, then
                  // push "create" on the next tick — pushing both in the same
                  // tick gets coalesced into one history entry (no parent
                  // screen, no back button); yielding first makes them two.
                  router.push("/(tabs)/meals");
                  setTimeout(
                    () =>
                      router.push({
                        pathname: "/(tabs)/meals/create",
                        params: { mealType: suggestedSlot(), date: toDateKey() },
                      }),
                    0
                  );
                }}
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
                {slotSummaries.map((summary, index) => (
                  <AnimatedView key={summary.slot} entering={staggered(index)} exiting={exit()}>
                    <Pressable
                      onPress={() => router.push("/(tabs)/meals")}
                      className="bg-surface rounded-2xl px-4 py-3.5 flex-row items-center gap-3.5 border border-border"
                    >
                      <Ionicons
                        name={summary.slot === "breakfast" ? "cafe-outline" : "restaurant-outline"}
                        size={20}
                        color={colors.brandPrimary}
                      />
                      <View className="flex-1">
                        <Text className="text-sm font-bold text-content-primary capitalize">
                          {t(`meals.${summary.slot}`, { defaultValue: summary.slot })}
                        </Text>
                        <Text className="text-content-muted text-[11px]">
                          {t("meals.itemCount", { count: summary.count })}
                        </Text>
                      </View>
                      <View className="flex-row items-baseline gap-1">
                        <PosterText size={17} tabular>
                          {kcal(summary.kcal)}
                        </PosterText>
                        <Text className="text-[10px] text-content-muted">{t("home.kcal")}</Text>
                      </View>
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
