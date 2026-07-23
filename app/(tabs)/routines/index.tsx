import React from "react";
import { useTranslation } from "react-i18next";

import { EmptyState } from "@/src/components/empty-state";
import { ProgramView } from "@/src/components/program/program-view";
import { ErrorState, LoadingBlock, Screen } from "@/src/components/ui";
import { useProgram } from "@/src/hooks/use-program";
import { useRefreshOnFocus } from "@/src/hooks/use-refresh-on-focus";
import { View } from "@/src/tw";

// Coach app = programs only. The client follows the single active coach program
// (self-made routines + the AI generator live in the SOLO app, not here). When
// no program is assigned yet, a waiting state — refetched on focus so a freshly
// assigned program appears on return.
export default function RoutinesScreen() {
  const { t } = useTranslation();
  const {
    program,
    week,
    selectedWeek,
    autoWeek,
    setViewWeek,
    notStarted,
    loading,
    error,
    refresh,
    refreshing,
  } = useProgram();
  useRefreshOnFocus(refresh);

  if (loading && program == null) {
    return (
      <View className="flex-1 bg-brand-dark">
        <LoadingBlock />
      </View>
    );
  }

  if (error && program == null) {
    return (
      <View className="flex-1 bg-brand-dark">
        <ErrorState onRetry={refresh} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-brand-dark">
      {program != null ? (
        <Screen
          refreshing={refreshing}
          onRefresh={refresh}
          contentContainerClassName="p-4 gap-3 pb-24"
        >
          <ProgramView
            program={program}
            week={week}
            selectedWeek={selectedWeek}
            autoWeek={autoWeek}
            onSelectWeek={setViewWeek}
            notStarted={notStarted}
          />
        </Screen>
      ) : (
        <View className="flex-1 items-center justify-center px-6">
          <EmptyState
            icon="ribbon-outline"
            title={t("coach.noProgramTitle")}
            subtitle={t("coach.noProgramHint")}
          />
        </View>
      )}
    </View>
  );
}
