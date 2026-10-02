import { Ionicons } from "@expo/vector-icons";
import React from "react";

import { useColors } from "@/src/theme/colors";
import { Pressable, Text, View } from "@/src/tw";

type RowProps = {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  onPress: () => void;
  last?: boolean;
};

// Tappable preference row: label left, current value + chevron right.
// Tapping cycles a binary setting, or opens a card's options (rest alert,
// notifications, password).
export function SettingsRow({ icon, label, value, onPress, last = false }: RowProps) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      className={`flex-row items-center gap-3 py-3.5 ${last ? "" : "border-b border-border"}`}
    >
      <View className="h-8 w-8 items-center justify-center rounded-lg bg-brand-dark">
        <Ionicons name={icon} size={16} color={colors.contentSecondary} />
      </View>
      <Text className="flex-1 text-[15px] font-medium text-content-primary">{label}</Text>
      <Text className="text-sm text-content-tertiary">{value}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.contentMuted} />
    </Pressable>
  );
}
