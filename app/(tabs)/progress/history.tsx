import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList } from "react-native";

import { EmptyState } from "@/src/components/empty-state";
import { Card, ConfirmDialog, useToast } from "@/src/components/ui";
import { useProgress } from "@/src/hooks/use-progress";
import { useColors } from "@/src/theme/colors";
import { Pressable, Text, View } from "@/src/tw";
import type { WorkoutLog } from "@/src/types/database";

const TABULAR = { fontVariant: ["tabular-nums" as const] };

// Full workout-log list, pushed from the collapsed history section. Reuses
// the same view/delete behavior as the dashboard's history card.
export default function HistoryScreen() {
  const colors = useColors();
  const toast = useToast();
  const { t, i18n } = useTranslation();
  const { logs, deleteLog } = useProgress();
  const [pendingDelete, setPendingDelete] = useState<WorkoutLog | null>(null);

  const formatDate = (dateStr: string) =>
    new Date(dateStr + "T00:00:00").toLocaleDateString(
      i18n.language === "es" ? "es-ES" : "en-US",
      { weekday: "short", month: "short", day: "numeric" },
    );

  const handleConfirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (target == null) return;
    try {
      await deleteLog(target.id);
      toast.show({ type: "success", message: t("progress.logDeleted") });
    } catch {
      toast.show({ type: "error", message: t("common.somethingWentWrong") });
    }
  };

  return (
    <View className="flex-1 bg-brand-dark">
      <FlatList
        data={logs}
        showsVerticalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        renderItem={({ item }) => (
          <Card className="flex-row items-start justify-between px-4 py-4">
            <View className="flex-1 gap-1">
              <Text className="font-semibold text-content-primary">{item.routine_name}</Text>
              <Text className="text-sm text-content-tertiary">{formatDate(item.date)}</Text>
              {item.duration_minutes != null && (
                <View className="mt-1 self-start rounded-full bg-success-soft px-3 py-0.5">
                  <Text className="text-xs font-medium text-success" style={TABULAR}>
                    {t("progress.min", { count: item.duration_minutes })}
                  </Text>
                </View>
              )}
              {item.notes != null && item.notes.length > 0 && (
                <Text className="mt-1 text-sm text-content-tertiary" selectable>
                  {item.notes}
                </Text>
              )}
              {item.completed_exercises != null && item.completed_exercises.length > 0 && (
                <View className="mt-2 gap-1 border-t border-border pt-2">
                  {item.completed_exercises.map((exName, idx) => (
                    <View key={idx} className="flex-row items-center gap-1.5">
                      <Ionicons name="checkmark" size={14} color={colors.brandSecondary} />
                      <Text className="text-sm text-content-secondary">{exName}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
            <Pressable
              onPress={() => setPendingDelete(item)}
              className="ml-2 p-2"
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("progress.deleteLog")}
            >
              <Ionicons name="trash-outline" size={18} color={colors.error} />
            </Pressable>
          </Card>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="bar-chart-outline"
            title={t("progress.noWorkoutsLogged")}
            subtitle={t("progress.logFirstWorkout")}
          />
        }
      />

      <ConfirmDialog
        visible={pendingDelete != null}
        destructive
        title={t("progress.deleteLog")}
        message={
          pendingDelete != null
            ? t("progress.deleteConfirm", { name: pendingDelete.routine_name })
            : undefined
        }
        confirmLabel={t("common.delete")}
        onConfirm={handleConfirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </View>
  );
}
