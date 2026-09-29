import { Stack } from "expo-router";
import { Platform } from "react-native";

import { nestedStackScreenLayout } from "@/src/lib/motion";
import { useColors } from "@/src/theme/colors";

export default function AuthLayout() {
  const colors = useColors();
  return (
    <Stack
      // Web has no native stack transition: scenes fade in (see motion.tsx)
      screenLayout={nestedStackScreenLayout}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.brandDark },
        ...(Platform.OS === "android" && { animation: "slide_from_right" as const }),
      }}
    />
  );
}
