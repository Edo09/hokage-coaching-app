import { Stack } from "expo-router";
import { Platform } from "react-native";
import { useTranslation } from "react-i18next";

import { TabHeader } from "@/src/components/ui";
import { nestedStackScreenLayout } from "@/src/lib/motion";
import { useColors } from "@/src/theme/colors";

// Context line: today, the day the diary below is about (same format as home).
function NutritionHeader() {
  const { t, i18n } = useTranslation();
  const today = new Date().toLocaleDateString(i18n.language === "es" ? "es-ES" : "en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return <TabHeader title={t("tabs.nutrition")} context={today} />;
}

// Deep-linking straight to "create"/"edit" (e.g. from the Home tab) otherwise
// builds this stack with no "index" beneath it — no parent screen means no
// back button. This forces index to always be inserted first.
export const unstable_settings = {
  initialRouteName: "index",
};

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
      <Stack.Screen
        name="create"
        options={{
          title: t("meals.addFood"),
          presentation: "modal",
          ...(Platform.OS === "android" && { animation: "slide_from_bottom" as const }),
        }}
      />
      <Stack.Screen
        name="edit"
        options={{
          title: t("meals.editFood"),
          presentation: "modal",
          ...(Platform.OS === "android" && { animation: "slide_from_bottom" as const }),
        }}
      />
    </Stack>
  );
}
