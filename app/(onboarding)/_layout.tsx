import { Stack } from "expo-router";

import { nestedStackScreenLayout } from "@/src/lib/motion";
import { useColors } from "@/src/theme/colors";

export default function OnboardingLayout() {
  const colors = useColors();
  return (
    <Stack
      // Web has no native stack transition: scenes fade in (see motion.tsx)
      screenLayout={nestedStackScreenLayout}
      screenOptions={{
        headerShown: false,
        gestureEnabled: false,
        contentStyle: { backgroundColor: colors.brandDark },
      }}
    />
  );
}
