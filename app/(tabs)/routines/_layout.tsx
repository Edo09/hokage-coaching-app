import { Stack } from "expo-router";
import { Platform } from "react-native";
import { useTranslation } from "react-i18next";

import { TabHeader } from "@/src/components/ui";
import { useProgram } from "@/src/hooks/use-program";
import { useColors } from "@/src/theme/colors";

// Context line: the block's current week, or its start date before it begins.
function ProgramHeader() {
  const { t, i18n } = useTranslation();
  const { program, autoWeek, notStarted } = useProgram();
  let context: string | null = null;
  if (program != null) {
    context = notStarted
      ? t("program.startsOn", {
          date: new Date(`${program.start_date}T00:00:00`).toLocaleDateString(
            i18n.language === "es" ? "es-ES" : "en-US",
            { day: "numeric", month: "long" },
          ),
        })
      : t("program.weekOfTotal", { n: autoWeek, total: program.duration_weeks });
  }
  return <TabHeader title={t("tabs.program")} context={context} />;
}

export default function RoutinesLayout() {
  const colors = useColors();
  return (
    <Stack
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
      <Stack.Screen name="index" options={{ header: () => <ProgramHeader /> }} />
    </Stack>
  );
}
