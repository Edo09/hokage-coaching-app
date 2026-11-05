import { Stack } from "expo-router";
import { Platform } from "react-native";
import { useTranslation } from "react-i18next";

import { TabHeader } from "@/src/components/ui";
import { nestedStackScreenLayout } from "@/src/lib/motion";
import { useToday } from "@/src/lib/today";
import { useColors } from "@/src/theme/colors";

// Context line: today, the day the meals below are about (same format as
// home). useToday turns it over at midnight with the tab open.
function NutritionHeader() {
  const { t, i18n } = useTranslation();
  const today = useToday().toLocaleDateString(i18n.language === "es" ? "es-ES" : "en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return <TabHeader title={t("tabs.nutrition")} context={today} />;
}

export default function NutritionLayout() {
  const colors = useColors();
  const { t } = useTranslation();
  return (
    <Stack
      // Web has no native stack transition: scenes fade in (see motion.tsx)
      screenLayout={nestedStackScreenLayout}
      screenOptions={{
        headerStyle: { backgroundColor: colors.brandDark },
        headerTintColor: colors.contentPrimary,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.brandDark },
        // iOS keeps the native push (parallax + swipe-back); Android's OEM
        // default varies, so pin it
        ...(Platform.OS === "android" && { animation: "slide_from_right" as const }),
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: t("tabs.nutrition"), header: () => <NutritionHeader /> }}
      />
    </Stack>
  );
}
