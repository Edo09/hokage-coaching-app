import { router } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, RefreshControl } from "react-native";
import RAnimated from "react-native-reanimated";

import { AchievementChips } from "@/src/components/progress/achievement-chips";
import { HeroCard } from "@/src/components/progress/hero-card";
import { InsightCard } from "@/src/components/progress/insight-card";
import { MusclesCard } from "@/src/components/progress/muscles-card";
import { NutritionCard } from "@/src/components/progress/nutrition-card";
import { PeriodToggle } from "@/src/components/progress/period-toggle";
import { SkeletonDashboard } from "@/src/components/progress/skeleton-dashboard";
import { StrengthCard } from "@/src/components/progress/strength-card";
import { WeightCard } from "@/src/components/progress/weight-card";
import { ErrorState } from "@/src/components/ui";
import { useProgressDashboard } from "@/src/hooks/use-progress-dashboard";
import { useRefreshOnFocus } from "@/src/hooks/use-refresh-on-focus";
import { staggered } from "@/src/lib/motion";
import { useColors } from "@/src/theme/colors";
import { View } from "@/src/tw";
import { AnimatedView } from "@/src/tw/animated";
import type { Periodo } from "@/src/utils/progress";

// Coach app: analytics only. No manual "log a workout" flow or workout-log
// history — clients track through the coach PROGRAM (per-set logging +
// completions), not free-form routine sessions. Weight logging stays.
export default function ProgressScreen() {
  const colors = useColors();
  const headerHeight = useHeaderHeight();
  const [periodo, setPeriodo] = useState<Periodo>("week");
  const dashboard = useProgressDashboard(periodo);
  useRefreshOnFocus(dashboard.refresh);

  if (dashboard.loading && dashboard.logs.length === 0) {
    return (
      <View className="flex-1 bg-brand-dark">
        <SkeletonDashboard />
      </View>
    );
  }

  if (dashboard.error && dashboard.logs.length === 0) {
    return (
      <View className="flex-1 bg-brand-dark">
        <ErrorState onRetry={dashboard.refresh} />
      </View>
    );
  }

  const { isEmpty } = dashboard;

  return (
    <View className="flex-1 bg-brand-dark">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === "ios" ? headerHeight : 0}
      >
        <RAnimated.ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 72 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={dashboard.refreshing}
              onRefresh={dashboard.refresh}
              tintColor={colors.brandPrimary}
              colors={[colors.brandPrimary]}
              progressBackgroundColor={colors.surface}
            />
          }
        >
          {!isEmpty && (
            <AnimatedView entering={staggered(0)}>
              <PeriodToggle value={periodo} onChange={setPeriodo} />
            </AnimatedView>
          )}

          <AnimatedView entering={staggered(1)}>
            <HeroCard
              periodo={periodo}
              hero={dashboard.hero}
              firstRun={isEmpty}
              onLogFirst={() => router.push("/(tabs)/routines")}
            />
          </AnimatedView>

          <AnimatedView entering={staggered(2)}>
            <WeightCard
              weight={dashboard.weight}
              profile={dashboard.profile}
              onLogWeight={dashboard.logWeight}
            />
          </AnimatedView>

          {!isEmpty && (
            <>
              <AnimatedView entering={staggered(3)}>
                <StrengthCard
                  weekVolume={dashboard.strength.weekVolume}
                  series={dashboard.strength.series}
                  deltaPct={dashboard.strength.deltaPct}
                  prs={dashboard.strength.prs}
                  estimated={dashboard.strength.estimated}
                />
              </AnimatedView>

              <AnimatedView entering={staggered(4)}>
                <NutritionCard periodo={periodo} nutrition={dashboard.nutrition} />
              </AnimatedView>

              <AnimatedView entering={staggered(5)}>
                <MusclesCard
                  periodo={periodo}
                  rows={dashboard.muscles.rows}
                  alert={dashboard.muscles.alert}
                />
              </AnimatedView>

              {(dashboard.insight != null || dashboard.aiInsight != null) && (
                <AnimatedView entering={staggered(6)}>
                  <InsightCard insight={dashboard.insight} ai={dashboard.aiInsight} />
                </AnimatedView>
              )}

              <AnimatedView entering={staggered(6)}>
                <AchievementChips chips={dashboard.logros} />
              </AnimatedView>
            </>
          )}

          {isEmpty && <NutritionCard periodo={periodo} nutrition={dashboard.nutrition} />}
        </RAnimated.ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
