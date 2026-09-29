import { Stack } from "expo-router";
import { Platform } from "react-native";
import { useTranslation } from "react-i18next";

import { TabHeader } from "@/src/components/ui";
import { useColors } from "@/src/theme/colors";

// Context line: today. Not "this week": the dashboard's Semana/Mes toggle
// sits right under it, and a week label would be wrong in month view.
function ProgressHeader() {
  const { t, i18n } = useTranslation();
  const today = new Date().toLocaleDateString(i18n.language === "es" ? "es-ES" : "en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return <TabHeader title={t("tabs.progress")} context={today} />;
}

export default function ProgressLayout() {
  const colors = useColors();
  const { t } = useTranslation();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.brandDark },
        headerTintColor: colors.contentPrimary,
        // Elevation/hairline under the header so the scrolling dashboard
        // reads as separate from the title (other tabs stay flat by default).
        headerShadowVisible: true,
        contentStyle: { backgroundColor: colors.brandDark },
        ...(Platform.OS === "android" && { animation: "slide_from_right" as const }),
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: t("tabs.progress"), header: () => <ProgressHeader /> }}
      />
      <Stack.Screen name="history" options={{ title: t("progress.historial") }} />
    </Stack>
  );
}
